import json

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.session import get_db
from app.models.enums import Role
from app.models.poll import Poll, PollResult, PollVote
from app.models.user import User
from app.services import polls as poll_service

router = APIRouter(prefix="/api/polls", tags=["polls"])


class PollCreate(BaseModel):
    question: str = Field(min_length=1, max_length=500)
    options: list[str] = Field(min_length=poll_service.MIN_OPTIONS, max_length=poll_service.MAX_OPTIONS)
    duration_minutes: int = Field(gt=0)


class PollOut(BaseModel):
    id: int
    question: str
    options: list[str]
    status: str
    created_at: str
    ends_at: str
    my_vote: int | None = None
    # Only populated once the poll has ended (results become public
    # knowledge the moment the "poll ended" notification goes out) —
    # while a poll is still active, only the Super Admin can see the
    # running tally, via GET /api/polls/{id}/votes.
    counts: list[int] | None = None
    total_votes: int | None = None


def _poll_out(db: Session, poll: Poll, user: User) -> PollOut:
    options = json.loads(poll.options)
    my_vote = poll_service.get_user_vote(db, poll.id, user.id)
    counts = None
    total_votes = None
    if poll.status == "ended":
        result = db.scalar(select(PollResult).where(PollResult.poll_id == poll.id))
        if result:
            counts = json.loads(result.counts)
            total_votes = result.total_votes
        else:
            # Beat job hasn't run yet in this exact instant — fall back
            # to a live tally so the poll doesn't look broken.
            counts = poll_service.live_tally(db, poll)
            total_votes = sum(counts)
    return PollOut(
        id=poll.id,
        question=poll.question,
        options=options,
        status=poll.status,
        created_at=poll.created_at.isoformat(),
        ends_at=poll.ends_at.isoformat(),
        my_vote=my_vote.option_index if my_vote else None,
        counts=counts,
        total_votes=total_votes,
    )


@router.post("", response_model=PollOut, status_code=201)
def create_poll(
    payload: PollCreate,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    try:
        poll = poll_service.create_poll(
            db, admin.id, payload.question, payload.options, payload.duration_minutes
        )
    except poll_service.PollError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _poll_out(db, poll, admin)


@router.get("", response_model=list[PollOut])
def list_polls(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Super Admin's poll history/management view — most recent first."""
    rows = db.scalars(select(Poll).order_by(Poll.created_at.desc()).limit(100)).all()
    return [_poll_out(db, p, admin) for p in rows]


@router.get("/{poll_id}", response_model=PollOut)
def get_poll(
    poll_id: int,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    poll = db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Poll not found.")
    return _poll_out(db, poll, user)


class VoteCreate(BaseModel):
    option_index: int = Field(ge=0)


@router.post("/{poll_id}/vote", response_model=PollOut)
def vote(
    poll_id: int,
    payload: VoteCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    poll = db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Poll not found.")
    try:
        poll_service.cast_vote(db, poll, user, payload.option_index)
    except poll_service.PollError as exc:
        raise HTTPException(400, str(exc)) from exc
    return _poll_out(db, poll, user)


class PollVoteOut(BaseModel):
    user_id: int
    voter_name: str
    voter_role: str
    option_index: int
    voted_at: str


@router.get("/{poll_id}/votes", response_model=list[PollVoteOut])
def get_poll_votes(
    poll_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    "Who voted for what" — Super Admin only. Returns whatever PollVote
    rows still exist: everything while the poll's active or within 48h
    of ending, empty once the purge job has run past that window (only
    the aggregate counts on PollOut/PollResult survive past that
    point — see services/polls.py's docstring).
    """
    poll = db.get(Poll, poll_id)
    if not poll:
        raise HTTPException(404, "Poll not found.")
    rows = db.scalars(
        select(PollVote).where(PollVote.poll_id == poll_id).order_by(PollVote.voted_at)
    ).all()
    return [
        PollVoteOut(
            user_id=v.user_id,
            voter_name=v.voter_name,
            voter_role=v.voter_role,
            option_index=v.option_index,
            voted_at=v.voted_at.isoformat(),
        )
        for v in rows
    ]
