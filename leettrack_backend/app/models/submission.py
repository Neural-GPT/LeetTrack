from datetime import datetime

from sqlalchemy import DateTime, Enum, Float, ForeignKey, Integer
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import SubmissionStatus


class Submission(Base):
    __tablename__ = "submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"))
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    status: Mapped[SubmissionStatus] = mapped_column(
        Enum(SubmissionStatus), default=SubmissionStatus.not_started
    )
    total_attempts: Mapped[int] = mapped_column(Integer, default=0)
    # When LeetCode says the student actually solved it — used for
    # scoring (lateness, solve_position, streak date) so a student who
    # solved before the deadline isn't penalized just for checking in
    # late. Can predate this submission row entirely (e.g. the problem
    # was already solved on LeetCode before the assignment existed).
    accepted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # When THIS app actually credited/scored it — i.e. when
    # poll_pending_submissions (the Celery beat cycle or a student's
    # own "Check for updates" click) verified and accepted it. Distinct
    # from accepted_at on purpose: site-wide analytics (Data Center ->
    # Site analytics -> Submissions) buckets by this column, not
    # accepted_at, so a submission that turns out to have already been
    # solved on LeetCode weeks ago — and only gets credited today —
    # still shows up as today's platform activity instead of silently
    # landing in (or falling outside) some past day's analytics.
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    # 1-based position among students who solved this assignment (for score's X variable)
    solve_position: Mapped[int | None] = mapped_column(Integer, nullable=True)
    # Computed by services/scoring.py once verified — see services/submission_pipeline.py
    score: Mapped[float] = mapped_column(Float, default=0)

    assignment: Mapped["Assignment"] = relationship()
    # Read-only convenience relationship straight to the StudentProfile
    # (not User) — used by the Data Center export for section/streak
    # context without extra queries. viewonly since ownership/cascading
    # for the student side already lives on User/StudentProfile.
    student: Mapped["StudentProfile"] = relationship(
        primaryjoin="Submission.student_id == StudentProfile.user_id",
        foreign_keys=[student_id],
        viewonly=True,
    )
