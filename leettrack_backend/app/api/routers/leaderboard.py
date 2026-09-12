from datetime import datetime, timedelta, timezone
from typing import Literal

from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user
from app.db.session import get_db
from app.models.enums import SubmissionStatus
from app.models.submission import Submission
from app.models.user import StudentProfile, User
from app.services import leetcode_stats
from app.services.scoring import LeaderboardScore, aggregate_leaderboard

router = APIRouter(prefix="/api/leaderboard", tags=["leaderboard"])

Scope = Literal["overall", "section"]
TimeRange = Literal["overall", "last_two_weeks"]
# Just these two, per spec — "Assignment Score" (the P/T/A/X/M formula,
# see services/scoring.py) and "LeetCode Score" (1*easy + 2*medium +
# 3*hard across the student's whole LeetCode history, not just
# assignments — see services/leetcode_stats.py).
RankingBasis = Literal["assignment_score", "leetcode_score"]


class LeaderboardEntry(BaseModel):
    rank: int
    student_id: int
    full_name: str
    score: float
    # Always shown regardless of ranking_basis — total LeetCode solves,
    # not just ones tied to a LeetTrack assignment.
    total_problems_solved: int
    assignments_completed: int


@router.get("", response_model=list[LeaderboardEntry])
def get_leaderboard(
    scope: Scope = "overall",
    time_range: TimeRange = "overall",
    ranking_basis: RankingBasis = "assignment_score",
    section_id: int | None = None,
    db: Session = Depends(get_db),
    user: User = Depends(get_current_user),
):
    since = None
    if time_range == "last_two_weeks":
        since = datetime.now(timezone.utc) - timedelta(days=14)

    profiles_q = select(StudentProfile)
    if scope == "section" and section_id:
        profiles_q = profiles_q.where(StudentProfile.section_id == section_id)
    profiles = db.scalars(profiles_q).all()

    entries: list[LeaderboardScore] = []
    total_solved_by_student: dict[int, int] = {}

    for profile in profiles:
        subs_q = select(Submission).where(
            Submission.student_id == profile.user_id,
            Submission.status == SubmissionStatus.accepted,
        )
        if since:
            subs_q = subs_q.where(Submission.accepted_at >= since)
        subs = db.scalars(subs_q).all()

        # Always computed, regardless of ranking_basis — this is the
        # "shown on the left of score no matter what filter" column.
        counts = leetcode_stats.get_cached_or_refresh(db, profile)
        total_solved_by_student[profile.user_id] = counts.total

        if ranking_basis == "leetcode_score":
            basis_score = float(counts.score)
        else:
            basis_score = sum(s.score for s in subs)

        entries.append(
            LeaderboardScore(
                student_id=profile.user_id,
                total_score=basis_score,
                problems_completed=len(subs),
                assignments_completed=len(subs),
            )
        )

    entries = aggregate_leaderboard(entries)
    id_to_name = {p.user_id: p.full_name for p in profiles}

    return [
        LeaderboardEntry(
            rank=i + 1,
            student_id=e.student_id,
            full_name=id_to_name.get(e.student_id, "Unknown"),
            score=e.total_score,
            total_problems_solved=total_solved_by_student.get(e.student_id, 0),
            assignments_completed=e.assignments_completed,
        )
        for i, e in enumerate(entries)
    ]
