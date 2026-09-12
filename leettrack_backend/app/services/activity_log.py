"""
Lightweight event-level logging, separate from Notification (user-facing)
and AIInteractionLog (AI-specific metadata).

Every call is a single INSERT of an ActivityEvent row — cheap, fire-and-
forget, and deliberately schema-light (a `event_type` string + a small
JSON blob) so new event types don't need a migration. This is what
feeds the richer Data Center exports (see services/archival.py) for
future model-training / analytics use, on top of the submission data
that was already being captured.

Kept as a plain function, same pattern as the rest of app/services/, so
it can be called from any router or Celery task without extra wiring.
"""

import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.system import ActivityEvent


def log_event(
    db: Session,
    user_id: int | None,
    event_type: str,
    meta: dict | None = None,
    commit: bool = True,
) -> None:
    db.add(
        ActivityEvent(
            user_id=user_id,
            event_type=event_type,
            meta=json.dumps(meta) if meta else None,
            created_at=datetime.now(timezone.utc),
        )
    )
    if commit:
        db.commit()
