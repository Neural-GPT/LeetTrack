from __future__ import annotations

from datetime import date as date_type
from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.models.analytics import DailyAnalytics
from app.models.enums import Role, SubmissionStatus
from app.models.submission import Submission
from app.models.system import ActivityEvent
from app.models.user import User

IST_OFFSET = timedelta(hours=5, minutes=30)


def ist_today() -> date_type:
    return (datetime.now(timezone.utc) + IST_OFFSET).date()


def _ist_day_bounds_utc(day: date_type) -> tuple[datetime, datetime]:
    """
    [start, end) in naive UTC covering one IST calendar day — matches
    how last_seen_at/created_at/etc. are stored elsewhere in the app
    (datetime.now(timezone.utc), tzinfo stripped before comparison).
    """
    ist_midnight_utc = datetime(day.year, day.month, day.day) - IST_OFFSET
    return ist_midnight_utc, ist_midnight_utc + timedelta(days=1)


def _active_user_ids(db: Session, day: date_type) -> set[int]:
    start, end = _ist_day_bounds_utc(day)
    rows = db.execute(
        select(User.id).where(
            User.last_seen_at.isnot(None),
            User.last_seen_at >= start,
            User.last_seen_at < end,
        )
    ).all()
    return {row[0] for row in rows}


def capture_daily_analytics(db: Session, day: date_type | None = None) -> DailyAnalytics:
    """
    Computes and upserts the DailyAnalytics row for `day` (an IST
    calendar date). Defaults to yesterday, since this is meant to run
    just after IST midnight for the day that just ended — capturing
    "today" while it's still in progress would give an incomplete
    snapshot that then never gets corrected.

    Safe to call more than once for the same day (e.g. a manual
    re-run from the admin panel, or a retry after a crash) — it
    overwrites that day's row rather than duplicating it.
    """
    if day is None:
        day = ist_today() - timedelta(days=1)

    start, end = _ist_day_bounds_utc(day)

    visitor_rows = db.execute(
        select(User.id, User.role).where(
            User.last_seen_at.isnot(None),
            User.last_seen_at >= start,
            User.last_seen_at < end,
        )
    ).all()
    today_visitor_ids = {uid for uid, _ in visitor_rows}
    active_students = sum(1 for _, role in visitor_rows if role == Role.student)
    active_teachers = sum(1 for _, role in visitor_rows if role == Role.teacher)

    new_signups = db.scalar(
        select(func.count(User.id)).where(
            User.created_at >= start,
            User.created_at < end,
        )
    ) or 0

    yesterday_visitor_ids = _active_user_ids(db, day - timedelta(days=1))
    returning_users = len(today_visitor_ids & yesterday_visitor_ids)

    week_ago_visitor_ids = _active_user_ids(db, day - timedelta(days=7))
    retention_7d = (
        len(today_visitor_ids & week_ago_visitor_ids) / len(week_ago_visitor_ids)
        if week_ago_visitor_ids
        else None
    )

    total_logins = db.scalar(
        select(func.count(ActivityEvent.id)).where(
            ActivityEvent.event_type == "login",
            ActivityEvent.created_at >= start,
            ActivityEvent.created_at < end,
        )
    ) or 0

    # Bucketed by graded_at (when this app credited the submission),
    # not accepted_at (when LeetCode says it was actually solved) — a
    # student can click "Check for updates" on a problem they'd
    # already solved on LeetCode before this assignment even existed;
    # that submission is still real platform activity *today* and
    # should show up as today's submission, not get attributed to
    # (or silently dropped for falling outside the window of) some
    # past day implied by LeetCode's own timestamp. See
    # models/submission.py and services/submission_pipeline.py.
    problems_solved = db.scalar(
        select(func.count(Submission.id)).where(
            Submission.status == SubmissionStatus.accepted,
            Submission.graded_at.isnot(None),
            Submission.graded_at >= start,
            Submission.graded_at < end,
        )
    ) or 0

    row = db.get(DailyAnalytics, day)
    if row is None:
        row = DailyAnalytics(date=day)
        db.add(row)

    row.unique_visitors = len(today_visitor_ids)
    row.active_students = active_students
    row.active_teachers = active_teachers
    row.new_signups = new_signups
    row.returning_users = returning_users
    row.retention_7d = retention_7d
    row.total_logins = total_logins
    row.problems_solved = problems_solved
    row.captured_at = datetime.now(timezone.utc).isoformat()

    db.commit()
    db.refresh(row)
    return row


def list_daily_analytics(db: Session, days: int) -> list[DailyAnalytics]:
    """Stored rows for the last `days` calendar days, oldest first."""
    cutoff = ist_today() - timedelta(days=days)
    return list(
        db.scalars(
            select(DailyAnalytics)
            .where(DailyAnalytics.date >= cutoff)
            .order_by(DailyAnalytics.date.asc())
        ).all()
    )


def purge_analytics_older_than(db: Session, days: int) -> int:
    """
    Deletes stored DailyAnalytics rows older than `days` days back from
    today (IST) — the "purge to save DB space" control in the admin
    panel. Returns the number of rows deleted. Each row is a handful of
    integers/floats, so this is about tidiness over time rather than
    urgent space pressure, but it's here for whenever it's wanted.
    """
    cutoff = ist_today() - timedelta(days=days)
    rows = db.scalars(select(DailyAnalytics).where(DailyAnalytics.date < cutoff)).all()
    count = len(rows)
    for row in rows:
        db.delete(row)
    db.commit()
    return count
