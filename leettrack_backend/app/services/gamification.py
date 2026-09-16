"""
XP / Level / Achievement logic for the student gamification system.

XP is computed directly from a student's LeetCode-wide solved counts
(app/services/leetcode_stats.py) rather than tracked as an incremental
ledger — solved counts only ever go up, so recomputing total XP from
the current totals each time is simpler and can't drift or double-count
on a retry/re-poll:

    xp = 10*easy_solved + 15*medium_solved + 25*hard_solved

Levels 1-5 each have their own XP requirement (NOT cumulative — each
level needs that many *additional* XP on top of the last):
    Level 1: 20 XP   Level 2: 30 XP   Level 3: 30 XP
    Level 4: 40 XP   Level 5: 50 XP
170 XP total clears all five. A student who has cleared level 5 is
shown as level 6 ("max") with a full bar.

---------------------------------------------------------------------
Achievements
---------------------------------------------------------------------
A flat catalog (ACHIEVEMENTS below) of small, independently-checkable
"fun" milestones spanning several signals already tracked elsewhere in
the app — level clears, solve streaks, total/difficulty solve counts,
a GitHub connection, and a few playful ones mined from *when* a
student's submissions were accepted (night owl / early bird / weekend
warrior). Nothing here needs a new table: every achievement is still
just a row in AchievementUnlock (user_id, achievement_key), same as
before — only the catalog and the context used to check it grew.

sync_achievement_unlocks is idempotent (safe to call on every page
load / poll) and returns the achievements that were newly unlocked BY
THAT CALL — that return value is what drives the in-app "you just
unlocked X!" popup, since the row's mere existence afterward can't
tell "brand new" apart from "unlocked last week."
"""

from dataclasses import dataclass
from datetime import timedelta
from typing import Callable

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.enums import SubmissionStatus
from app.models.gamification import AchievementUnlock
from app.models.submission import Submission

XP_PER_EASY = 10
XP_PER_MEDIUM = 15
XP_PER_HARD = 25

# XP required to CLEAR each level (index 0 -> level 1's requirement).
LEVEL_XP_REQUIREMENTS = [20, 30, 30, 40, 50]
MAX_LEVEL = len(LEVEL_XP_REQUIREMENTS)  # 5

# Cumulative XP needed to have cleared level N (1-indexed via list
# position) — e.g. _CUMULATIVE[2] (level 3) == 80.
_CUMULATIVE: list[int] = []
_running = 0
for _req in LEVEL_XP_REQUIREMENTS:
    _running += _req
    _CUMULATIVE.append(_running)

# Same IST offset used by services/analytics.py, kept local here so
# this module doesn't need to import from analytics.py just for a
# timedelta — accepted_at is stored the same naive-UTC way everywhere.
IST_OFFSET = timedelta(hours=5, minutes=30)


def compute_xp(easy: int, medium: int, hard: int) -> int:
    return XP_PER_EASY * easy + XP_PER_MEDIUM * medium + XP_PER_HARD * hard


@dataclass
class LevelProgress:
    xp: int
    level: int  # 1-5 while climbing, MAX_LEVEL + 1 once fully cleared
    is_max_level: bool
    xp_into_level: int
    xp_needed_for_level: int  # 0 once maxed
    progress_fraction: float  # 0..1, for the progress bar


def compute_level_progress(xp: int) -> LevelProgress:
    if xp >= _CUMULATIVE[-1]:
        return LevelProgress(
            xp=xp,
            level=MAX_LEVEL + 1,
            is_max_level=True,
            xp_into_level=0,
            xp_needed_for_level=0,
            progress_fraction=1.0,
        )

    for i, cum_target in enumerate(_CUMULATIVE):
        if xp < cum_target:
            floor = _CUMULATIVE[i - 1] if i > 0 else 0
            needed = LEVEL_XP_REQUIREMENTS[i]
            into = xp - floor
            return LevelProgress(
                xp=xp,
                level=i + 1,
                is_max_level=False,
                xp_into_level=into,
                xp_needed_for_level=needed,
                progress_fraction=round(into / needed, 4) if needed else 0.0,
            )

    # Unreachable (the >= check above covers the top end), kept only
    # so this always returns a LevelProgress.
    return LevelProgress(
        xp=xp, level=1, is_max_level=False, xp_into_level=xp,
        xp_needed_for_level=LEVEL_XP_REQUIREMENTS[0], progress_fraction=0.0,
    )


def highest_level_cleared(xp: int) -> int:
    """How many full levels this XP total has cleared (0-5)."""
    cleared = 0
    for cum_target in _CUMULATIVE:
        if xp >= cum_target:
            cleared += 1
    return cleared


# ---------------------------------------------------------------------
# Achievement catalog
# ---------------------------------------------------------------------


@dataclass
class AchievementContext:
    """Everything an achievement's `check` might need, gathered once
    per sync so individual checks stay simple boolean expressions."""

    xp: int
    levels_cleared: int
    current_streak: int
    longest_streak: int
    easy_solved: int
    medium_solved: int
    hard_solved: int
    total_solved: int
    github_connected: bool
    solved_at_night: bool  # any accepted submission between 12am-4am IST
    solved_early_morning: bool  # any accepted submission between 5am-7am IST
    solved_on_weekend: bool  # any accepted submission on a Sat/Sun (IST)


@dataclass
class AchievementDef:
    key: str
    title: str
    description: str
    icon: str
    hint: str  # shown in place of the description while still locked
    check: Callable[[AchievementContext], bool]


ACHIEVEMENTS: list[AchievementDef] = [
    # --- Level ladder --------------------------------------------------
    AchievementDef(
        "level_1_clear", "First Steps", "Cleared Level 1 by earning 20 XP.",
        "seedling", "Reach Level 1 (20 XP) to unlock.",
        lambda c: c.levels_cleared >= 1,
    ),
    AchievementDef(
        "level_2_clear", "Second Wind", "Cleared Level 2.",
        "sprout", "Reach Level 2 to unlock.",
        lambda c: c.levels_cleared >= 2,
    ),
    AchievementDef(
        "level_3_clear", "Building Momentum", "Cleared Level 3.",
        "flame", "Reach Level 3 to unlock.",
        lambda c: c.levels_cleared >= 3,
    ),
    AchievementDef(
        "level_4_clear", "Almost There", "Cleared Level 4.",
        "star", "Reach Level 4 to unlock.",
        lambda c: c.levels_cleared >= 4,
    ),
    AchievementDef(
        "level_5_clear", "Peak Performer", "Cleared Level 5: the top of the ladder.",
        "crown", "Reach Level 5 to unlock.",
        lambda c: c.levels_cleared >= 5,
    ),
    # --- Streaks ---------------------------------------------------------
    AchievementDef(
        "streak_3", "Warming Up", "Hit a 3-day solving streak.",
        "sunrise", "Hit a 3-day streak to unlock.",
        lambda c: c.longest_streak >= 3,
    ),
    AchievementDef(
        "streak_7", "On a Roll", "Hit a 7-day solving streak.",
        "bolt", "Hit a 7-day streak to unlock.",
        lambda c: c.longest_streak >= 7,
    ),
    AchievementDef(
        "streak_30", "Unstoppable", "Hit a 30-day solving streak.",
        "rocket", "Hit a 30-day streak to unlock.",
        lambda c: c.longest_streak >= 30,
    ),
    # --- Total solved (LeetCode-wide) ------------------------------------
    AchievementDef(
        "solved_50", "Half Century", "Solved 50 problems on LeetCode.",
        "medal_silver", "Solve 50 problems total to unlock.",
        lambda c: c.total_solved >= 50,
    ),
    AchievementDef(
        "solved_100", "Century Club", "Solved 100 problems on LeetCode.",
        "medal_gold", "Solve 100 problems total to unlock.",
        lambda c: c.total_solved >= 100,
    ),
    AchievementDef(
        "solved_250", "Grind Never Stops", "Solved 250 problems on LeetCode.",
        "mountain", "Solve 250 problems total to unlock.",
        lambda c: c.total_solved >= 250,
    ),
    # --- Difficulty specialists -------------------------------------------
    AchievementDef(
        "hard_10", "Hard Mode", "Solved 10 Hard problems.",
        "sword", "Solve 10 Hard problems to unlock.",
        lambda c: c.hard_solved >= 10,
    ),
    AchievementDef(
        "hard_25", "Boss Battles", "Solved 25 Hard problems.",
        "swords", "Solve 25 Hard problems to unlock.",
        lambda c: c.hard_solved >= 25,
    ),
    # --- Playful, time-of-day ones (from this app's own submissions) -----
    AchievementDef(
        "night_owl", "Night Owl", "Got a problem accepted between midnight and 4am.",
        "owl", "Get a submission accepted between 12am–4am IST.",
        lambda c: c.solved_at_night,
    ),
    AchievementDef(
        "early_bird", "Early Bird", "Got a problem accepted before 7am.",
        "bird", "Get a submission accepted between 5am–7am IST.",
        lambda c: c.solved_early_morning,
    ),
    AchievementDef(
        "weekend_warrior", "Weekend Warrior", "Got a problem accepted on a weekend.",
        "beach", "Get a submission accepted on a Saturday or Sunday.",
        lambda c: c.solved_on_weekend,
    ),
    # --- Profile -----------------------------------------------------------
    AchievementDef(
        "github_linked", "All Linked Up", "Connected a GitHub account.",
        "link", "Connect your GitHub username from Settings to unlock.",
        lambda c: c.github_connected,
    ),
]

ACHIEVEMENTS_BY_KEY: dict[str, AchievementDef] = {a.key: a for a in ACHIEVEMENTS}


def _time_based_flags(db: Session, user_id: int) -> tuple[bool, bool, bool]:
    """Scans this student's own accepted submissions (not LeetCode-wide —
    just what's flowed through this app's assignments) for a few
    playful time-of-day patterns. Cheap: one column, one student."""
    timestamps = db.scalars(
        select(Submission.accepted_at).where(
            Submission.student_id == user_id,
            Submission.status == SubmissionStatus.accepted,
            Submission.accepted_at.isnot(None),
        )
    ).all()

    night = early = weekend = False
    for ts in timestamps:
        if ts is None:
            continue
        ist = ts + IST_OFFSET
        if 0 <= ist.hour < 4:
            night = True
        if 5 <= ist.hour < 7:
            early = True
        if ist.weekday() >= 5:  # Saturday=5, Sunday=6
            weekend = True
        if night and early and weekend:
            break
    return night, early, weekend


def build_achievement_context(
    db: Session,
    user_id: int,
    *,
    xp: int,
    current_streak: int,
    longest_streak: int,
    easy_solved: int,
    medium_solved: int,
    hard_solved: int,
    github_connected: bool,
) -> AchievementContext:
    night, early, weekend = _time_based_flags(db, user_id)
    return AchievementContext(
        xp=xp,
        levels_cleared=highest_level_cleared(xp),
        current_streak=current_streak,
        longest_streak=longest_streak,
        easy_solved=easy_solved,
        medium_solved=medium_solved,
        hard_solved=hard_solved,
        total_solved=easy_solved + medium_solved + hard_solved,
        github_connected=github_connected,
        solved_at_night=night,
        solved_early_morning=early,
        solved_on_weekend=weekend,
    )


def sync_achievement_unlocks(
    db: Session, user_id: int, ctx: AchievementContext
) -> list[AchievementDef]:
    """Creates any AchievementUnlock rows the student has newly earned.
    Idempotent — safe to call on every achievements-page load or popup
    poll. Returns the achievements unlocked BY THIS CALL (empty list
    most of the time)."""
    already = {
        row.achievement_key
        for row in db.scalars(
            select(AchievementUnlock).where(AchievementUnlock.user_id == user_id)
        ).all()
    }
    newly: list[AchievementDef] = []
    for a in ACHIEVEMENTS:
        if a.key not in already and a.check(ctx):
            db.add(AchievementUnlock(user_id=user_id, achievement_key=a.key))
            newly.append(a)
    if newly:
        db.commit()
    return newly


@dataclass
class AchievementView:
    key: str
    title: str
    description: str
    icon: str
    unlocked: bool
    unlocked_at: str | None
    status: str  # "unlocked" | "next" | "locked"
    hint: str


def list_achievements(db: Session, user_id: int) -> list[AchievementView]:
    """
    Ordered: every unlocked achievement first (catalog order), then the
    next TWO not-yet-cleared ones (status "next" — the frontend shows
    their hint text), then any remaining ones as plain "locked".
    """
    unlocked_rows = {
        row.achievement_key: row.unlocked_at
        for row in db.scalars(
            select(AchievementUnlock).where(AchievementUnlock.user_id == user_id)
        ).all()
    }

    unlocked: list[AchievementView] = []
    locked: list[AchievementView] = []

    for a in ACHIEVEMENTS:
        if a.key in unlocked_rows:
            when = unlocked_rows[a.key]
            unlocked.append(
                AchievementView(
                    key=a.key, title=a.title, description=a.description, icon=a.icon,
                    unlocked=True, unlocked_at=when.isoformat() if when else None,
                    status="unlocked", hint=a.hint,
                )
            )
        else:
            locked.append(
                AchievementView(
                    key=a.key, title=a.title, description=a.description, icon=a.icon,
                    unlocked=False, unlocked_at=None, status="locked", hint=a.hint,
                )
            )

    for i, view in enumerate(locked):
        if i < 2:
            view.status = "next"

    return unlocked + locked
