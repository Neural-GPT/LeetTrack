"""
Task bodies for the beat schedule defined in app/celery_app.py. Each
task just opens a DB session and calls into the plain-function services —
none of the actual logic lives here, so it stays testable without Celery
running at all.
"""

from datetime import datetime, timedelta, timezone

from app.celery_app import celery_app
from app.db.chat_session import ChatSessionLocal
from app.db.session import SessionLocal
from app.services.analytics import capture_daily_analytics
from app.services.archival import create_pending_batch, purge_expired_batches
from app.services.chat import clear_all_messages
from app.services.notifications import check_broken_streaks, create_deadline_reminders
from app.services.polls import finalize_ended_polls, purge_expired_poll_votes
from app.services.submission_pipeline import poll_pending_submissions


@celery_app.task(name="app.worker.poll_submissions_task")
def poll_submissions_task():
    db = SessionLocal()
    try:
        return poll_pending_submissions(db)
    finally:
        db.close()


@celery_app.task(name="app.worker.create_archive_batch_task")
def create_archive_batch_task():
    db = SessionLocal()
    try:
        period_end = datetime.now(timezone.utc)
        period_start = period_end - timedelta(days=7)
        batch = create_pending_batch(db, period_start, period_end)
        return {"batch_id": batch.id, "record_count": batch.record_count}
    finally:
        db.close()


@celery_app.task(name="app.worker.purge_expired_data_task")
def purge_expired_data_task():
    db = SessionLocal()
    try:
        return {"purged_batches": purge_expired_batches(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.send_deadline_reminders_task")
def send_deadline_reminders_task():
    db = SessionLocal()
    try:
        return {"notifications_created": create_deadline_reminders(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.check_broken_streaks_task")
def check_broken_streaks_task():
    db = SessionLocal()
    try:
        return {"notifications_created": check_broken_streaks(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.clear_public_chat_task")
def clear_public_chat_task():
    """Wipes the public chat's separate database, daily at 12 AM IST
    (see the `clear-public-chat` entry in app/celery_app.py's beat
    schedule — celery_app.conf.timezone is already Asia/Kolkata)."""
    db = ChatSessionLocal()
    try:
        return {"messages_cleared": clear_all_messages(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.finalize_polls_task")
def finalize_polls_task():
    db = SessionLocal()
    try:
        return {"polls_finalized": finalize_ended_polls(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.purge_poll_votes_task")
def purge_poll_votes_task():
    db = SessionLocal()
    try:
        return {"votes_purged": purge_expired_poll_votes(db)}
    finally:
        db.close()


@celery_app.task(name="app.worker.capture_daily_analytics_task")
def capture_daily_analytics_task():
    """Snapshots yesterday's site-usage numbers (see celery_app.py's
    `capture-daily-analytics` beat entry, 12:05 AM IST)."""
    db = SessionLocal()
    try:
        row = capture_daily_analytics(db)
        return {"date": row.date.isoformat(), "unique_visitors": row.unique_visitors}
    finally:
        db.close()
