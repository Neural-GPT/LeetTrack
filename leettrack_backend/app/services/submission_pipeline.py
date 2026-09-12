"""
Runs on a schedule (Celery beat, see app/worker.py) — for every
not-yet-accepted submission whose student might plausibly have solved it
since the last check, ask the verifier. On a fresh accept: compute
solve_position, score it, and update the student's streak.

Kept as a plain function (`poll_pending_submissions`) so it's callable
from Celery, a manual admin endpoint, or a test — same pattern as
services/archival.py.
"""

from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import SubmissionStatus
from app.models.submission import Submission
from app.models.user import StudentProfile
from app.services.scoring import ScoreInputs, compute_submission_score
from app.services.verification.base import SubmissionVerifier
from app.services.verification.leetcode_graphql import get_verifier


def _update_streak(db: Session, student_id: int, solved_at: datetime) -> None:
    profile = db.scalar(
        select(StudentProfile).where(StudentProfile.user_id == student_id)
    )
    if not profile:
        return

    solved_date = solved_at.date()
    last = profile.last_solved_date.date() if profile.last_solved_date else None

    if last == solved_date:
        pass  # already counted today
    elif last == solved_date - timedelta(days=1):
        profile.current_streak += 1
    else:
        profile.current_streak = 1

    profile.longest_streak = max(profile.longest_streak, profile.current_streak)
    profile.last_solved_date = solved_at


def poll_pending_submissions(
    db: Session,
    verifier: SubmissionVerifier | None = None,
    limit: int = 200,
    student_id: int | None = None,
) -> dict:
    """
    Returns a summary dict for logging/observability. `student_id`
    scopes this to one student's pending submissions — used by the
    "check now" button on the dashboard (see
    routers/students.py:refresh_my_submissions) so a student doesn't
    have to wait for the next Celery beat cycle after solving something.
    """
    verifier = verifier or get_verifier()

    query = select(Submission).where(
        Submission.status.in_([SubmissionStatus.not_started, SubmissionStatus.attempted])
    )
    if student_id is not None:
        query = query.where(Submission.student_id == student_id)

    pending = db.scalars(query.limit(limit)).all()

    newly_accepted = 0

    for submission in pending:
        assignment = submission.assignment
        problem = assignment.problem
        profile = db.scalar(
            select(StudentProfile).where(
                StudentProfile.user_id == submission.student_id
            )
        )
        if not profile or not profile.leetcode_username or not problem.slug:
            continue

        result = verifier.check(profile.leetcode_username, problem.slug)

        if not result.solved:
            if result.total_attempts:
                submission.status = SubmissionStatus.attempted
                submission.total_attempts += result.total_attempts
            continue

        # SQLite drops tzinfo on round-trip, so assignment.deadline/
        # release_time come back naive even though they were stored
        # tz-aware. Normalize everything to naive UTC for comparison.
        now = result.accepted_at or datetime.now(timezone.utc)
        now = now.replace(tzinfo=None) if now.tzinfo else now
        is_late = now > assignment.deadline

        prior_solvers = db.query(Submission).filter(
            Submission.assignment_id == assignment.id,
            Submission.status == SubmissionStatus.accepted,
        ).count()
        target_count = db.query(Submission).filter(
            Submission.assignment_id == assignment.id
        ).count()

        submission.status = SubmissionStatus.accepted
        submission.accepted_at = now
        # Stamped separately from accepted_at (see models/submission.py)
        # — this is "right now", the moment this app credited it,
        # regardless of when LeetCode says the student actually solved
        # it. That's what site analytics counts as a submission.
        submission.graded_at = datetime.now(timezone.utc).replace(tzinfo=None)
        submission.total_attempts = max(submission.total_attempts, 1)
        submission.solve_position = prior_solvers + 1

        score = compute_submission_score(
            ScoreInputs(
                P=assignment.problem_score,
                T=max(
                    0.0,
                    (now - assignment.release_time).total_seconds() / 60,
                ),
                A=submission.total_attempts,
                X=submission.solve_position,
                M=target_count,
                deadline_minutes=(
                    assignment.deadline - assignment.release_time
                ).total_seconds()
                / 60,
                is_late=is_late,
                streak_days=profile.current_streak,
            )
        )
        submission.score = score

        _update_streak(db, submission.student_id, now)
        newly_accepted += 1

    db.commit()
    return {"checked": len(pending), "newly_accepted": newly_accepted}
