"""
Separate database for the public chat feature — deliberately isolated
from the main app database (app/db/session.py) so chat traffic (small
messages, high write volume, wiped daily) never touches student/
teacher/submission data, and can be pointed at its own host in
production without going through an Alembic migration shared with the
rest of the schema.

Configured directly from the environment (CHAT_DATABASE_URL) rather
than through app.core.config.Settings, so this module is fully
self-contained — no changes needed to the main Settings class. Falls
back to a separate local SQLite file for dev, same pattern as
DATABASE_URL's default in app/core/config.py.
"""

import os
from collections.abc import Generator

from sqlalchemy import create_engine
from sqlalchemy.orm import DeclarativeBase, Session, sessionmaker

CHAT_DATABASE_URL = os.getenv("CHAT_DATABASE_URL", "sqlite:///./leettrack_chat.db")

_chat_connect_args = (
    {"check_same_thread": False} if CHAT_DATABASE_URL.startswith("sqlite") else {}
)

chat_engine = create_engine(CHAT_DATABASE_URL, connect_args=_chat_connect_args)
ChatSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=chat_engine)


class ChatBase(DeclarativeBase):
    """
    Its own declarative base, separate from app.db.base_class.Base —
    chat tables live in chat_engine's database, never the main one, so
    they can't accidentally get pulled into the main Base.metadata.create_all()
    call in app/main.py or an Alembic autogenerate against the main DB.
    """

    pass


def get_chat_db() -> Generator[Session, None, None]:
    db = ChatSessionLocal()
    try:
        yield db
    finally:
        db.close()
