from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.core.config import settings
from app.db.session import get_db
from app.models.enums import ArchiveStatus, Role
from app.models.system import DataArchiveBatch
from app.models.user import User
from app.services.archival import create_pending_batch, mark_downloaded, purge_expired_batches

router = APIRouter(prefix="/api/data-center", tags=["data-center"])


class BatchOut(BaseModel):
    id: int
    period_start: str
    period_end: str
    status: ArchiveStatus
    record_count: int

    model_config = {"from_attributes": True}


@router.get("/batches", response_model=list[BatchOut])
def list_batches(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Dedicated page the Super Admin visits manually — no login-time
    interrupt. Shows every batch and its lifecycle state.
    """
    batches = db.scalars(
        select(DataArchiveBatch).order_by(DataArchiveBatch.period_start.desc())
    ).all()
    return [
        BatchOut(
            id=b.id,
            period_start=b.period_start.isoformat(),
            period_end=b.period_end.isoformat(),
            status=b.status,
            record_count=b.record_count,
        )
        for b in batches
    ]


@router.get("/batches/{batch_id}/download")
def download_batch(
    batch_id: int,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    batch = db.get(DataArchiveBatch, batch_id)
    if not batch or not batch.export_path:
        raise HTTPException(404, "That export isn't ready yet.")

    mark_downloaded(db, batch)
    return FileResponse(
        batch.export_path,
        filename=f"leettrack-export-{batch.period_start.date()}.json",
        media_type="application/json",
    )


@router.post("/batches/create", response_model=BatchOut, status_code=201)
def create_batch(
    days: int = 7,
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Manually snapshot the last `days` days of raw submission data into a
    new pending batch. Celery beat does this weekly on its own (see
    app/celery_app.py) — this endpoint exists so the Data Center is
    useful even before you've got Redis/Celery running locally.
    """
    period_end = datetime.now(timezone.utc)
    period_start = period_end - timedelta(days=days)
    batch = create_pending_batch(db, period_start, period_end)
    return BatchOut(
        id=batch.id,
        period_start=batch.period_start.isoformat(),
        period_end=batch.period_end.isoformat(),
        status=batch.status,
        record_count=batch.record_count,
    )


@router.get("/settings")
def get_settings(admin: User = Depends(require_role(Role.super_admin))):
    return {"data_retention_days": settings.DATA_RETENTION_DAYS}


@router.post("/purge-expired")
def purge_expired(
    admin: User = Depends(require_role(Role.super_admin)),
    db: Session = Depends(get_db),
):
    """
    Manually trigger the retention sweep (also runs on a schedule via
    Celery beat — see app/services/archival.py). Deletes raw event-level
    records for batches downloaded more than DATA_RETENTION_DAYS ago;
    aggregated scores/ranks are untouched.
    """
    purged = purge_expired_batches(db)
    return {"purged_batches": purged}
