from sqlalchemy import select
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.enums import Role
from app.models.user import StudentProfile, User
from app.services import github_stats, leetcode_profile, leetcode_stats
from app.services.gamification import (
    AchievementDef,
    build_achievement_context,
    compute_level_progress,
    compute_xp,
    list_achievements,
    sync_achievement_unlocks,
)
from app.services.weekly import compute_weekly_digest, current_week_start, set_weekly_goal

router = APIRouter(prefix="/api/gamification", tags=["gamification"])


def _get_profile(db: Session, user: User) -> StudentProfile:
    profile = db.scalar(select(StudentProfile).where(StudentProfile.user_id == user.id))
    if not profile:
        raise HTTPException(404, "Student profile not found.")
    return profile


def _current_xp(db: Session, profile: StudentProfile) -> int:
    counts = leetcode_stats.get_cached_or_refresh(db, profile)
    return compute_xp(counts.easy, counts.medium, counts.hard)


def _sync_and_get_newly_unlocked(
    db: Session, user: User, profile: StudentProfile
) -> list[AchievementDef]:
    """Shared by both achievement endpoints: refreshes LeetCode-wide
    solved counts, builds the full AchievementContext (streaks,
    difficulty counts, GitHub link, time-of-day patterns), and syncs —
    returning whatever unlocked just now."""
    counts = leetcode_stats.get_cached_or_refresh(db, profile)
    xp = compute_xp(counts.easy, counts.medium, counts.hard)
    ctx = build_achievement_context(
        db,
        user.id,
        xp=xp,
        current_streak=profile.current_streak,
        longest_streak=profile.longest_streak,
        easy_solved=counts.easy,
        medium_solved=counts.medium,
        hard_solved=counts.hard,
        github_connected=bool(profile.github_username),
    )
    return sync_achievement_unlocks(db, user.id, ctx)


class LevelOut(BaseModel):
    xp: int
    level: int
    is_max_level: bool
    xp_into_level: int
    xp_needed_for_level: int
    progress_fraction: float


@router.get("/level", response_model=LevelOut)
def get_level(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    Powers the level/XP progress bar shown just left of the feedback
    pill (see components/LevelProgressBar.tsx). XP is recomputed from
    the student's current LeetCode-wide solved counts every call — see
    services/gamification.py's module docstring for why that's safe.
    """
    profile = _get_profile(db, user)
    xp = _current_xp(db, profile)
    p = compute_level_progress(xp)
    return LevelOut(
        xp=p.xp, level=p.level, is_max_level=p.is_max_level,
        xp_into_level=p.xp_into_level, xp_needed_for_level=p.xp_needed_for_level,
        progress_fraction=p.progress_fraction,
    )


class AchievementOut(BaseModel):
    key: str
    title: str
    description: str
    icon: str
    unlocked: bool
    unlocked_at: str | None
    status: str
    hint: str


@router.get("/achievements", response_model=list[AchievementOut])
def get_achievements(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    profile = _get_profile(db, user)
    _sync_and_get_newly_unlocked(db, user, profile)
    views = list_achievements(db, user.id)
    return [
        AchievementOut(
            key=v.key, title=v.title, description=v.description, icon=v.icon,
            unlocked=v.unlocked, unlocked_at=v.unlocked_at, status=v.status,
            hint=v.hint,
        )
        for v in views
    ]


class NewlyUnlockedOut(BaseModel):
    key: str
    title: str
    description: str
    icon: str


@router.get("/achievements/check", response_model=list[NewlyUnlockedOut])
def check_newly_unlocked_achievements(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """
    Lightweight poll target for the achievement popup (see
    components/AchievementToast.tsx) — mounted app-wide so a student
    gets celebrated for a new unlock no matter which page they're on,
    not just the Achievements page. Runs the same idempotent sync as
    GET /achievements; this just surfaces (and only surfaces) whatever
    unlocked in THIS call, so calling it repeatedly with nothing new
    returns an empty list rather than re-announcing old unlocks.
    """
    profile = _get_profile(db, user)
    newly = _sync_and_get_newly_unlocked(db, user, profile)
    return [
        NewlyUnlockedOut(key=a.key, title=a.title, description=a.description, icon=a.icon)
        for a in newly
    ]


class DifficultyBreakdownOut(BaseModel):
    easy: int
    medium: int
    hard: int
    total: int


class ProgressOut(BaseModel):
    connected: bool
    username: str | None = None
    real_name: str | None = None
    avatar_url: str | None = None
    ranking: int | None = None
    country: str | None = None
    github_url: str | None = None
    github_connected: bool = False
    website: str | None = None
    solved: DifficultyBreakdownOut | None = None
    total_questions: DifficultyBreakdownOut | None = None
    attempting: int = 0
    submission_calendar: dict[str, int] = Field(default_factory=dict)
    total_active_days: int = 0
    max_streak: int = 0
    total_submissions_past_year: int = 0


@router.get("/progress", response_model=ProgressOut)
def get_progress(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """Powers the Achievements page's "Progress" tab — profile card,
    circular solved-vs-total ring, and submission heatmap, all sourced
    live from the student's public LeetCode profile.

    GitHub is separate: github_url/github_connected reflect the
    student's own manually-connected GitHub username (set from this
    page's "Connect GitHub" prompt, stored on StudentProfile), not
    whatever's scraped off their LeetCode profile — that field is
    often left blank there, so we don't rely on it."""
    profile = _get_profile(db, user)
    manual_github_url = (
        f"https://github.com/{profile.github_username}" if profile.github_username else None
    )

    if not profile.leetcode_username:
        return ProgressOut(
            connected=False,
            github_url=manual_github_url,
            github_connected=bool(profile.github_username),
        )

    lc = leetcode_profile.fetch_leetcode_profile(profile.leetcode_username)
    if lc is None:
        return ProgressOut(
            connected=False,
            username=profile.leetcode_username,
            github_url=manual_github_url,
            github_connected=bool(profile.github_username),
        )

    return ProgressOut(
        connected=True,
        username=lc.username,
        real_name=lc.real_name,
        avatar_url=lc.avatar_url,
        ranking=lc.ranking,
        country=lc.country,
        github_url=manual_github_url or lc.github_url or None,
        github_connected=bool(profile.github_username),
        website=lc.website,
        solved=DifficultyBreakdownOut(
            easy=lc.solved.easy, medium=lc.solved.medium, hard=lc.solved.hard, total=lc.solved.total
        ),
        total_questions=DifficultyBreakdownOut(
            easy=lc.total_questions.easy, medium=lc.total_questions.medium,
            hard=lc.total_questions.hard, total=lc.total_questions.total,
        ),
        attempting=lc.attempting,
        submission_calendar=lc.submission_calendar,
        total_active_days=lc.total_active_days,
        max_streak=lc.max_streak,
        total_submissions_past_year=lc.total_submissions_past_year,
    )


class RepoStatOut(BaseModel):
    name: str
    commits: int
    stars: int
    forks: int
    language: str | None


class GithubStatsOut(BaseModel):
    connected: bool
    username: str | None = None
    name: str | None = None
    avatar_url: str | None = None
    bio: str | None = None
    public_repos: int = 0
    followers: int = 0
    following: int = 0
    profile_url: str | None = None
    total_stars: int = 0
    total_forks: int = 0
    top_repos: list[RepoStatOut] = Field(default_factory=list)
    language_breakdown: dict[str, int] = Field(default_factory=dict)


@router.get("/github", response_model=GithubStatsOut)
def get_github_stats(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    """Powers the Achievements page's GitHub statistics/graphs section —
    sourced live from the student's manually-connected GitHub username
    (StudentProfile.github_username, set in Settings or the Progress
    tab's "Connect GitHub" prompt), via GitHub's public REST API."""
    profile = _get_profile(db, user)
    if not profile.github_username:
        return GithubStatsOut(connected=False)

    gh = github_stats.fetch_github_stats(profile.github_username)
    if gh is None:
        return GithubStatsOut(connected=False, username=profile.github_username)

    return GithubStatsOut(
        connected=True,
        username=gh.username,
        name=gh.name,
        avatar_url=gh.avatar_url,
        bio=gh.bio,
        public_repos=gh.public_repos,
        followers=gh.followers,
        following=gh.following,
        profile_url=gh.profile_url,
        total_stars=gh.total_stars,
        total_forks=gh.total_forks,
        top_repos=[RepoStatOut(**r.__dict__) for r in gh.top_repos],
        language_breakdown=gh.language_breakdown,
    )


class WeeklyGoalIn(BaseModel):
    target_type: str = Field(pattern="^(problems|xp)$")
    target_value: float = Field(gt=0)


class WeeklyDigestOut(BaseModel):
    week_start: str
    goal_target_type: str | None
    goal_target_value: float | None
    goal_progress: float
    goal_met: bool
    problems_solved_this_week: int
    xp_earned_this_week: int
    leaderboard_topper_name: str | None
    leaderboard_topper_score: float | None
    my_rank: int | None
    my_score: float | None
    class_size: int


@router.get("/weekly", response_model=WeeklyDigestOut)
def get_weekly(
    user: User = Depends(require_role(Role.student)), db: Session = Depends(get_db)
):
    d = compute_weekly_digest(db, user)
    return WeeklyDigestOut(**d.__dict__)


@router.post("/weekly/goal", response_model=WeeklyDigestOut)
def post_weekly_goal(
    payload: WeeklyGoalIn,
    user: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    set_weekly_goal(db, user.id, current_week_start(), payload.target_type, payload.target_value)
    d = compute_weekly_digest(db, user)
    return WeeklyDigestOut(**d.__dict__)
