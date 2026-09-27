from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Problem
from app.models.contest import ContestAttempt
from app.models.enums import ContestAttemptStatus, Role
from app.models.system import AIInteractionLog
from app.models.user import StudentProfile, User
from app.services import contest_simulator, skill_analysis
from app.services.ai_assistant import IMPROVEMENT_SUGGESTIONS_PROMPT, AssistantError, complete

router = APIRouter(prefix="/api/student-analytics", tags=["student-analytics"])


def _get_profile(db: Session, user: User) -> StudentProfile:
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if not profile:
        raise HTTPException(404, "Student profile not found.")
    return profile


# --------------------------------------------------------------------
# Skills graph + performance summary + weak skills
# --------------------------------------------------------------------


class TagStatOut(BaseModel):
    tag: str
    attempted: int
    accepted: int
    completion_rate: float
    avg_attempts: float
    avg_score: float
    mastery: float
    sample_size_ok: bool


@router.get("/skills-graph", response_model=list[TagStatOut])
def get_skills_graph(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    graph = skill_analysis.compute_skill_graph(db, student.id)
    return [
        TagStatOut(
            tag=t.tag, attempted=t.attempted, accepted=t.accepted,
            completion_rate=t.completion_rate, avg_attempts=t.avg_attempts,
            avg_score=t.avg_score, mastery=t.mastery, sample_size_ok=t.sample_size_ok,
        )
        for t in graph
    ]


@router.get("/weak-skills", response_model=list[TagStatOut])
def get_weak_skills(
    limit: int = 5,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    weak = skill_analysis.compute_weak_skills(db, student.id, limit=limit)
    return [
        TagStatOut(
            tag=t.tag, attempted=t.attempted, accepted=t.accepted,
            completion_rate=t.completion_rate, avg_attempts=t.avg_attempts,
            avg_score=t.avg_score, mastery=t.mastery, sample_size_ok=t.sample_size_ok,
        )
        for t in weak
    ]


class WeeklyPointOut(BaseModel):
    week_start: str
    solved: int
    avg_score: float


class PerformanceSummaryOut(BaseModel):
    total_assigned: int
    total_accepted: int
    total_missed: int
    overall_completion_rate: float
    avg_score: float
    current_streak: int
    max_streak: int
    weekly_trend: list[WeeklyPointOut]
    trend_direction: str


@router.get("/performance-summary", response_model=PerformanceSummaryOut)
def get_performance_summary(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    profile = _get_profile(db, student)
    summary = skill_analysis.compute_performance_summary(
        db, student.id, profile.current_streak, profile.longest_streak
    )
    return PerformanceSummaryOut(
        total_assigned=summary.total_assigned,
        total_accepted=summary.total_accepted,
        total_missed=summary.total_missed,
        overall_completion_rate=summary.overall_completion_rate,
        avg_score=summary.avg_score,
        current_streak=summary.current_streak,
        max_streak=summary.max_streak,
        weekly_trend=[
            WeeklyPointOut(week_start=p.week_start, solved=p.solved, avg_score=p.avg_score)
            for p in summary.weekly_trend
        ],
        trend_direction=summary.trend_direction,
    )


class SuggestionsOut(BaseModel):
    suggestions: str


@router.post("/ai-suggestions", response_model=SuggestionsOut)
def generate_ai_suggestions(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    On-demand (button click on the frontend, not auto-loaded) rather
    than cached/scheduled — this is a one-shot AI call same as the AI
    Chat feature, so it's gated the same way (needs an active NVIDIA
    key) and logged the same way for the Data Center export.
    """
    profile = _get_profile(db, student)
    graph = skill_analysis.compute_skill_graph(db, student.id)
    summary = skill_analysis.compute_performance_summary(
        db, student.id, profile.current_streak, profile.longest_streak
    )
    weak = [t for t in graph if t.sample_size_ok][:3] or graph[:3]

    if not graph:
        return SuggestionsOut(
            suggestions="Not enough solved or attempted assignments yet to generate a "
            "meaningful analysis — come back after a few more assignments."
        )

    payload = {
        "overall_completion_rate": summary.overall_completion_rate,
        "avg_score": summary.avg_score,
        "current_streak": summary.current_streak,
        "trend_direction": summary.trend_direction,
        "weekly_solved_counts": [p.solved for p in summary.weekly_trend],
        "weakest_topics": [
            {"tag": t.tag, "completion_rate": t.completion_rate, "avg_attempts": t.avg_attempts}
            for t in weak
        ],
        "all_topics": [
            {"tag": t.tag, "completion_rate": t.completion_rate, "attempted": t.attempted}
            for t in graph
        ],
    }

    try:
        text = complete(db, IMPROVEMENT_SUGGESTIONS_PROMPT, str(payload))
    except AssistantError as e:
        raise HTTPException(503, str(e))

    db.add(AIInteractionLog(student_id=student.id, message_count=1))
    db.commit()

    return SuggestionsOut(suggestions=text.strip())


# --------------------------------------------------------------------
# Contest simulator
# --------------------------------------------------------------------


class ContestProblemOut(BaseModel):
    attempt_id: int
    problem_title: str
    leetcode_url: str
    difficulty: str
    tags: str
    skill_tag: str
    started_at: str
    deadline_at: str
    time_limit_seconds: int


def _to_problem_out(attempt: ContestAttempt) -> ContestProblemOut:
    p = attempt.problem
    return ContestProblemOut(
        attempt_id=attempt.id,
        problem_title=p.title,
        leetcode_url=p.leetcode_url,
        difficulty=p.difficulty.value,
        tags=p.tags,
        skill_tag=attempt.skill_tag,
        started_at=attempt.started_at.isoformat(),
        deadline_at=attempt.deadline_at.isoformat(),
        time_limit_seconds=attempt.time_limit_seconds,
    )


@router.post("/contest/start", response_model=ContestProblemOut)
def start_contest(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    # Don't let a student stack multiple concurrent attempts — resume
    # the existing in-progress one instead of picking a new problem.
    existing = db.scalar(
        select(ContestAttempt).where(
            ContestAttempt.student_id == student.id,
            ContestAttempt.status == ContestAttemptStatus.in_progress,
        )
    )
    if existing:
        now = datetime.now(timezone.utc)
        deadline = existing.deadline_at.replace(tzinfo=timezone.utc)
        if now < deadline:
            return _to_problem_out(existing)
        existing.status = ContestAttemptStatus.expired
        db.commit()

    picked = skill_analysis.pick_contest_problem(db, student.id)
    if not picked:
        raise HTTPException(
            404, "No problems exist in the system yet — ask a teacher to create an assignment first."
        )
    problem, skill_tag = picked

    now = datetime.now(timezone.utc)
    time_limit = skill_analysis.time_limit_for_difficulty(problem.difficulty.value)
    attempt = ContestAttempt(
        student_id=student.id,
        problem_id=problem.id,
        skill_tag=skill_tag,
        started_at=now.replace(tzinfo=None),
        time_limit_seconds=time_limit,
        deadline_at=(now + timedelta(seconds=time_limit)).replace(tzinfo=None),
        status=ContestAttemptStatus.in_progress,
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return _to_problem_out(attempt)


class ContestSubmitIn(BaseModel):
    code: str
    language: str = "python"


class ContestResultOut(BaseModel):
    attempt_id: int
    status: str
    score: int | None = None
    verdict: str = ""
    complexity_estimate: str = ""
    feedback: str = ""
    time_taken_seconds: int | None = None


def _get_own_attempt(db: Session, student: User, attempt_id: int) -> ContestAttempt:
    attempt = db.get(ContestAttempt, attempt_id)
    if not attempt or attempt.student_id != student.id:
        raise HTTPException(404, "Contest attempt not found.")
    return attempt


@router.post("/contest/{attempt_id}/submit", response_model=ContestResultOut)
def submit_contest(
    attempt_id: int,
    body: ContestSubmitIn,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    attempt = _get_own_attempt(db, student, attempt_id)
    if attempt.status != ContestAttemptStatus.in_progress:
        raise HTTPException(400, "This contest attempt has already been submitted or expired.")
    if not body.code.strip():
        raise HTTPException(400, "Submitted code can't be empty.")

    now = datetime.now(timezone.utc)
    deadline = attempt.deadline_at.replace(tzinfo=timezone.utc)
    if now > deadline:
        attempt.status = ContestAttemptStatus.expired
        db.commit()
        raise HTTPException(400, "Time's up — this attempt expired before you submitted.")

    started = attempt.started_at.replace(tzinfo=timezone.utc)
    attempt.code = body.code
    attempt.language = body.language
    attempt.submitted_at = now.replace(tzinfo=None)
    attempt.time_taken_seconds = int((now - started).total_seconds())
    attempt.status = ContestAttemptStatus.submitted
    db.commit()

    reference = None
    try:
        reference = contest_simulator.get_or_generate_reference_solution(db, attempt.problem)
    except AssistantError:
        pass  # judge_submission handles a missing reference gracefully

    try:
        result = contest_simulator.judge_submission(
            db, attempt.problem, reference, attempt.code, attempt.language
        )
    except AssistantError as e:
        # Leave status at "submitted" (not "graded") so the student can
        # retry grading later rather than losing their submission.
        raise HTTPException(503, f"Couldn't reach the AI grader: {e}")

    attempt.ai_score = result["score"]
    attempt.verdict = result["verdict"]
    attempt.ai_feedback = result["feedback"]
    attempt.status = ContestAttemptStatus.graded
    db.commit()

    db.add(AIInteractionLog(student_id=student.id, message_count=1))
    db.commit()

    return ContestResultOut(
        attempt_id=attempt.id,
        status=attempt.status.value,
        score=attempt.ai_score,
        verdict=attempt.verdict,
        complexity_estimate=result["complexity_estimate"],
        feedback=attempt.ai_feedback,
        time_taken_seconds=attempt.time_taken_seconds,
    )


@router.get("/contest/{attempt_id}", response_model=ContestResultOut)
def get_contest_attempt(
    attempt_id: int,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    attempt = _get_own_attempt(db, student, attempt_id)
    return ContestResultOut(
        attempt_id=attempt.id,
        status=attempt.status.value,
        score=attempt.ai_score,
        verdict=attempt.verdict,
        feedback=attempt.ai_feedback,
        time_taken_seconds=attempt.time_taken_seconds,
    )


class ContestHistoryItemOut(BaseModel):
    attempt_id: int
    problem_title: str
    skill_tag: str
    difficulty: str
    status: str
    score: int | None
    verdict: str
    started_at: str


@router.get("/contest/history/list", response_model=list[ContestHistoryItemOut])
def contest_history(
    student: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    attempts = db.scalars(
        select(ContestAttempt)
        .where(ContestAttempt.student_id == student.id)
        .order_by(ContestAttempt.started_at.desc())
        .limit(50)
    ).all()
    return [
        ContestHistoryItemOut(
            attempt_id=a.id,
            problem_title=a.problem.title,
            skill_tag=a.skill_tag,
            difficulty=a.problem.difficulty.value,
            status=a.status.value,
            score=a.ai_score,
            verdict=a.verdict,
            started_at=a.started_at.isoformat(),
        )
        for a in attempts
    ]
