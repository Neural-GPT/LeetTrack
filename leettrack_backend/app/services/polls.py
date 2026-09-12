"""
Super Admin polls, delivered and voted on through the notification
bell (Notification rows with type="poll" / "poll_result" and a
meta={"poll_id": N} blob — see app/models/system.py:Notification.meta).

Lifecycle:
  1. create_poll(): Super Admin picks a question, 2-6 options, and a
     valid-for duration. Fans out a type="poll" Notification to every
     user (students, teachers, and other admins alike) — same
     all-users fan-out as services/notifications.py:send_broadcast.
  2. cast_vote(): any user votes once per poll while it's still active.
  3. finalize_ended_polls() (Celery beat, every minute — see
     app/worker.py): once `ends_at` has passed, tallies the PollVote
     rows into a permanent PollResult row, flips the poll to "ended",
     and fans out a type="poll_result" Notification with the final
     counts to everyone.
  4. purge_expired_poll_votes() (Celery beat, daily): deletes PollVote
     rows for polls that finalized more than 48 hours ago — only the
     aggregate PollResult survives past that point. See PollVote's
     docstring for why.
"""

import json
from datetime import datetime, timedelta, timezone

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.poll import Poll, PollResult, PollVote
from app.models.system import Notification
from app.models.user import User

MIN_OPTIONS = 2
MAX_OPTIONS = 6
VOTE_DATA_RETENTION = timedelta(hours=48)


class PollError(Exception):
    """Raised for any poll rule violation — routers translate this to a 400."""


def _now() -> datetime:
    return datetime.now(timezone.utc)


def create_poll(
    db: Session, admin_id: int, question: str, options: list[str], duration_minutes: int
) -> Poll:
    question = question.strip()
    options = [o.strip() for o in options if o.strip()]
    if not question:
        raise PollError("Poll needs a question.")
    if len(options) < MIN_OPTIONS or len(options) > MAX_OPTIONS:
        raise PollError(f"Polls need between {MIN_OPTIONS} and {MAX_OPTIONS} options.")
    if len(set(options)) != len(options):
        raise PollError("Options need to be unique.")
    if duration_minutes < 1 or duration_minutes > 60 * 24 * 14:  # cap at 14 days
        raise PollError("Duration needs to be between 1 minute and 14 days.")

    ends_at = _now() + timedelta(minutes=duration_minutes)
    poll = Poll(
        question=question,
        options=json.dumps(options),
        created_by=admin_id,
        duration_minutes=duration_minutes,
        status="active",
        ends_at=ends_at.replace(tzinfo=None),
    )
    db.add(poll)
    db.commit()
    db.refresh(poll)

    recipient_ids = db.scalars(select(User.id)).all()
    for uid in recipient_ids:
        db.add(
            Notification(
                user_id=uid,
                type="poll",
                message=f"Poll: {question}",
                meta=json.dumps({"poll_id": poll.id}),
            )
        )
    db.commit()
    return poll


def get_user_vote(db: Session, poll_id: int, user_id: int) -> PollVote | None:
    return db.scalar(
        select(PollVote).where(PollVote.poll_id == poll_id, PollVote.user_id == user_id)
    )


def cast_vote(db: Session, poll: Poll, user: User, option_index: int) -> PollVote:
    if poll.status != "active" or poll.ends_at <= _now().replace(tzinfo=None):
        raise PollError("This poll has already closed.")
    options = json.loads(poll.options)
    if option_index < 0 or option_index >= len(options):
        raise PollError("That's not a valid option for this poll.")
    if get_user_vote(db, poll.id, user.id):
        raise PollError("You've already voted in this poll.")

    vote = PollVote(
        poll_id=poll.id,
        user_id=user.id,
        voter_name=user.username,
        voter_role=user.role.value,
        option_index=option_index,
    )
    db.add(vote)
    db.commit()
    db.refresh(vote)
    return vote


def live_tally(db: Session, poll: Poll) -> list[int]:
    """Vote counts per option index, computed live from whatever PollVote
    rows still exist (works pre- and post-finalize, until the 48h purge)."""
    options = json.loads(poll.options)
    counts = [0] * len(options)
    votes = db.scalars(select(PollVote).where(PollVote.poll_id == poll.id)).all()
    for v in votes:
        if 0 <= v.option_index < len(counts):
            counts[v.option_index] += 1
    return counts


def finalize_ended_polls(db: Session) -> int:
    now = _now().replace(tzinfo=None)
    ended = db.scalars(
        select(Poll).where(Poll.status == "active", Poll.ends_at <= now)
    ).all()

    for poll in ended:
        options = json.loads(poll.options)
        counts = live_tally(db, poll)
        total = sum(counts)

        db.add(
            PollResult(
                poll_id=poll.id,
                question=poll.question,
                options=poll.options,
                counts=json.dumps(counts),
                total_votes=total,
            )
        )
        poll.status = "ended"
        poll.finalized_at = now

        summary = ", ".join(f"{opt}: {c}" for opt, c in zip(options, counts))
        recipient_ids = db.scalars(select(User.id)).all()
        for uid in recipient_ids:
            db.add(
                Notification(
                    user_id=uid,
                    type="poll_result",
                    message=f"Poll results — \"{poll.question}\": {summary} ({total} vote{'s' if total != 1 else ''})",
                    meta=json.dumps({"poll_id": poll.id}),
                )
            )

    db.commit()
    return len(ended)


def purge_expired_poll_votes(db: Session) -> int:
    """Deletes PollVote rows for polls finalized more than 48h ago —
    the individual "who voted for what" record. PollResult (aggregate
    counts) is untouched and is what's left for those polls."""
    cutoff = (_now() - VOTE_DATA_RETENTION).replace(tzinfo=None)
    expired_poll_ids = db.scalars(
        select(Poll.id).where(Poll.status == "ended", Poll.finalized_at.isnot(None),
                               Poll.finalized_at <= cutoff)
    ).all()
    if not expired_poll_ids:
        return 0
    result = db.execute(delete(PollVote).where(PollVote.poll_id.in_(expired_poll_ids)))
    db.commit()
    return result.rowcount or 0
