from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.custom_question import CustomQuestion, CustomQuestionTarget, CustomSubmission
from app.models.enums import AssignmentScope, CustomSubmissionStatus, Role
from app.models.system import AIInteractionLog, Notification
from app.models.user import StudentProfile, User
from app.services.ai_assistant import AssistantError
from app.services.custom_question_grading import ai_assist_grade

router = APIRouter(prefix="/api/custom-questions", tags=["custom-questions"])


def _resolve_target_student_ids(db: Session, question: CustomQuestion) -> list[int]:
    """Same idea as services.assignment_targeting.resolve_target_student_ids
    but against CustomQuestionTarget instead of AssignmentTarget — kept
    separate since it's a different parent table, not worth a generic
    abstraction for one extra caller."""
    if question.scope == AssignmentScope.students:
        return [
            t.student_id
            for t in db.scalars(
                select(CustomQuestionTarget).where(
                    CustomQuestionTarget.question_id == question.id
                )
            ).all()
        ]

    query = select(StudentProfile.user_id)
    if question.scope == AssignmentScope.section:
        query = query.where(StudentProfile.section_id == question.section_id)
    return list(db.scalars(query).all())


def _get_own_question(db: Session, teacher: User, question_id: int) -> CustomQuestion:
    q = db.get(CustomQuestion, question_id)
    if not q or q.teacher_id != teacher.id:
        raise HTTPException(404, "Custom question not found.")
    return q


# --------------------------------------------------------------------
# Teacher: create / list / manage questions
# --------------------------------------------------------------------


class CustomQuestionCreate(BaseModel):
    title: str
    description: str
    constraints: str = ""
    max_score: int = 10
    reference_solution: str = ""
    reference_language: str = "python"
    scope: AssignmentScope
    section_id: int | None = None
    student_ids: list[int] = []
    assigned_date: datetime
    deadline: datetime


class CustomQuestionOut(BaseModel):
    id: int
    title: str
    description: str
    constraints: str
    max_score: int
    has_reference_solution: bool
    reference_language: str
    deadline: datetime
    created_at: datetime
    target_count: int
    submitted_count: int
    graded_count: int


def _to_question_out(db: Session, q: CustomQuestion) -> CustomQuestionOut:
    subs = db.scalars(
        select(CustomSubmission).where(CustomSubmission.question_id == q.id)
    ).all()
    return CustomQuestionOut(
        id=q.id,
        title=q.title,
        description=q.description,
        constraints=q.constraints,
        max_score=q.max_score,
        has_reference_solution=bool(q.reference_solution.strip()),
        reference_language=q.reference_language,
        deadline=q.deadline,
        created_at=q.created_at,
        target_count=len(subs),
        submitted_count=sum(1 for s in subs if s.status != CustomSubmissionStatus.not_started),
        graded_count=sum(1 for s in subs if s.status == CustomSubmissionStatus.graded),
    )


@router.post("", response_model=CustomQuestionOut, status_code=201)
def create_custom_question(
    payload: CustomQuestionCreate,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    if payload.scope == AssignmentScope.section and not payload.section_id:
        raise HTTPException(400, "Pick a section for a section-scoped question.")
    if payload.scope == AssignmentScope.students and not payload.student_ids:
        raise HTTPException(400, "Select at least one student.")
    if not payload.title.strip() or not payload.description.strip():
        raise HTTPException(400, "Title and problem statement are required.")

    question = CustomQuestion(
        teacher_id=teacher.id,
        title=payload.title,
        description=payload.description,
        constraints=payload.constraints,
        max_score=payload.max_score,
        reference_solution=payload.reference_solution,
        reference_language=payload.reference_language,
        scope=payload.scope,
        section_id=payload.section_id,
        assigned_date=payload.assigned_date,
        deadline=payload.deadline,
        created_at=datetime.now(timezone.utc).replace(tzinfo=None),
    )
    db.add(question)
    db.flush()

    if payload.scope == AssignmentScope.students:
        for sid in payload.student_ids:
            db.add(CustomQuestionTarget(question_id=question.id, student_id=sid))
        db.flush()

    target_ids = _resolve_target_student_ids(db, question)
    for sid in target_ids:
        db.add(
            CustomSubmission(
                question_id=question.id,
                student_id=sid,
                status=CustomSubmissionStatus.not_started,
            )
        )
    for sid in target_ids:
        db.add(
            Notification(
                user_id=sid,
                type="new_custom_question",
                message=f"New question from your teacher: '{question.title}' — due "
                f"{question.deadline.strftime('%b %d, %I:%M %p')}.",
            )
        )
    db.commit()
    db.refresh(question)
    return _to_question_out(db, question)


@router.get("", response_model=list[CustomQuestionOut])
def list_custom_questions(
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(CustomQuestion)
        .where(CustomQuestion.teacher_id == teacher.id)
        .order_by(CustomQuestion.created_at.desc())
    ).all()
    return [_to_question_out(db, q) for q in rows]


@router.delete("/{question_id}", status_code=204)
def delete_custom_question(
    question_id: int,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    q = _get_own_question(db, teacher, question_id)
    db.delete(q)
    db.commit()


class ReferenceSolutionUpdate(BaseModel):
    reference_solution: str
    reference_language: str = "python"


@router.patch("/{question_id}/reference-solution", response_model=CustomQuestionOut)
def set_reference_solution(
    question_id: int,
    payload: ReferenceSolutionUpdate,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Separate from question creation so a teacher can post the
    question first and add their own correct implementation later —
    AI-assist grading (below) stays locked out until this is set."""
    q = _get_own_question(db, teacher, question_id)
    q.reference_solution = payload.reference_solution
    q.reference_language = payload.reference_language
    db.commit()
    db.refresh(q)
    return _to_question_out(db, q)


# --------------------------------------------------------------------
# Teacher: view + grade submissions
# --------------------------------------------------------------------


class SubmissionOut(BaseModel):
    id: int
    student_id: int
    student_name: str
    code: str
    language: str
    submitted_at: datetime | None
    status: str
    ai_score: int | None
    ai_feedback: str
    ai_reviewed_at: datetime | None
    manual_score: int | None
    manual_feedback: str
    graded_at: datetime | None


def _to_submission_out(db: Session, s: CustomSubmission) -> SubmissionOut:
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == s.student_id))
    return SubmissionOut(
        id=s.id,
        student_id=s.student_id,
        student_name=profile.full_name if profile else "Unknown",
        code=s.code,
        language=s.language,
        submitted_at=s.submitted_at,
        status=s.status.value,
        ai_score=s.ai_score,
        ai_feedback=s.ai_feedback,
        ai_reviewed_at=s.ai_reviewed_at,
        manual_score=s.manual_score,
        manual_feedback=s.manual_feedback,
        graded_at=s.graded_at,
    )


@router.get("/{question_id}/submissions", response_model=list[SubmissionOut])
def list_submissions(
    question_id: int,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    q = _get_own_question(db, teacher, question_id)
    subs = db.scalars(
        select(CustomSubmission).where(CustomSubmission.question_id == q.id)
    ).all()
    return [_to_submission_out(db, s) for s in subs]


def _get_own_submission(
    db: Session, teacher: User, question_id: int, submission_id: int
) -> tuple[CustomQuestion, CustomSubmission]:
    q = _get_own_question(db, teacher, question_id)
    s = db.get(CustomSubmission, submission_id)
    if not s or s.question_id != q.id:
        raise HTTPException(404, "Submission not found.")
    return q, s


@router.post("/{question_id}/submissions/{submission_id}/ai-assist", response_model=SubmissionOut)
def ai_assist(
    question_id: int,
    submission_id: int,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    q, s = _get_own_submission(db, teacher, question_id, submission_id)
    if s.status == CustomSubmissionStatus.not_started:
        raise HTTPException(400, "This student hasn't submitted anything yet.")

    try:
        result = ai_assist_grade(db, q, s)
    except ValueError as e:
        raise HTTPException(400, str(e))
    except AssistantError as e:
        raise HTTPException(503, str(e))

    s.ai_score = result["suggested_score"]
    s.ai_feedback = result["suggested_feedback"]
    s.ai_reviewed_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()

    db.add(AIInteractionLog(student_id=s.student_id, message_count=1))
    db.commit()

    db.refresh(s)
    return _to_submission_out(db, s)


class GradeIn(BaseModel):
    score: int
    feedback: str = ""


@router.patch("/{question_id}/submissions/{submission_id}/grade", response_model=SubmissionOut)
def grade_submission(
    question_id: int,
    submission_id: int,
    payload: GradeIn,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    q, s = _get_own_submission(db, teacher, question_id, submission_id)
    if s.status == CustomSubmissionStatus.not_started:
        raise HTTPException(400, "This student hasn't submitted anything yet.")
    if payload.score < 0 or payload.score > q.max_score:
        raise HTTPException(400, f"Score must be between 0 and {q.max_score}.")

    s.manual_score = payload.score
    s.manual_feedback = payload.feedback
    s.graded_by = teacher.id
    s.graded_at = datetime.now(timezone.utc).replace(tzinfo=None)
    s.status = CustomSubmissionStatus.graded
    db.commit()

    db.add(
        Notification(
            user_id=s.student_id,
            type="custom_question_graded",
            message=f"Your teacher graded '{q.title}': {payload.score}/{q.max_score}.",
        )
    )
    db.commit()
    db.refresh(s)
    return _to_submission_out(db, s)


# --------------------------------------------------------------------
# Student: view assigned questions + submit
# --------------------------------------------------------------------


class MyQuestionOut(BaseModel):
    id: int
    title: str
    description: str
    constraints: str
    max_score: int
    deadline: datetime
    submission_status: str
    my_code: str
    my_language: str
    manual_score: int | None
    manual_feedback: str


def _my_submission(db: Session, student: User, question_id: int) -> CustomSubmission:
    s = db.scalar(
        select(CustomSubmission).where(
            CustomSubmission.question_id == question_id,
            CustomSubmission.student_id == student.id,
        )
    )
    if not s:
        raise HTTPException(404, "This question isn't assigned to you.")
    return s


@router.get("/my/list", response_model=list[MyQuestionOut])
def my_custom_questions(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    subs = db.scalars(
        select(CustomSubmission).where(CustomSubmission.student_id == student.id)
    ).all()
    out = []
    for s in subs:
        q = db.get(CustomQuestion, s.question_id)
        if not q:
            continue
        out.append(
            MyQuestionOut(
                id=q.id, title=q.title, description=q.description, constraints=q.constraints,
                max_score=q.max_score, deadline=q.deadline, submission_status=s.status.value,
                my_code=s.code, my_language=s.language,
                manual_score=s.manual_score, manual_feedback=s.manual_feedback,
            )
        )
    return sorted(out, key=lambda o: o.deadline)


class CustomSubmitIn(BaseModel):
    code: str
    language: str = "python"


@router.post("/my/{question_id}/submit", response_model=MyQuestionOut)
def submit_custom_question(
    question_id: int,
    payload: CustomSubmitIn,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    s = _my_submission(db, student, question_id)
    if s.status == CustomSubmissionStatus.graded:
        raise HTTPException(400, "This has already been graded — contact your teacher to resubmit.")
    if not payload.code.strip():
        raise HTTPException(400, "Submitted code can't be empty.")

    q = db.get(CustomQuestion, question_id)
    now = datetime.now(timezone.utc)
    if q and now > q.deadline.replace(tzinfo=timezone.utc):
        raise HTTPException(400, "The deadline for this question has passed.")

    s.code = payload.code
    s.language = payload.language
    s.submitted_at = now.replace(tzinfo=None)
    s.status = CustomSubmissionStatus.submitted
    db.commit()

    return MyQuestionOut(
        id=question_id, title=q.title if q else "", description=q.description if q else "",
        constraints=q.constraints if q else "", max_score=q.max_score if q else 0,
        deadline=q.deadline if q else now, submission_status=s.status.value,
        my_code=s.code, my_language=s.language,
        manual_score=s.manual_score, manual_feedback=s.manual_feedback,
    )
