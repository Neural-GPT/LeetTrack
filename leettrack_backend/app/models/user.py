from datetime import datetime, timezone

from sqlalchemy import DateTime, Enum, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base_class import Base
from app.models.enums import Role, Theme


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True)
    username: Mapped[str] = mapped_column(String(50), unique=True, index=True)
    password_hash: Mapped[str] = mapped_column(String(255))
    role: Mapped[Role] = mapped_column(Enum(Role), default=Role.student)
    is_active: Mapped[bool] = mapped_column(default=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
    # Touched on every authenticated request (see api/deps.py) — backs
    # the "N students online" count. Not a precise presence system (no
    # websocket/disconnect detection), just a rolling "active in the
    # last few minutes" window.
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    student_profile: Mapped["StudentProfile"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    teacher_profile: Mapped["TeacherProfile"] = relationship(
        back_populates="user", uselist=False, cascade="all, delete-orphan"
    )


class Section(Base):
    __tablename__ = "sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    name: Mapped[str] = mapped_column(String(50), unique=True)  # e.g. "BCA-2B"
    year: Mapped[str] = mapped_column(String(20), default="")
    department: Mapped[str] = mapped_column(String(50), default="BCA")


class StudentProfile(Base):
    __tablename__ = "student_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))
    section_id: Mapped[int | None] = mapped_column(ForeignKey("sections.id"))
    # Nullable: no longer collected at signup (registration is now just
    # name/email/password + OTP). Students add this later from Settings
    # — until they do, submission verification can't run for them.
    leetcode_username: Mapped[str | None] = mapped_column(
        String(50), unique=True, nullable=True
    )

    # Manually connected by the student from the Achievements > Progress
    # panel (see api/routers/gamification.py) — separate from whatever
    # GitHub URL (if any) is set on their public LeetCode profile, since
    # that field is often left blank. Visible to the Super Admin via
    # /api/admin/students. Empty string, not null, when unset.
    github_username: Mapped[str] = mapped_column(String(100), default="")

    # Cached LeetCode solved-counts (see services/leetcode_stats.py) —
    # refreshed on-demand when stale rather than fetched live every
    # request, since LeetCode's endpoint is unofficial and rate-limited.
    leetcode_easy_solved: Mapped[int] = mapped_column(default=0)
    leetcode_medium_solved: Mapped[int] = mapped_column(default=0)
    leetcode_hard_solved: Mapped[int] = mapped_column(default=0)
    leetcode_stats_updated_at: Mapped[datetime | None] = mapped_column(
        DateTime, nullable=True
    )

    theme: Mapped[Theme] = mapped_column(Enum(Theme), default=Theme.dark)
    notify_new_assignment: Mapped[bool] = mapped_column(default=True)
    notify_deadline: Mapped[bool] = mapped_column(default=True)
    notify_missed: Mapped[bool] = mapped_column(default=True)
    notify_streak_broken: Mapped[bool] = mapped_column(default=True)
    notify_weekly_results: Mapped[bool] = mapped_column(default=True)
    notify_leaderboard: Mapped[bool] = mapped_column(default=False)

    current_streak: Mapped[int] = mapped_column(default=0)
    longest_streak: Mapped[int] = mapped_column(default=0)
    last_solved_date: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)

    user: Mapped["User"] = relationship(back_populates="student_profile")
    section: Mapped["Section"] = relationship()


class TeacherProfile(Base):
    __tablename__ = "teacher_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), unique=True)
    full_name: Mapped[str] = mapped_column(String(120))

    user: Mapped["User"] = relationship(back_populates="teacher_profile")
