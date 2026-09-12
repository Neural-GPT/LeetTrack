from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Assignment, Problem
from app.models.enums import Role, SubmissionStatus
from app.models.submission import Submission
from app.models.user import StudentProfile, User

router = APIRouter(prefix="/api/analytics", tags=["analytics"])


class SectionOverview(BaseModel):
    section_id: int | None
    student_count: int
    avg_completion_rate: float
    avg_score: float


@router.get("/section-overview", response_model=list[SectionOverview])
def section_overview(
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """One row per section: how the class is doing, at a glance."""
    profiles = db.scalars(select(StudentProfile)).all()
    by_section: dict[int | None, list[StudentProfile]] = {}
    for p in profiles:
        by_section.setdefault(p.section_id, []).append(p)

    results = []
    for section_id, section_profiles in by_section.items():
        student_ids = [p.user_id for p in section_profiles]
        subs = db.scalars(
            select(Submission).where(Submission.student_id.in_(student_ids))
        ).all()

        if subs:
            accepted = [s for s in subs if s.status == SubmissionStatus.accepted]
            completion_rate = round(100 * len(accepted) / len(subs), 1)
            avg_score = round(sum(s.score for s in accepted) / len(section_profiles), 1)
        else:
            completion_rate = 0.0
            avg_score = 0.0

        results.append(
            SectionOverview(
                section_id=section_id,
                student_count=len(section_profiles),
                avg_completion_rate=completion_rate,
                avg_score=avg_score,
            )
        )

    return results


class ProblemDifficulty(BaseModel):
    assignment_id: int
    problem_title: str
    target_count: int
    accepted_count: int
    completion_rate: float
    avg_attempts: float


@router.get("/hardest-assignments", response_model=list[ProblemDifficulty])
def hardest_assignments(
    limit: int = Query(10, ge=1, le=50),
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Assignments with the lowest completion rate — where the class is struggling."""
    assignments = db.scalars(
        select(Assignment).where(Assignment.teacher_id == teacher.id)
    ).all()

    rows = []
    for a in assignments:
        subs = db.scalars(
            select(Submission).where(Submission.assignment_id == a.id)
        ).all()
        if not subs:
            continue
        accepted = [s for s in subs if s.status == SubmissionStatus.accepted]
        rows.append(
            ProblemDifficulty(
                assignment_id=a.id,
                problem_title=a.problem.title,
                target_count=len(subs),
                accepted_count=len(accepted),
                completion_rate=round(100 * len(accepted) / len(subs), 1),
                avg_attempts=round(
                    sum(s.total_attempts for s in subs) / len(subs), 1
                ),
            )
        )

    rows.sort(key=lambda r: r.completion_rate)
    return rows[:limit]


class TopicWeakness(BaseModel):
    tag: str
    assignments_count: int
    avg_completion_rate: float


@router.get("/topic-weaknesses", response_model=list[TopicWeakness])
def topic_weaknesses(
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Which DSA topics (tags) the class completes least often — surfaces
    where extra practice sets or lecture time would help most.
    """
    assignments = db.scalars(
        select(Assignment).where(Assignment.teacher_id == teacher.id)
    ).all()

    tag_stats: dict[str, list[float]] = {}
    for a in assignments:
        subs = db.scalars(
            select(Submission).where(Submission.assignment_id == a.id)
        ).all()
        if not subs:
            continue
        accepted = sum(1 for s in subs if s.status == SubmissionStatus.accepted)
        rate = 100 * accepted / len(subs)

        for tag in filter(None, a.problem.tags.split(",")):
            tag_stats.setdefault(tag.strip(), []).append(rate)

    results = [
        TopicWeakness(
            tag=tag,
            assignments_count=len(rates),
            avg_completion_rate=round(sum(rates) / len(rates), 1),
        )
        for tag, rates in tag_stats.items()
    ]
    results.sort(key=lambda r: r.avg_completion_rate)
    return results


class StudentEngagement(BaseModel):
    student_id: int
    full_name: str
    current_streak: int
    problems_solved: int
    last_active: str | None


@router.get("/at-risk-students", response_model=list[StudentEngagement])
def at_risk_students(
    min_completion_rate: float = Query(50.0),
    teacher: User = Depends(require_role(Role.teacher, Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Students whose completion rate has dropped below a threshold — for early outreach."""
    profiles = db.scalars(select(StudentProfile)).all()

    results = []
    for p in profiles:
        subs = db.scalars(
            select(Submission).where(Submission.student_id == p.user_id)
        ).all()
        if not subs:
            continue
        accepted = sum(1 for s in subs if s.status == SubmissionStatus.accepted)
        rate = 100 * accepted / len(subs)
        if rate < min_completion_rate:
            results.append(
                StudentEngagement(
                    student_id=p.user_id,
                    full_name=p.full_name,
                    current_streak=p.current_streak,
                    problems_solved=accepted,
                    last_active=p.last_solved_date.isoformat()
                    if p.last_solved_date
                    else None,
                )
            )

    results.sort(key=lambda r: r.problems_solved)
    return results
