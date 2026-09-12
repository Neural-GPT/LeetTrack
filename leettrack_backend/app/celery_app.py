"""
Celery app + beat schedule.

Run the worker and beat scheduler as two separate processes:
    celery -A app.worker worker --loglevel=info
    celery -A app.worker beat --loglevel=info

Needs a running Redis (or other broker) at CELERY_BROKER_URL.
"""

from celery import Celery
from celery.schedules import crontab

from app.core.config import settings

celery_app = Celery(
    "leettrack",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_BROKER_URL,
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="Asia/Kolkata",
    enable_utc=True,
)

celery_app.conf.beat_schedule = {
    # Check LeetCode for newly-accepted submissions every 5 minutes.
    "poll-submissions": {
        "task": "app.worker.poll_submissions_task",
        "schedule": 300.0,
    },
    # Snapshot the past week's raw data into an exportable batch, every
    # Monday at 2am.
    "create-weekly-archive-batch": {
        "task": "app.worker.create_archive_batch_task",
        "schedule": crontab(hour=2, minute=0, day_of_week=1),
    },
    # Purge anything downloaded more than DATA_RETENTION_DAYS ago, daily.
    "purge-expired-data": {
        "task": "app.worker.purge_expired_data_task",
        "schedule": crontab(hour=3, minute=0),
    },
    # Deadline-reminder notifications, every hour.
    "deadline-reminders": {
        "task": "app.worker.send_deadline_reminders_task",
        "schedule": crontab(minute=0),
    },
    # Streak-broken check, once daily just after midnight.
    "streak-check": {
        "task": "app.worker.check_broken_streaks_task",
        "schedule": crontab(hour=0, minute=30),
    },
    # Wipe the public chat's (separate) database, daily at 12:00 AM —
    # `timezone` above is already "Asia/Kolkata", so this fires at
    # 12:00 AM IST specifically, not UTC midnight.
    "clear-public-chat": {
        "task": "app.worker.clear_public_chat_task",
        "schedule": crontab(hour=0, minute=0),
    },
    # Close out any poll whose valid-duration has passed and broadcast
    # its results notification — checked every minute so a poll ends
    # close to its actual set duration, not just on some coarser tick.
    "finalize-polls": {
        "task": "app.worker.finalize_polls_task",
        "schedule": 60.0,
    },
    # Delete individual "who voted for what" rows (PollVote) for any
    # poll that finished more than 48 hours ago — the aggregate
    # PollResult stays. Once daily is plenty for a 48h-granularity rule.
    "purge-poll-votes": {
        "task": "app.worker.purge_poll_votes_task",
        "schedule": crontab(hour=4, minute=0),
    },
    # Snapshot yesterday's site-usage numbers into daily_analytics —
    # runs at 12:05 AM IST (timezone is already Asia/Kolkata above),
    # just after the chat-clear job, so it's capturing a day that has
    # fully ended rather than one still in progress.
    "capture-daily-analytics": {
        "task": "app.worker.capture_daily_analytics_task",
        "schedule": crontab(hour=0, minute=5),
    },
}
