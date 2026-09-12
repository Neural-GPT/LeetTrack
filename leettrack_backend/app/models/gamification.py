from datetime import date, datetime, timezone

from sqlalchemy import Date, DateTime, Float, ForeignKey, Integer, String, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from app.db.base_class import Base


class AchievementUnlock(Base):
    """
    Records the moment a student clears a level tied to an achievement
    (see LEVEL_ACHIEVEMENTS in services/gamification.py — currently
    levels 1, 3, and 5). One row per student per achievement; the row's
    existence IS the "unlocked" state, so there's no separate flag to
    keep in sync.
    """

    __tablename__ = "achievement_unlocks"
    __table_args__ = (
        UniqueConstraint("user_id", "achievement_key", name="uq_achievement_unlock"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    achievement_key: Mapped[str] = mapped_column(String(50))
    unlocked_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )


class WeeklyGoal(Base):
    """
    A student's self-set target for one ISO week (Monday-start) — either
    a number of problems to solve or an amount of XP to earn that week.
    Read by services/weekly.py to compute the weekly digest's
    goal-progress section. One row per student per week.
    """

    __tablename__ = "weekly_goals"
    __table_args__ = (
        UniqueConstraint("user_id", "week_start", name="uq_weekly_goal"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id"), index=True)
    week_start: Mapped[date] = mapped_column(Date)  # Monday of the target week
    target_type: Mapped[str] = mapped_column(String(20))  # "problems" | "xp"
    target_value: Mapped[float] = mapped_column(Float)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )
