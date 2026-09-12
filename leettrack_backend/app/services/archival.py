"""
Data lifecycle for the Super Admin Data Center.

Flow:
  1. `create_pending_batch` runs on a schedule (Celery beat, e.g. weekly)
     and snapshots the period's raw event data — submissions, engagement,
     AI session metadata — into a JSON export file plus a DataArchiveBatch
     row (status=pending).
  2. Super Admin visits the Data Center page, sees pending batches, and
     downloads them -> `mark_downloaded` flips status to downloaded.
  3. `purge_expired_batches` (also on a schedule) deletes the *raw*
     Submission rows belonging to batches that have been downloaded for
     longer than settings.DATA_RETENTION_DAYS. Aggregated stats
     (StudentProfile streaks, leaderboard scores) are never touched —
     only granular event-level rows are purged, to keep the DB lean
     while preserving everything the scoring/leaderboard needs.

Wire `create_pending_batch` and `purge_expired_batches` into Celery beat
in app/worker.py once that's set up; both are plain functions so they
also work called directly from the API for manual runs (see
api/routers/data_center.py).
"""

import json
from datetime import datetime, timedelta, timezone
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.enums import ArchiveStatus
from app.models.submission import Submission
from app.models.system import ActivityEvent, DataArchiveBatch
from app.models.user import StudentProfile

EXPORT_DIR = Path("data_exports")
EXPORT_DIR.mkdir(exist_ok=True)


def _submission_record(s: Submission) -> dict:
    """
    One row per submission, enriched beyond the original bare-bones
    shape with everything on Assignment/Problem/StudentProfile that's
    useful as a feature or label for downstream model training —
    difficulty, timing relative to release/deadline, lateness, and the
    student's section/streak context at export time — without adding
    extra queries per row (assignment/problem/student are eager-loaded
    relationships already on the Submission instance).
    """
    a = s.assignment
    problem = a.problem if a else None
    student = s.student  # StudentProfile, via relationship added below

    is_late = bool(s.accepted_at and a and s.accepted_at > a.deadline)
    minutes_to_solve = None
    if s.accepted_at and a and a.release_time:
        minutes_to_solve = round((s.accepted_at - a.release_time).total_seconds() / 60, 1)

    return {
        "submission_id": s.id,
        "assignment_id": s.assignment_id,
        "student_id": s.student_id,
        "section_id": student.section_id if student else None,
        "status": s.status.value,
        "score": s.score,
        "total_attempts": s.total_attempts,
        "accepted_at": s.accepted_at.isoformat() if s.accepted_at else None,
        "solve_position": s.solve_position,
        "is_late": is_late,
        "minutes_from_release_to_solve": minutes_to_solve,
        "assignment_problem_score": a.problem_score if a else None,
        "assignment_scope": a.scope.value if a else None,
        "assignment_release_time": a.release_time.isoformat() if a and a.release_time else None,
        "assignment_deadline": a.deadline.isoformat() if a and a.deadline else None,
        "problem_difficulty": problem.difficulty.value if problem else None,
        "problem_tags": problem.tags if problem else None,
        "student_current_streak": student.current_streak if student else None,
        "student_longest_streak": student.longest_streak if student else None,
    }


def _activity_event_record(e: ActivityEvent) -> dict:
    return {
        "event_id": e.id,
        "user_id": e.user_id,
        "event_type": e.event_type,
        "meta": json.loads(e.meta) if e.meta else None,
        "created_at": e.created_at.isoformat(),
    }


def create_pending_batch(
    db: Session, period_start: datetime, period_end: datetime
) -> DataArchiveBatch:
    submissions = db.scalars(
        select(Submission).where(
            Submission.accepted_at >= period_start,
            Submission.accepted_at < period_end,
        )
    ).all()

    events = db.scalars(
        select(ActivityEvent).where(
            ActivityEvent.created_at >= period_start,
            ActivityEvent.created_at < period_end,
        )
    ).all()

    export_path = EXPORT_DIR / f"batch-{period_start:%Y%m%d}-{period_end:%Y%m%d}.json"
    with open(export_path, "w") as f:
        json.dump(
            {
                "period_start": period_start.isoformat(),
                "period_end": period_end.isoformat(),
                "generated_at": datetime.now(timezone.utc).isoformat(),
                # Per-submission rows: the core signal for scoring/engagement
                # modeling (timing, attempts, difficulty, streak context).
                "submissions": [_submission_record(s) for s in submissions],
                # Event-level rows: logins, profile changes, manual refreshes,
                # registrations, admin overrides — see services/activity_log.py.
                # Useful for engagement/retention modeling on top of the
                # submission-level data above.
                "activity_events": [_activity_event_record(e) for e in events],
            },
            f,
            indent=2,
        )

    record_count = len(submissions) + len(events)
    batch = DataArchiveBatch(
        period_start=period_start,
        period_end=period_end,
        status=ArchiveStatus.pending,
        record_count=record_count,
        export_path=str(export_path),
    )
    db.add(batch)
    db.commit()
    db.refresh(batch)
    return batch


def mark_downloaded(db: Session, batch: DataArchiveBatch) -> None:
    batch.status = ArchiveStatus.downloaded
    batch.downloaded_at = datetime.now(timezone.utc)
    db.commit()


def purge_expired_batches(db: Session) -> int:
    cutoff = datetime.now(timezone.utc) - timedelta(days=settings.DATA_RETENTION_DAYS)

    expired = db.scalars(
        select(DataArchiveBatch).where(
            DataArchiveBatch.status == ArchiveStatus.downloaded,
            DataArchiveBatch.downloaded_at < cutoff,
        )
    ).all()

    purged_count = 0
    for batch in expired:
        db.query(Submission).filter(
            Submission.accepted_at >= batch.period_start,
            Submission.accepted_at < batch.period_end,
        ).delete(synchronize_session=False)

        batch.status = ArchiveStatus.purged
        batch.purged_at = datetime.now(timezone.utc)
        purged_count += 1

    db.commit()
    return purged_count
