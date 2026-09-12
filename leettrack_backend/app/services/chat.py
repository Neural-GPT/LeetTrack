"""
Service functions backing the public chat feature
(app/api/routers/chat.py).

Reading/writing/clearing messages all operate on the separate chat
database (app/db/chat_session.py, app/models/chat.py) via a chat-DB
Session — none of this touches the main app database.
"""

from sqlalchemy import delete, select
from sqlalchemy.orm import Session

from app.models.chat import ChatMessage

# Keep the public chat light — this is a live room, not an archive (it's
# wiped daily anyway), so there's no reason to ship thousands of rows to
# a client that just opened the bubble.
MESSAGE_HISTORY_LIMIT = 200


def list_recent_messages(chat_db: Session, limit: int = MESSAGE_HISTORY_LIMIT) -> list[ChatMessage]:
    # Ordered by id (not created_at) so "latest" is unambiguous even
    # when two messages land in the same second — the frontend's
    # unread-dot logic (ChatBubble.tsx) depends on this being a stable,
    # monotonically increasing order.
    rows = chat_db.scalars(
        select(ChatMessage).order_by(ChatMessage.id.desc()).limit(limit)
    ).all()
    return list(reversed(rows))  # oldest first, for a normal chat scrollback


def post_message(
    chat_db: Session, sender_id: int, sender_name: str, sender_role: str, message: str
) -> ChatMessage:
    row = ChatMessage(
        sender_id=sender_id,
        sender_name=sender_name,
        sender_role=sender_role,
        message=message,
    )
    chat_db.add(row)
    chat_db.commit()
    chat_db.refresh(row)
    return row


def clear_all_messages(chat_db: Session) -> int:
    """Wipes the whole room — called by the daily 12 AM IST beat job."""
    result = chat_db.execute(delete(ChatMessage))
    chat_db.commit()
    return result.rowcount or 0
