from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base
from app.models.enums import ArchiveStatus, OtpPurpose


class AIInteractionLog(Base):
    """
    Metadata only — no message content. Used for the Data Center export
    and, eventually, understanding assistant usage patterns. Chat content
    itself is never persisted server-side (see services/ai_assistant.py).
    """

    __tablename__ = "ai_interaction_logs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    message_count: Mapped[int] = mapped_column(Integer, default=1)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class ActivityEvent(Base):
    """
    Lightweight, schema-light event log (login, profile changes, manual
    submission refreshes, registrations, admin overrides, ...) — see
    services/activity_log.py. Purely additive analytics/data-collection
    signal; nothing in the app *reads* this back for behavior, only the
    Data Center export (services/archival.py) and, eventually, model
    training on student engagement patterns.
    """

    __tablename__ = "activity_events"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    event_type: Mapped[str] = mapped_column(String(50), index=True)
    # Small JSON blob, e.g. {"from": "old_name", "to": "new_name"} — kept
    # as free-form text rather than a JSON column type so this works
    # identically on SQLite (dev) and Postgres (prod) without a driver-
    # specific column type.
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class BroadcastMessage(Base):
    """
    Audit trail for Super Admin broadcast messages (Notification rows are
    still what actually deliver these to the bell — see
    services/notifications.py:send_broadcast — this table just keeps a
    record of what was sent, by whom, and to whom, since fan-out
    Notification rows don't retain "this was one broadcast" as a group).
    """

    __tablename__ = "broadcast_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    target_type: Mapped[str] = mapped_column(String(20))  # all | students | teachers | user
    target_user_id: Mapped[int | None] = mapped_column(
        ForeignKey("users.id"), nullable=True
    )
    message: Mapped[str] = mapped_column(Text)
    recipient_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class Notification(Base):
    __tablename__ = "notifications"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    type: Mapped[str] = mapped_column(String(50))  # new_assignment, deadline, streak_broken, ...
    message: Mapped[str] = mapped_column(Text)
    read: Mapped[bool] = mapped_column(Boolean, default=False)
    # Small JSON blob for notification types that need to reference
    # something beyond plain text — currently just polls:
    # {"poll_id": 7} on type="poll" / "poll_result" rows, so the bell
    # can fetch/vote on the right poll. Same free-form-Text-as-JSON
    # pattern as ActivityEvent.meta, nullable so every other
    # notification type is unaffected.
    meta: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class OtpCode(Base):
    """
    Backs both the student self-registration flow (college email
    verification) and forgot-password. For registration, `payload` holds
    the pending full_name + password_hash as JSON — no User row exists
    yet until the OTP is verified, so a student can't get a half-created
    account by abandoning the flow partway through.

    The code itself is stored bcrypt-hashed, same as passwords — no
    reason to keep it recoverable in the DB.
    """

    __tablename__ = "otp_codes"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), index=True)
    otp_hash: Mapped[str] = mapped_column(String(255))
    purpose: Mapped["OtpPurpose"] = mapped_column(Enum(OtpPurpose))
    payload: Mapped[str | None] = mapped_column(Text, nullable=True)
    consumed: Mapped[bool] = mapped_column(Boolean, default=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class Feedback(Base):
    """
    Simple feedback widget backing store — any logged-in role can leave
    a short message. `GET /api/feedback/count` powers the counter badge
    shown in both student and teacher dashboards; only the Super Admin
    can actually read the messages (`GET /api/admin/feedback`).
    """

    __tablename__ = "feedback"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20))
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class SiteSettings(Base):
    """
    Singleton row (id is always 1) for site-wide appearance settings the
    Super Admin controls: accent color and background media (video or
    image — see BackgroundMedia below). Public GET endpoint (no auth) so
    the landing page can render with the current theme; PATCH is
    super_admin-only.

    background_media_url: an alternative to the registered-filename flow
    (BackgroundMedia below) — the admin can instead paste a direct link
    to a hosted image/video. Rather than every visitor's browser
    re-fetching that external link forever, the backend downloads it
    once into a local single-slot cache (see services/theme.py) the
    moment the admin sets/changes it, and serves that cached copy to
    everyone from then on — see the /api/settings/background-media
    endpoint. Empty string means "not set".

    theme_preset: which of the built-in look-and-feel presets
    ("classic" or "future") is applied across every page. This only
    changes panel styling (glass tint/opacity) — the accent color and
    background media stay independently configurable above.

    dark_surfaces_enabled / dark_surfaces_color: lets the Super Admin
    force a solid color (black by default) behind specific UI surfaces
    that are otherwise translucent — the AI chat input, the AI
    assistant's reply bubbles, and the notification dropdown.
    """

    __tablename__ = "site_settings"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, default=1)
    accent_color: Mapped[str] = mapped_column(String(20), default="#4F9DDE")
    background_media: Mapped[str] = mapped_column(String(100), default="hero-bg1.mp4")
    background_media_url: Mapped[str] = mapped_column(String(500), default="")
    # Local single-slot cache of whatever background_media_url currently
    # points at — see services/theme.py's cache_remote_media(). Empty
    # when background_media_url is empty or hasn't been successfully
    # cached yet.
    background_media_cache_path: Mapped[str] = mapped_column(String(100), default="")
    background_media_cache_type: Mapped[str] = mapped_column(String(10), default="")
    theme_preset: Mapped[str] = mapped_column(String(30), default="classic")
    dark_surfaces_enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    dark_surfaces_color: Mapped[str] = mapped_column(String(20), default="#000000")
    # Super Admin on/off switch for the site-wide public chat (see
    # app/api/routers/chat.py) — while False, POST /api/chat/messages
    # is refused for everyone. Existing messages stay visible; this
    # doesn't clear the room, just freezes it.
    public_chat_enabled: Mapped[bool] = mapped_column(Boolean, default=True)


class BackgroundMedia(Base):
    """
    Registry of background media the Super Admin has uploaded to the
    frontend's public/ folder and made selectable — the backend can't
    see that folder directly (frontend and backend are separately
    deployed), so the admin registers each filename here instead of the
    backend scanning a filesystem. Display label is derived from the
    filename (see services/theme.py: derive_label) rather than stored,
    so renaming the convention doesn't require a migration.
    """

    __tablename__ = "background_media"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    filename: Mapped[str] = mapped_column(String(100), unique=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class NvidiaApiKey(Base):
    """
    Super Admin manages one or more NVIDIA (build.nvidia.com / NIM)
    API keys directly through the UI instead of a single .env value —
    see app/services/ai_assistant.py, which rotates through active
    keys and skips any that fail (rate limit / auth error) rather than
    taking the whole assistant down.
    """

    __tablename__ = "nvidia_api_keys"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    key: Mapped[str] = mapped_column(String(200))
    label: Mapped[str] = mapped_column(String(100), default="")
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    last_used_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    failure_count: Mapped[int] = mapped_column(Integer, default=0)


class DataArchiveBatch(Base):
    """
    A rolling window of raw event-level data (submissions, engagement
    logs, AI session metadata) ready for the Super Admin to export.

    Lifecycle: pending -> downloaded -> purged.
    A Celery beat job creates these on a schedule; another job purges
    'downloaded' batches older than settings.DATA_RETENTION_DAYS.
    See app/services/archival.py.
    """

    __tablename__ = "data_archive_batches"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    period_start: Mapped[datetime] = mapped_column(DateTime)
    period_end: Mapped[datetime] = mapped_column(DateTime)
    status: Mapped[ArchiveStatus] = mapped_column(
        Enum(ArchiveStatus), default=ArchiveStatus.pending
    )
    record_count: Mapped[int] = mapped_column(Integer, default=0)
    export_path: Mapped[str | None] = mapped_column(String(500), nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    downloaded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    purged_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
