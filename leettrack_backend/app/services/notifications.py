"""
Creates Notification rows for the events the spec calls out: deadline
reminders and broken streaks. (New-assignment and weekly-results
notifications are created at the point those events happen — assignment
creation, weekly digest job — rather than polled for here.)

Actual delivery (push/email/websocket) isn't wired up — these just write
rows a future delivery worker or the frontend's notification bell can
read via a GET /api/students/me/notifications endpoint.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.assignment import Assignment
from app.models.enums import Role, SubmissionStatus
from app.models.submission import Submission
from app.models.system import BroadcastMessage, Notification
from app.models.user import StudentProfile, User


def create_deadline_reminders(db: Session, hours_before: int = 3) -> int:
    """Notify students with an unsolved assignment due within `hours_before` hours."""
    now = datetime.now(timezone.utc)
    window_end = now + timedelta(hours=hours_before)

    upcoming = db.scalars(
        select(Assignment).where(
            Assignment.deadline > now, Assignment.deadline <= window_end
        )
    ).all()

    created = 0
    for assignment in upcoming:
        pending = db.scalars(
            select(Submission).where(
                Submission.assignment_id == assignment.id,
                Submission.status.in_(
                    [SubmissionStatus.not_started, SubmissionStatus.attempted]
                ),
            )
        ).all()
        for sub in pending:
            db.add(
                Notification(
                    user_id=sub.student_id,
                    type="deadline",
                    message=f"'{assignment.problem.title}' is due soon: "
                    f"{assignment.deadline.strftime('%I:%M %p')}.",
                )
            )
            created += 1

    db.commit()
    return created


def check_broken_streaks(db: Session) -> int:
    """Notify students whose streak just lapsed (no accept yesterday)."""
    yesterday = (datetime.now(timezone.utc) - timedelta(days=1)).date()

    profiles = db.scalars(
        select(StudentProfile).where(StudentProfile.current_streak > 0)
    ).all()

    created = 0
    for profile in profiles:
        last = profile.last_solved_date.date() if profile.last_solved_date else None
        if last and last < yesterday:
            db.add(
                Notification(
                    user_id=profile.user_id,
                    type="streak_broken",
                    message=f"Your {profile.current_streak}-day streak ended: "
                    "solve something today to start a new one.",
                )
            )
            profile.current_streak = 0
            created += 1

    db.commit()
    return created


def notify_new_assignment(db: Session, assignment: Assignment, student_ids: list[int]) -> None:
    for sid in student_ids:
        db.add(
            Notification(
                user_id=sid,
                type="new_assignment",
                message=f"New assignment: '{assignment.problem.title}': "
                f"due {assignment.deadline.strftime('%b %d, %I:%M %p')}.",
            )
        )
    db.commit()


def notify_display_name_changed(db: Session, old_name: str, new_name: str) -> None:
    """
    Every teacher and Super Admin gets a notification when a student
    changes their display name — teachers rely on that name to match a
    student against their class roster, so a silent rename could
    otherwise look like a student vanishing.
    """
    staff_ids = db.scalars(
        select(User.id).where(User.role.in_([Role.teacher, Role.super_admin]))
    ).all()
    message = f"A student changed their display name: '{old_name}' -> '{new_name}'."
    for uid in staff_ids:
        db.add(Notification(user_id=uid, type="display_name_changed", message=message))
    db.commit()


def notify_feedback_submitted(db: Session, sender_name: str, sender_role: str, message: str) -> None:
    """
    Every Super Admin gets a bell notification the moment a student or
    teacher submits feedback — previously feedback only showed up if a
    Super Admin happened to open the (also previously unwired) Feedback
    panel on /admin, so it could sit unread indefinitely.
    """
    admin_ids = db.scalars(select(User.id).where(User.role == Role.super_admin)).all()
    preview = message if len(message) <= 120 else f"{message[:117]}..."
    for uid in admin_ids:
        db.add(
            Notification(
                user_id=uid,
                type="feedback_submitted",
                message=f"New feedback from {sender_name} ({sender_role}): \"{preview}\"",
            )
        )
    db.commit()


def send_broadcast(
    db: Session,
    sender_id: int,
    target_type: str,
    message: str,
    target_user_id: int | None = None,
) -> BroadcastMessage:
    """
    Fans a Super Admin message out to Notification rows (so it shows up
    in the recipient's bell) and keeps one BroadcastMessage row as an
    audit record of the send itself.
    """
    if target_type == "all":
        recipient_ids = db.scalars(select(User.id)).all()
    elif target_type == "students":
        recipient_ids = db.scalars(select(User.id).where(User.role == Role.student)).all()
    elif target_type == "teachers":
        recipient_ids = db.scalars(select(User.id).where(User.role == Role.teacher)).all()
    elif target_type == "user":
        recipient_ids = [target_user_id] if target_user_id else []
    else:
        recipient_ids = []

    for uid in recipient_ids:
        db.add(Notification(user_id=uid, type="broadcast", message=message))

    record = BroadcastMessage(
        sender_id=sender_id,
        target_type=target_type,
        target_user_id=target_user_id if target_type == "user" else None,
        message=message,
        recipient_count=len(recipient_ids),
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
