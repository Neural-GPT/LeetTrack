from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import get_current_user, require_role
from app.db.chat_session import get_chat_db
from app.db.session import get_db
from app.models.enums import Role
from app.models.system import SiteSettings
from app.models.user import StudentProfile, TeacherProfile, User
from app.services.chat import list_recent_messages, post_message
from app.services.notifications import send_broadcast

router = APIRouter(prefix="/api/chat", tags=["chat"])

# Teacher's "notify everyone" power lives under the same /api/teacher
# prefix as the rest of the teacher-only endpoints (see
# app/api/routers/teacher.py) — kept as its own router here rather than
# added to that file, so this feature stays self-contained in one place.
teacher_broadcast_router = APIRouter(prefix="/api/teacher", tags=["teacher"])


def _get_or_create_settings(db: Session) -> SiteSettings:
    """Same singleton-row helper as api/routers/settings.py — duplicated
    rather than imported across routers (not a pattern used elsewhere in
    this codebase) since it's a two-line lookup."""
    settings_row = db.get(SiteSettings, 1)
    if not settings_row:
        settings_row = SiteSettings(id=1)
        db.add(settings_row)
        db.commit()
        db.refresh(settings_row)
    return settings_row


def _display_name(db: Session, user: User) -> str:
    """
    Same lookup as feedback.py's _display_name — student/teacher
    profile full_name, falling back to the account username (covers
    the Super Admin, who has neither profile table).
    """
    if user.role == Role.student:
        profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    elif user.role == Role.teacher:
        profile = db.scalar(select(TeacherProfile).where(TeacherProfile.user_id == user.id))
    else:
        profile = None
    return profile.full_name if profile else user.username


class ChatMessageOut(BaseModel):
    id: int
    sender_id: int
    sender_name: str
    sender_role: str
    message: str
    created_at: str


class ChatMessageCreate(BaseModel):
    message: str = Field(min_length=1, max_length=2000)


class ChatSettingsOut(BaseModel):
    enabled: bool


@router.get("/settings", response_model=ChatSettingsOut)
def get_chat_settings(
    user: User = Depends(get_current_user), db: Session = Depends(get_db)
):
    """Any logged-in role can read this — it's what the chat bubble
    checks to know whether to show the composer (or itself) at all."""
    return ChatSettingsOut(enabled=_get_or_create_settings(db).public_chat_enabled)


@router.patch("/settings", response_model=ChatSettingsOut)
def update_chat_settings(
    payload: ChatSettingsOut,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """Super Admin on/off switch for the whole public chat room. Turning
    it off doesn't clear existing messages — it just refuses new ones
    (see send_message below) until turned back on here."""
    s = _get_or_create_settings(db)
    s.public_chat_enabled = payload.enabled
    db.commit()
    return ChatSettingsOut(enabled=s.public_chat_enabled)


@router.get("/messages", response_model=list[ChatMessageOut])
def get_messages(
    user: User = Depends(get_current_user),
    chat_db: Session = Depends(get_chat_db),
):
    """
    Everyone logged in — student, teacher, or Super Admin — reads the
    same room. Backed by the separate chat database (see
    app/db/chat_session.py) and wiped daily at 12 AM IST, so this only
    ever returns however much of today's conversation is left.
    """
    rows = list_recent_messages(chat_db)
    return [
        ChatMessageOut(
            id=m.id,
            sender_id=m.sender_id,
            sender_name=m.sender_name,
            sender_role=m.sender_role,
            message=m.message,
            created_at=m.created_at.isoformat(),
        )
        for m in rows
    ]


@router.post("/messages", response_model=ChatMessageOut, status_code=201)
def send_message(
    payload: ChatMessageCreate,
    user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
    chat_db: Session = Depends(get_chat_db),
):
    """Any logged-in role can post — the display name is resolved server-side
    from the main DB (never trusted from the client) and stamped onto the
    chat-DB row. Refused while the Super Admin has switched the room off
    (see GET/PATCH /settings above)."""
    if not _get_or_create_settings(db).public_chat_enabled:
        raise HTTPException(403, "Public chat is currently turned off.")
    name = _display_name(db, user)
    row = post_message(chat_db, user.id, name, user.role.value, payload.message.strip())
    return ChatMessageOut(
        id=row.id,
        sender_id=row.sender_id,
        sender_name=row.sender_name,
        sender_role=row.sender_role,
        message=row.message,
        created_at=row.created_at.isoformat(),
    )


# --- Teacher -> everyone's notification bell --------------------------------
#
# The Super Admin's equivalent lives at POST /api/admin/broadcast and can
# target "all", "students", "teachers", or one specific user (see
# app/api/routers/admin.py). This is deliberately narrower: a teacher can
# only ever reach *everyone*, never a subset or a single person — that
# distinction stays a Super Admin-only power. Reuses the exact same
# send_broadcast() fan-out + audit-trail helper, just always called with
# target_type="all".


class TeacherBroadcastCreate(BaseModel):
    message: str = Field(min_length=1, max_length=1000)


class TeacherBroadcastOut(BaseModel):
    recipient_count: int


@teacher_broadcast_router.post(
    "/notify-all", response_model=TeacherBroadcastOut, status_code=201
)
def teacher_notify_all(
    payload: TeacherBroadcastCreate,
    teacher: User = Depends(require_role(Role.teacher)),
    db: Session = Depends(get_db),
):
    record = send_broadcast(db, teacher.id, "all", payload.message.strip())
    return TeacherBroadcastOut(recipient_count=record.recipient_count)
