from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import ContestAttemptStatus


class ContestAttempt(Base):
    """
    One timed, personalized "contest" session: the student is handed a
    single problem picked from a skill they're weak in (see
    services.skill_analysis.pick_weak_skill_problem), given a countdown
    timer, writes code against it, and submits. Grading is AI-based —
    see CONTEST_JUDGE_PROMPT in services/ai_assistant.py and
    services/contest_simulator.py — there's no sandboxed code executor
    in this app, so "checked against a well-optimized answer" means the
    AI compares the student's code to a cached reference solution
    (services/ai_assistant.py: REFERENCE_SOLUTION_PROMPT) rather than
    literally running either one.
    """

    __tablename__ = "contest_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id"))

    # The weak-skill tag this attempt was generated to target — kept
    # even though it's also one of the problem's own tags, since a
    # problem can carry several tags and we want to know which one
    # specifically triggered the pick.
    skill_tag: Mapped[str] = mapped_column(String(100), default="")

    started_at: Mapped[datetime] = mapped_column(DateTime)
    time_limit_seconds: Mapped[int] = mapped_column(Integer, default=1800)
    deadline_at: Mapped[datetime] = mapped_column(DateTime)

    language: Mapped[str] = mapped_column(String(30), default="python")
    code: Mapped[str] = mapped_column(Text, default="")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    status: Mapped[ContestAttemptStatus] = mapped_column(
        Enum(ContestAttemptStatus), default=ContestAttemptStatus.in_progress
    )
    # 0-100, from the AI judge — deliberately coarse-grained rather
    # than a fake "test cases passed" count, since nothing here is
    # actually executed.
    ai_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    verdict: Mapped[str] = mapped_column(String(30), default="")  # pass | needs_work | fail
    ai_feedback: Mapped[str] = mapped_column(Text, default="")
    time_taken_seconds: Mapped[int | None] = mapped_column(Integer, nullable=True)

    problem: Mapped["Problem"] = relationship()
