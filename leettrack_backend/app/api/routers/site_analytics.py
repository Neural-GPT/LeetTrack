import csv
import io
from datetime import date as date_type
from datetime import datetime, timezone

from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.analytics import DailyAnalytics
from app.models.enums import Role
from app.models.user import User
from app.services.analytics import (
    capture_daily_analytics,
    ist_today,
    list_daily_analytics,
    purge_analytics_older_than,
)

router = APIRouter(prefix="/api/admin/site-analytics", tags=["admin-site-analytics"])


class DailyAnalyticsOut(BaseModel):
    date: date_type
    unique_visitors: int
    active_students: int
    active_teachers: int
    new_signups: int
    returning_users: int
    retention_7d: float | None
    total_logins: int
    problems_solved: int
    is_today: bool = False

    model_config = {"from_attributes": True}


def _to_out(row: DailyAnalytics, is_today: bool = False) -> DailyAnalyticsOut:
    return DailyAnalyticsOut(
        date=row.date,
        unique_visitors=row.unique_visitors,
        active_students=row.active_students,
        active_teachers=row.active_teachers,
        new_signups=row.new_signups,
        returning_users=row.returning_users,
        retention_7d=row.retention_7d,
        total_logins=row.total_logins,
        problems_solved=row.problems_solved,
        is_today=is_today,
    )


@router.get("/daily", response_model=list[DailyAnalyticsOut])
def get_daily_analytics(
    days: int = 30,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Stored daily snapshots for the last `days` days, PLUS a live,
    not-yet-persisted snapshot for today (is_today=True) computed on
    the fly so the trend view doesn't have a dead final day until
    tonight's capture job runs. Today's numbers obviously only reflect
    activity so far, not the full day — the frontend flags that.
    """
    days = max(1, min(days, 365))
    rows = list_daily_analytics(db, days)

    today = ist_today()
    # Computing (and upserting) today's row here is intentional, not a
    # special case: it's just tonight's row a bit early. The
    # `capture-daily-analytics` beat job overwrites it with final
    # numbers at midnight, same as any other day.
    today_row = capture_daily_analytics(db, day=today)

    out = [_to_out(r) for r in rows if r.date != today]
    out.append(_to_out(today_row, is_today=True))
    return out


@router.get("/export")
def export_daily_analytics(
    days: int = 90,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """CSV download of the last `days` days of stored analytics."""
    days = max(1, min(days, 3650))
    rows = list_daily_analytics(db, days)

    buffer = io.StringIO()
    writer = csv.writer(buffer)
    writer.writerow([
        "date", "unique_visitors", "active_students", "active_teachers",
        "new_signups", "returning_users", "retention_7d", "total_logins",
        "problems_solved",
    ])
    for r in rows:
        writer.writerow([
            r.date.isoformat(), r.unique_visitors, r.active_students,
            r.active_teachers, r.new_signups, r.returning_users,
            "" if r.retention_7d is None else round(r.retention_7d, 4),
            r.total_logins, r.problems_solved,
        ])
    buffer.seek(0)

    filename = f"leettrack-analytics-{datetime.now(timezone.utc).date().isoformat()}.csv"
    return StreamingResponse(
        iter([buffer.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )


class PurgeRequest(BaseModel):
    older_than_days: int = 90


class PurgeOut(BaseModel):
    deleted: int


@router.post("/purge", response_model=PurgeOut)
def purge_daily_analytics(
    payload: PurgeRequest,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Deletes stored rows older than `older_than_days` days back from
    today. Frees up the (small but non-zero) DB space this table uses
    over time. Doesn't touch anything newer, so recent trends stay
    intact.
    """
    days = max(1, payload.older_than_days)
    deleted = purge_analytics_older_than(db, days)
    return PurgeOut(deleted=deleted)
