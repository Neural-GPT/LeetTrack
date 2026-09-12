from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.assignment import Assignment, AssignmentTarget
from app.models.enums import Role, SubmissionStatus
from app.models.submission import Submission
from app.models.system import Notification
from app.models.user import StudentProfile, User
from app.services import leetcode_stats
from app.services.activity_log import log_event
from app.services.notifications import notify_display_name_changed
from app.services.submission_pipeline import poll_pending_submissions
from app.services.time_windows import WEEKEND_PROFILE_CHANGE_ERROR, is_ist_weekend

router = APIRouter(prefix="/api/students", tags=["students"])


class DashboardResponse(BaseModel):
    full_name: str
    email: str
    section: str | None
    leetcode_username: str | None
    github_username: str | None
    current_streak: int
    problems_solved: int
    assignment_completion_rate: float
    today_assignment_id: int | None


@router.get("/me/dashboard", response_model=DashboardResponse)
def my_dashboard(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))

    total_assignments = db.scalar(
        select(Submission).where(Submission.student_id == user.id)
    )
    submissions = db.scalars(
        select(Submission).where(Submission.student_id == user.id)
    ).all()
    solved = sum(1 for s in submissions if s.status == SubmissionStatus.accepted)
    completion_rate = (
        round(100 * solved / len(submissions), 1) if submissions else 0.0
    )

    today = datetime.now(timezone.utc).date()
    today_assignment = db.scalar(
        select(Assignment)
        .join(AssignmentTarget, isouter=True)
        .where(Assignment.assigned_date >= today)
        .order_by(Assignment.assigned_date.asc())
    )

    return DashboardResponse(
        full_name=profile.full_name if profile else user.username,
        email=user.email,
        section=profile.section.name if profile and profile.section else None,
        leetcode_username=profile.leetcode_username if profile else None,
        github_username=profile.github_username if profile and profile.github_username else None,
        current_streak=profile.current_streak if profile else 0,
        problems_solved=solved,
        assignment_completion_rate=completion_rate,
        today_assignment_id=today_assignment.id if today_assignment else None,
    )


class AssignmentStatusOut(BaseModel):
    assignment_id: int
    problem_title: str
    leetcode_url: str
    difficulty: str
    tags: list[str]
    problem_score: int
    notes: str
    hint: str
    release_time: str
    deadline: str
    status: str
    total_attempts: int
    accepted_at: str | None
    score: float
    allow_ai_help: bool


@router.get("/me/assignments", response_model=list[AssignmentStatusOut])
def my_assignments(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    Every assignment targeting this student, joined with their submission
    status. Powers the dashboard's today's-assignment card, weekly
    progress strip, recent activity feed, and upcoming deadlines — the
    frontend slices this one list by deadline/status client-side rather
    than needing four separate endpoints.
    """
    submissions = db.scalars(
        select(Submission)
        .where(Submission.student_id == user.id)
        .order_by(Submission.id.desc())
    ).all()

    results = []
    for sub in submissions:
        assignment = sub.assignment
        problem = assignment.problem
        results.append(
            AssignmentStatusOut(
                assignment_id=assignment.id,
                problem_title=problem.title,
                leetcode_url=problem.leetcode_url,
                difficulty=problem.difficulty.value,
                tags=[t for t in problem.tags.split(",") if t],
                problem_score=assignment.problem_score,
                notes=assignment.notes,
                hint=assignment.hint,
                release_time=assignment.release_time.isoformat(),
                deadline=assignment.deadline.isoformat(),
                status=sub.status.value,
                total_attempts=sub.total_attempts,
                accepted_at=sub.accepted_at.isoformat() if sub.accepted_at else None,
                score=sub.score,
                allow_ai_help=assignment.allow_ai_help,
            )
        )
    return results


class SettingsUpdate(BaseModel):
    theme: str | None = None
    leetcode_username: str | None = None
    github_username: str | None = None
    full_name: str | None = None
    notify_new_assignment: bool | None = None
    notify_deadline: bool | None = None
    notify_missed: bool | None = None
    notify_streak_broken: bool | None = None
    notify_weekly_results: bool | None = None
    notify_leaderboard: bool | None = None


# Fields gated to weekends (Sat-Sun, IST) — see services/time_windows.py.
# github_username follows the same rule as full_name (display name):
# weekend-only, with no "first connect is free" exemption like
# leetcode_username gets below. Everything else in SettingsUpdate
# (theme, notification toggles) is unrestricted and can change any day.
WEEKEND_GATED_FIELDS = {"leetcode_username", "full_name", "github_username"}


@router.patch("/me/settings")
def update_settings(
    payload: SettingsUpdate,
    user: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))

    updates = payload.model_dump(exclude_unset=True)

    # LeetCode username: the very first time a student links an account
    # (profile.leetcode_username currently empty) is allowed any day —
    # they need to be able to connect LeetCode right when they sign up,
    # not wait for a weekend. Only *changing* an already-connected
    # username is weekend-gated, same as display name.
    is_first_leetcode_connect = "leetcode_username" in updates and not profile.leetcode_username
    is_first_github_connect = "github_username" in updates and not profile.github_username
    gated_fields_touched = {
        field for field in updates
        if field in WEEKEND_GATED_FIELDS
        and not (field == "leetcode_username" and is_first_leetcode_connect)
        and not (field == "github_username" and is_first_github_connect)
    }
    if gated_fields_touched and not is_ist_weekend():
        raise HTTPException(403, WEEKEND_PROFILE_CHANGE_ERROR)

    if "leetcode_username" in updates and updates["leetcode_username"]:
        taken = db.scalar(
            select(StudentProfile).where(
                StudentProfile.leetcode_username == updates["leetcode_username"],
                StudentProfile.user_id != user.id,
            )
        )
        if taken:
            raise HTTPException(400, "That LeetCode username is already linked to another account.")

    old_full_name = profile.full_name
    new_full_name = updates.get("full_name")

    for field, value in updates.items():
        setattr(profile, field, value)
    db.commit()

    if new_full_name and new_full_name != old_full_name:
        notify_display_name_changed(db, old_full_name, new_full_name)
        log_event(
            db, user.id, "display_name_changed",
            meta={"from": old_full_name, "to": new_full_name},
        )
    if "leetcode_username" in updates:
        log_event(
            db, user.id, "leetcode_username_changed",
            meta={"to": updates["leetcode_username"]},
        )

    return {"updated": True}


class NotificationOut(BaseModel):
    id: int
    type: str
    message: str
    read: bool
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/me/notifications", response_model=list[NotificationOut])
def my_notifications(
    unread_only: bool = False,
    user: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    query = select(Notification).where(Notification.user_id == user.id)
    if unread_only:
        query = query.where(Notification.read.is_(False))
    query = query.order_by(Notification.created_at.desc())

    return [
        NotificationOut(
            id=n.id,
            type=n.type,
            message=n.message,
            read=n.read,
            created_at=n.created_at.isoformat(),
        )
        for n in db.scalars(query).all()
    ]


@router.post("/me/notifications/{notification_id}/read")
def mark_notification_read(
    notification_id: int,
    user: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    notification = db.get(Notification, notification_id)
    if not notification or notification.user_id != user.id:
        return {"updated": False}
    notification.read = True
    db.commit()
    return {"updated": True}


class LeetCodeScoreOut(BaseModel):
    easy_solved: int
    medium_solved: int
    hard_solved: int
    total_solved: int
    score: int


@router.get("/me/leetcode-score", response_model=LeetCodeScoreOut)
def my_leetcode_score(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    Powers the glowing score badge on the sidebar — score = 1*easy +
    2*medium + 3*hard, across the student's ENTIRE LeetCode history (not
    just assignment-linked solves). Cached with a 15-minute TTL; see
    services/leetcode_stats.py.
    """
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if not profile or not profile.leetcode_username:
        return LeetCodeScoreOut(
            easy_solved=0, medium_solved=0, hard_solved=0, total_solved=0, score=0
        )

    counts = leetcode_stats.get_cached_or_refresh(db, profile)
    return LeetCodeScoreOut(
        easy_solved=counts.easy,
        medium_solved=counts.medium,
        hard_solved=counts.hard,
        total_solved=counts.total,
        score=counts.score,
    )


class OnlineCountOut(BaseModel):
    count: int


@router.get("/online-count", response_model=OnlineCountOut)
def online_count(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """
    Students "online" = touched an authenticated endpoint in the last 5
    minutes (see api/deps.py). Not real presence (no disconnect
    detection, no websocket) — a reasonable approximation without
    building a whole presence subsystem.
    """
    window_start = (datetime.now(timezone.utc) - timedelta(minutes=5)).replace(tzinfo=None)
    count = db.scalar(
        select(func.count(User.id)).where(
            User.role == Role.student,
            User.last_seen_at.isnot(None),
            User.last_seen_at >= window_start,
        )
    )
    return OnlineCountOut(count=count or 0)


class RefreshSubmissionsOut(BaseModel):
    checked: int
    newly_accepted: int


@router.post("/me/refresh-submissions", response_model=RefreshSubmissionsOut)
def refresh_my_submissions(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    On-demand recheck for this student only — the "Check for updates"
    button on the dashboard. Without this, a student who solves a
    problem has to wait for the next Celery beat cycle (every 5 minutes,
    and only if Celery/Redis is actually running) before it shows up.
    Scoped to one student so it's fast and doesn't hammer LeetCode's API
    on behalf of everyone.
    """
    result = poll_pending_submissions(db, student_id=user.id)
    log_event(db, user.id, "manual_refresh", meta=result)
    return RefreshSubmissionsOut(**result)
