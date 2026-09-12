from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class Poll(Base):
    """
    A Super Admin poll sent out via the notification bell (see
    app/api/routers/polls.py). `options` is a JSON-encoded list[str]
    (2-6 choices) — kept as free-form Text rather than a JSON column
    type so this works identically on SQLite (dev) and Postgres (prod),
    same convention as ActivityEvent.meta.

    status: "active" while voting is open, "ended" once
    services/polls.py:finalize_ended_polls has tallied it and broadcast
    the results notification. finalized_at is what the 48-hour
    PollVote purge window (see PollVote below) counts from.
    """

    __tablename__ = "polls"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question: Mapped[str] = mapped_column(Text)
    options: Mapped[str] = mapped_column(Text)
    created_by: Mapped[int] = mapped_column(ForeignKey("users.id"))
    duration_minutes: Mapped[int] = mapped_column(Integer)
    status: Mapped[str] = mapped_column(String(20), default="active")  # active | ended
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    ends_at: Mapped[datetime] = mapped_column(DateTime)
    finalized_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)


class PollVote(Base):
    """
    One row per voter per poll — this is the "who voted for what" data
    the Super Admin can see live while a poll runs. Deliberately
    temporary: the `purge-poll-votes` Celery beat job (app/worker.py)
    deletes every PollVote row whose poll ended more than 48 hours ago,
    to keep individual voting choices from being retained indefinitely.
    What survives is PollResult below — aggregate counts only.

    voter_name/voter_role are stamped at vote time (same reasoning as
    ChatMessage.sender_name) so the admin's vote-viewer still shows who
    voted even if that account is later renamed.
    """

    __tablename__ = "poll_votes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), index=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    voter_name: Mapped[str] = mapped_column(String(120))
    voter_role: Mapped[str] = mapped_column(String(20))
    option_index: Mapped[int] = mapped_column(Integer)
    voted_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class PollResult(Base):
    """
    Permanent aggregate record, written once when a poll ends (see
    services/polls.py:finalize_ended_polls) — this is what's left after
    the matching PollVote rows are purged 48h later, and what the
    "final tally" notification and any later results lookup read from.
    `options`/`counts` are JSON-encoded lists, same index order.
    """

    __tablename__ = "poll_results"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    poll_id: Mapped[int] = mapped_column(ForeignKey("polls.id"), unique=True, index=True)
    question: Mapped[str] = mapped_column(Text)
    options: Mapped[str] = mapped_column(Text)
    counts: Mapped[str] = mapped_column(Text)
    total_votes: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
