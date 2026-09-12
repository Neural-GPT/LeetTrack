from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Assignment, AssignmentTarget, Problem
from app.models.enums import AssignmentScope, Difficulty, Role, SubmissionStatus
from app.models.submission import Submission
from app.models.user import User
from app.services.assignment_targeting import (
    resolve_target_student_ids,
    slug_from_leetcode_url,
)
from app.services.notifications import notify_new_assignment

router = APIRouter(prefix="/api/assignments", tags=["assignments"])


class ProblemIn(BaseModel):
    title: str
    leetcode_url: str
    difficulty: Difficulty
    tags: list[str] = []


class AssignmentCreate(BaseModel):
    problem: ProblemIn
    scope: AssignmentScope
    section_id: int | None = None
    student_ids: list[int] = []
    assigned_date: datetime
    release_time: datetime
    deadline: datetime
    notes: str = ""
    hint: str = ""
    problem_score: int = 10
    allow_ai_help: bool = False


class AssignmentOut(BaseModel):
    id: int
    problem_title: str
    difficulty: Difficulty
    deadline: datetime
    problem_score: int
    allow_ai_help: bool

    model_config = {"from_attributes": True}


@router.post("", response_model=AssignmentOut, status_code=201)
def create_assignment(
    payload: AssignmentCreate,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    if payload.scope == AssignmentScope.section and not payload.section_id:
        raise HTTPException(400, "Pick a section for a section-scoped assignment.")
    if payload.scope == AssignmentScope.students and not payload.student_ids:
        raise HTTPException(400, "Select at least one student.")

    if payload.deadline <= payload.release_time:
        raise HTTPException(400, "Deadline has to be after the release time.")

    problem = Problem(
        title=payload.problem.title,
        leetcode_url=payload.problem.leetcode_url,
        slug=slug_from_leetcode_url(payload.problem.leetcode_url),
        difficulty=payload.problem.difficulty,
        tags=",".join(payload.problem.tags),
    )
    db.add(problem)
    db.flush()

    assignment = Assignment(
        problem_id=problem.id,
        teacher_id=teacher.id,
        scope=payload.scope,
        section_id=payload.section_id,
        assigned_date=payload.assigned_date,
        release_time=payload.release_time,
        deadline=payload.deadline,
        notes=payload.notes,
        hint=payload.hint,
        problem_score=payload.problem_score,
        allow_ai_help=payload.allow_ai_help,
    )
    db.add(assignment)
    db.flush()

    if payload.scope == AssignmentScope.students:
        for sid in payload.student_ids:
            db.add(AssignmentTarget(assignment_id=assignment.id, student_id=sid))
        db.flush()  # AssignmentTarget rows need to exist before resolving targets

    target_student_ids = resolve_target_student_ids(db, assignment)
    for student_id in target_student_ids:
        db.add(
            Submission(
                assignment_id=assignment.id,
                student_id=student_id,
                status=SubmissionStatus.not_started,
            )
        )

    db.commit()
    db.refresh(assignment)
    notify_new_assignment(db, assignment, target_student_ids)

    return AssignmentOut(
        id=assignment.id,
        problem_title=problem.title,
        difficulty=problem.difficulty,
        deadline=assignment.deadline,
        problem_score=assignment.problem_score,
        allow_ai_help=assignment.allow_ai_help,
    )


@router.get("", response_model=list[AssignmentOut])
def list_assignments(
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    rows = db.scalars(
        select(Assignment).where(Assignment.teacher_id == teacher.id)
    ).all()
    return [
        AssignmentOut(
            id=a.id,
            problem_title=a.problem.title,
            difficulty=a.problem.difficulty,
            deadline=a.deadline,
            problem_score=a.problem_score,
            allow_ai_help=a.allow_ai_help,
        )
        for a in rows
    ]


@router.delete("/{assignment_id}", status_code=204)
def delete_assignment(
    assignment_id: int,
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    assignment = db.get(Assignment, assignment_id)
    if not assignment or assignment.teacher_id != teacher.id:
        raise HTTPException(404, "Assignment not found.")
    db.delete(assignment)
    db.commit()
