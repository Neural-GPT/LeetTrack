"""
Weekly goals + digest for the student gamification system.

A "week" is Monday 00:00 (UTC) through the following Monday — matches
Python's Monday-start week convention, so "this week" always means the
same span a goal was set against.

The weekly leaderboard/rank figures mirror
app/api/routers/leaderboard.py's own time-windowed query (same
Assignment Score basis, same tz-aware `>=` comparison against
Submission.accepted_at — that pattern is already proven working there),
just fixed to "since this Monday" instead of "last two weeks".
"""

from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import SubmissionStatus
from app.models.gamification import WeeklyGoal
from app.models.submission import Submission
from app.models.user import StudentProfile, User
from app.services.gamification import XP_PER_EASY, XP_PER_HARD, XP_PER_MEDIUM
from app.services.scoring import LeaderboardScore, aggregate_leaderboard

_DIFFICULTY_XP = {"Easy": XP_PER_EASY, "Medium": XP_PER_MEDIUM, "Hard": XP_PER_HARD}


def current_week_start(today: date | None = None) -> date:
    d = today or datetime.now(timezone.utc).date()
    return d - timedelta(days=d.weekday())  # Monday


def get_weekly_goal(db: Session, user_id: int, week_start: date) -> WeeklyGoal | None:
    return db.scalar(
        select(WeeklyGoal).where(
            WeeklyGoal.user_id == user_id, WeeklyGoal.week_start == week_start
        )
    )


def set_weekly_goal(
    db: Session, user_id: int, week_start: date, target_type: str, target_value: float
) -> WeeklyGoal:
    goal = get_weekly_goal(db, user_id, week_start)
    if goal:
        goal.target_type = target_type
        goal.target_value = target_value
    else:
        goal = WeeklyGoal(
            user_id=user_id, week_start=week_start,
            target_type=target_type, target_value=target_value,
        )
        db.add(goal)
    db.commit()
    db.refresh(goal)
    return goal


@dataclass
class WeeklyStudentStats:
    problems_solved: int
    xp_earned: int


def _week_stats_for_student(db: Session, user_id: int, week_start_dt: datetime) -> WeeklyStudentStats:
    subs = db.scalars(
        select(Submission).where(
            Submission.student_id == user_id,
            Submission.status == SubmissionStatus.accepted,
            Submission.accepted_at >= week_start_dt,
        )
    ).all()
    xp = sum(_DIFFICULTY_XP.get(s.assignment.problem.difficulty.value, 0) for s in subs)
    return WeeklyStudentStats(problems_solved=len(subs), xp_earned=xp)


@dataclass
class WeeklyLeaderboardEntry:
    student_id: int
    full_name: str
    score: float
    problems_solved: int


def _weekly_leaderboard(db: Session, week_start_dt: datetime) -> list[WeeklyLeaderboardEntry]:
    profiles = db.scalars(select(StudentProfile)).all()
    entries: list[LeaderboardScore] = []
    id_to_name: dict[int, str] = {}
    id_to_solved: dict[int, int] = {}

    for profile in profiles:
        subs = db.scalars(
            select(Submission).where(
                Submission.student_id == profile.user_id,
                Submission.status == SubmissionStatus.accepted,
                Submission.accepted_at >= week_start_dt,
            )
        ).all()
        id_to_name[profile.user_id] = profile.full_name
        id_to_solved[profile.user_id] = len(subs)
        entries.append(
            LeaderboardScore(
                student_id=profile.user_id,
                total_score=sum(s.score for s in subs),
                problems_completed=len(subs),
                assignments_completed=len(subs),
            )
        )

    ranked = aggregate_leaderboard(entries)
    return [
        WeeklyLeaderboardEntry(
            student_id=e.student_id,
            full_name=id_to_name.get(e.student_id, "Unknown"),
            score=e.total_score,
            problems_solved=id_to_solved.get(e.student_id, 0),
        )
        for e in ranked
    ]


@dataclass
class WeeklyDigest:
    week_start: str
    goal_target_type: str | None
    goal_target_value: float | None
    goal_progress: float  # problems solved or xp earned, matching target_type
    goal_met: bool
    problems_solved_this_week: int
    xp_earned_this_week: int
    leaderboard_topper_name: str | None
    leaderboard_topper_score: float | None
    my_rank: int | None
    my_score: float | None
    class_size: int


def compute_weekly_digest(db: Session, user: User) -> WeeklyDigest:
    week_start = current_week_start()
    week_start_dt = datetime(
        week_start.year, week_start.month, week_start.day, tzinfo=timezone.utc
    )

    goal = get_weekly_goal(db, user.id, week_start)
    my_stats = _week_stats_for_student(db, user.id, week_start_dt)

    goal_progress = 0.0
    goal_met = False
    if goal:
        goal_progress = (
            my_stats.problems_solved if goal.target_type == "problems" else my_stats.xp_earned
        )
        goal_met = goal_progress >= goal.target_value

    leaderboard = _weekly_leaderboard(db, week_start_dt)
    topper = leaderboard[0] if leaderboard else None
    my_rank = None
    my_score = None
    for i, entry in enumerate(leaderboard):
        if entry.student_id == user.id:
            my_rank = i + 1
            my_score = entry.score
            break

    return WeeklyDigest(
        week_start=week_start.isoformat(),
        goal_target_type=goal.target_type if goal else None,
        goal_target_value=goal.target_value if goal else None,
        goal_progress=goal_progress,
        goal_met=goal_met,
        problems_solved_this_week=my_stats.problems_solved,
        xp_earned_this_week=my_stats.xp_earned,
        leaderboard_topper_name=topper.full_name if topper else None,
        leaderboard_topper_score=topper.score if topper else None,
        my_rank=my_rank,
        my_score=my_score,
        class_size=len(leaderboard),
    )
