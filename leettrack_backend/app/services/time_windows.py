"""
Small helper for feature windows gated to a specific day-of-week range.

Currently backs the "profile changes (LeetCode username, display name)
only allowed on weekends" rule — weekend is defined as Saturday and
Sunday in IST (Asia/Kolkata, UTC+5:30, no DST), regardless of what
timezone the server itself runs in.
"""

from datetime import datetime, timedelta, timezone

IST = timezone(timedelta(hours=5, minutes=30))


def now_ist() -> datetime:
    return datetime.now(timezone.utc).astimezone(IST)


def is_ist_weekend(at: datetime | None = None) -> bool:
    """True on Saturday (5) or Sunday (6), IST calendar day."""
    moment = at or now_ist()
    if moment.tzinfo is None:
        moment = moment.replace(tzinfo=timezone.utc)
    return moment.astimezone(IST).weekday() in (5, 6)


WEEKEND_PROFILE_CHANGE_ERROR = (
    "Display name and LeetCode username can only be changed on weekends "
    "(Saturday-Sunday, IST). Come back this weekend to make that change."
)
