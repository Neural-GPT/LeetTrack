from __future__ import annotations

from datetime import date as date_type

from sqlalchemy import Date, Float, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class DailyAnalytics(Base):
    """
    One row per calendar day (IST), written by the nightly
    `capture-daily-analytics` beat job (services/analytics.py) shortly
    after midnight, for the day that just ended. The job upserts by
    date, so a manual re-run or a retry after a crash overwrites that
    day's numbers rather than creating a duplicate row.

    Deliberately DB-native and low-overhead: every figure here is
    derived by querying existing tables (User, ActivityEvent,
    Submission) once per day. Nothing is tracked on the hot request
    path, so this can't slow down the app or bloat the DB the way a
    per-request page-view log would.
    """

    __tablename__ = "daily_analytics"

    date: Mapped[date_type] = mapped_column(Date, primary_key=True)

    # Distinct users (any role) whose last_seen_at fell on this date —
    # our proxy for "site visitors" (see api/deps.py's last_seen_at
    # touch on every authenticated request).
    unique_visitors: Mapped[int] = mapped_column(Integer, default=0)
    active_students: Mapped[int] = mapped_column(Integer, default=0)
    active_teachers: Mapped[int] = mapped_column(Integer, default=0)

    # New accounts (any role) whose User.created_at falls on this date.
    new_signups: Mapped[int] = mapped_column(Integer, default=0)

    # Users active on this date who were ALSO active the day before —
    # day-over-day continuity, cheap to compute alongside the 7-day
    # figure below.
    returning_users: Mapped[int] = mapped_column(Integer, default=0)

    # Of the users active exactly 7 days before this date, the fraction
    # who were active again on this date. Null until there's 7 days of
    # history to compare against (e.g. the app's first week, or right
    # after a purge removed that comparison day).
    retention_7d: Mapped[float | None] = mapped_column(Float, nullable=True)

    # Count of ActivityEvent(event_type="login") rows on this date —
    # see api/routers/auth.py's login endpoint. Can exceed
    # unique_visitors if someone logs in more than once in a day.
    total_logins: Mapped[int] = mapped_column(Integer, default=0)

    # Submissions that flipped to "accepted" on this date
    # (Submission.accepted_at) — a coarse but honest engagement signal;
    # Submission has no created_at/attempted-at timestamp to draw a
    # "total attempts today" figure from.
    problems_solved: Mapped[int] = mapped_column(Integer, default=0)

    # ISO timestamp of when this row was last (re)computed, for
    # debugging/support — not shown in the admin UI.
    captured_at: Mapped[str] = mapped_column(String(40))
