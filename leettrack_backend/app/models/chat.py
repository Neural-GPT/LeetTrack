from datetime import datetime, timezone

from sqlalchemy import DateTime, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.db.chat_session import ChatBase, chat_engine


class ChatMessage(ChatBase):
    """
    A single message in the site-wide public chat — visible to every
    logged-in student, teacher, and Super Admin (see
    app/api/routers/chat.py).

    Lives in its own database (app/db/chat_session.py). sender_id/
    sender_name/sender_role are stored directly on the row rather than
    as a foreign key into the main `users` table, since that table
    lives in a *different* database and can't be joined against here —
    this also means a message still shows the sender's name as it was
    at send time even if the account is later renamed or removed.

    Wiped in full every day at 12:00 AM IST by the `clear-public-chat`
    Celery beat job (see app/celery_app.py + app/worker.py) — this is a
    running room, not a permanent record.
    """

    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    sender_id: Mapped[int] = mapped_column(Integer, index=True)
    sender_name: Mapped[str] = mapped_column(String(120))
    sender_role: Mapped[str] = mapped_column(String(20))  # student | teacher | super_admin
    message: Mapped[str] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc), index=True
    )


# Chat tables live in their own database — create them as soon as this
# module (and therefore ChatMessage) is imported, mirroring the
# Base.metadata.create_all(bind=engine) call in app/main.py for the
# main DB. In production, prefer a real migration against
# CHAT_DATABASE_URL instead of relying on this for schema changes.
ChatBase.metadata.create_all(bind=chat_engine)
