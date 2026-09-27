"""
Teacher-authored free-form coding questions — distinct from the
LeetCode-linked Assignment flow (models/assignment.py). A teacher
writes their own problem statement, students write and submit their
own code (no LeetCode account/verification involved at all), and the
teacher grades every submission by hand. AI assistance is available
per-submission, but only after the teacher has supplied their own
correct reference implementation for the question — the AI compares
the student's code to *that specific* teacher-approved answer (see
CUSTOM_GRADING_PROMPT in services/ai_assistant.py), and only ever
produces a *suggested* score/feedback the teacher can accept, edit, or
ignore. The manual_score/manual_feedback fields the teacher fills in
are what actually counts — ai_score/ai_feedback never are.
"""

from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import AssignmentScope, CustomSubmissionStatus


class CustomQuestion(Base):
    __tablename__ = "custom_questions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text)  # the problem statement itself
    constraints: Mapped[str] = mapped_column(Text, default="")  # input/output rules, examples
    max_score: Mapped[int] = mapped_column(Integer, default=10)

    # The teacher's own correct implementation — required input for
    # this feature, not optional metadata. Nothing else about this
    # model (targeting, deadlines) depends on it, but AI-assisted
    # grading is disabled for the question until it's set (see
    # api/routers/custom_questions.py).
    reference_solution: Mapped[str] = mapped_column(Text, default="")
    reference_language: Mapped[str] = mapped_column(String(30), default="python")

    scope: Mapped[AssignmentScope] = mapped_column(Enum(AssignmentScope))
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id"))

    assigned_date: Mapped[datetime] = mapped_column(DateTime)
    deadline: Mapped[datetime] = mapped_column(DateTime)

    created_at: Mapped[datetime] = mapped_column(DateTime)

    targets: Mapped[list["CustomQuestionTarget"]] = relationship(
        back_populates="question", cascade="all, delete-orphan"
    )


class CustomQuestionTarget(Base):
    """Explicit student targets when scope == 'students' — same shape
    as models.assignment.AssignmentTarget, kept separate since it
    points at a different parent table."""

    __tablename__ = "custom_question_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("custom_questions.id"))
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    question: Mapped["CustomQuestion"] = relationship(back_populates="targets")


class CustomSubmission(Base):
    __tablename__ = "custom_submissions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    question_id: Mapped[int] = mapped_column(ForeignKey("custom_questions.id"))
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    code: Mapped[str] = mapped_column(Text, default="")
    language: Mapped[str] = mapped_column(String(30), default="python")
    submitted_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    status: Mapped[CustomSubmissionStatus] = mapped_column(
        Enum(CustomSubmissionStatus), default=CustomSubmissionStatus.not_started
    )

    # AI-assist output — a suggestion for the teacher, never authoritative.
    ai_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    ai_feedback: Mapped[str] = mapped_column(Text, default="")
    ai_reviewed_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    # What actually counts, set by the teacher — may or may not match
    # the AI's suggestion above.
    manual_score: Mapped[int | None] = mapped_column(Integer, nullable=True)
    manual_feedback: Mapped[str] = mapped_column(Text, default="")
    graded_by: Mapped[int | None] = mapped_column(ForeignKey("users.id"), nullable=True)
    graded_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    question: Mapped["CustomQuestion"] = relationship()
