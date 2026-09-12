import re

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.assignment import Assignment, AssignmentTarget
from app.models.enums import AssignmentScope
from app.models.submission import Submission
from app.models.user import StudentProfile


def slug_from_leetcode_url(url: str) -> str:
    """https://leetcode.com/problems/two-sum/ -> 'two-sum'"""
    match = re.search(r"/problems/([a-z0-9\-]+)/?", url)
    return match.group(1) if match else ""


def resolve_target_student_ids(db: Session, assignment: Assignment) -> list[int]:
    """Every student (by user_id) this assignment applies to, based on scope."""
    if assignment.scope == AssignmentScope.students:
        return [
            t.student_id
            for t in db.scalars(
                select(AssignmentTarget).where(
                    AssignmentTarget.assignment_id == assignment.id
                )
            ).all()
        ]

    query = select(StudentProfile.user_id)
    if assignment.scope == AssignmentScope.section:
        query = query.where(StudentProfile.section_id == assignment.section_id)
    # scope == batch: no filter, everyone

    return list(db.scalars(query).all())


def backfill_submissions_for_new_student(
    db: Session, student_user_id: int, section_id: int | None
) -> int:
    """
    Assignments are seeded with Submission rows at creation time, for
    whoever exists *then*. Without this, a student who registers after an
    assignment goes out never gets a row for it and it silently never
    shows up on their dashboard — that's the bug this fixes.

    Explicit "specific students" assignments are deliberately NOT
    backfilled — that scope means the teacher picked exact people, and a
    student who wasn't one of them at creation time still isn't one now.
    """
    query = select(Assignment).where(
        (Assignment.scope == AssignmentScope.batch)
        | (
            (Assignment.scope == AssignmentScope.section)
            & (Assignment.section_id == section_id)
        )
    )
    assignments = db.scalars(query).all()

    created = 0
    for assignment in assignments:
        already_has = db.scalar(
            select(Submission).where(
                Submission.assignment_id == assignment.id,
                Submission.student_id == student_user_id,
            )
        )
        if already_has:
            continue
        db.add(Submission(assignment_id=assignment.id, student_id=student_user_id))
        created += 1

    return created
