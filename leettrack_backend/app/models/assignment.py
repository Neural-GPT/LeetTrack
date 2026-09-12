from datetime import datetime

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import AssignmentScope, Difficulty


class Problem(Base):
    __tablename__ = "problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    title: Mapped[str] = mapped_column(String(200))
    leetcode_url: Mapped[str] = mapped_column(String(500))
    # e.g. "two-sum" — parsed from leetcode_url, used to match against
    # LeetCode's recentAcSubmissionList in the verification module.
    slug: Mapped[str] = mapped_column(String(200), default="")
    difficulty: Mapped[Difficulty] = mapped_column(Enum(Difficulty))
    tags: Mapped[str] = mapped_column(String(300), default="")  # comma-separated


class Assignment(Base):
    __tablename__ = "assignments"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    problem_id: Mapped[int] = mapped_column(ForeignKey("problems.id"))
    teacher_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    scope: Mapped[AssignmentScope] = mapped_column(Enum(AssignmentScope))
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id"))

    assigned_date: Mapped[datetime] = mapped_column(DateTime)
    release_time: Mapped[datetime] = mapped_column(DateTime)
    deadline: Mapped[datetime] = mapped_column(DateTime)

    notes: Mapped[str] = mapped_column(Text, default="")
    hint: Mapped[str] = mapped_column(Text, default="")
    problem_score: Mapped[int] = mapped_column(Integer, default=10)
    # Teacher opt-in: only assignments with this set to True are
    # selectable in the student AI assistant's problem picker.
    allow_ai_help: Mapped[bool] = mapped_column(default=False)

    problem: Mapped["Problem"] = relationship()
    targets: Mapped[list["AssignmentTarget"]] = relationship(
        back_populates="assignment", cascade="all, delete-orphan"
    )


class AssignmentTarget(Base):
    """Explicit student targets when scope == 'students'."""

    __tablename__ = "assignment_targets"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    assignment_id: Mapped[int] = mapped_column(ForeignKey("assignments.id"))
    student_id: Mapped[int] = mapped_column(ForeignKey("users.id"))

    assignment: Mapped["Assignment"] = relationship(back_populates="targets")
