"""
Pulls a student's GeeksforGeeks practice stats — problems solved (by
GFG's own bucket system: School/Basic/Easy/Medium/Hard, which don't
line up 1:1 with LeetCode's Easy/Medium/Hard) and their GFG "coding
score". GFG doesn't publish an official public API, so this leans on
a community-maintained JSON mirror of the practice profile page
(geeks-for-geeks-api.vercel.app) rather than scraping HTML directly.

Same caveats as the rest of the platform integrations in this codebase
(see leetcode_stats.py / leetcode_profile.py): unofficial, unauthenticated,
no SLA, and the upstream shape can change without notice. Every lookup
here is defensive about missing/renamed fields and returns None on any
failure — callers fall back to whatever's cached, same as LeetCode.
"""

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

GFG_STATS_URL = "https://geeks-for-geeks-api.vercel.app/{username}"

TIMEOUT_SECONDS = 8.0
MAX_RETRIES = 1
GFG_STATS_CACHE_MINUTES = 30  # heavier/flakier than LeetCode's own API, cache longer

_cache: dict[str, tuple[float, "GfgStats"]] = {}


@dataclass
class GfgSolvedBreakdown:
    school: int = 0
    basic: int = 0
    easy: int = 0
    medium: int = 0
    hard: int = 0

    @property
    def total(self) -> int:
        return self.school + self.basic + self.easy + self.medium + self.hard


@dataclass
class GfgStats:
    username: str
    coding_score: int = 0
    institute_rank: str | None = None
    current_streak: int = 0
    max_streak: int = 0
    solved: GfgSolvedBreakdown = field(default_factory=GfgSolvedBreakdown)

    @property
    def score(self) -> int:
        """Prefer GFG's own coding score (their weighted difficulty
        score); fall back to a simple solved-count if that field is
        ever missing from the upstream response."""
        return self.coding_score or self.solved.total


def _first(d: dict, *keys, default=None):
    for k in keys:
        if k in d and d[k] not in (None, ""):
            return d[k]
    return default


def _to_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def fetch_gfg_stats(username: str) -> GfgStats | None:
    """Returns None on any failure (bad username, upstream down,
    unexpected shape) — caller falls back to whatever's cached."""
    if not username:
        return None

    cached = _cache.get(username)
    if cached and time.monotonic() - cached[0] < GFG_STATS_CACHE_MINUTES * 60:
        return cached[1]

    data = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = httpx.get(GFG_STATS_URL.format(username=username), timeout=TIMEOUT_SECONDS)
            if resp.status_code == 404:
                return None
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError):
            if attempt == MAX_RETRIES:
                return None
            time.sleep(1.0)

    if not data or not isinstance(data, dict):
        return None

    # The community mirror has nested its payload under "info" at
    # various points; support both shapes defensively.
    info = data.get("info") if isinstance(data.get("info"), dict) else data

    solved_stats = data.get("solvedStats") if isinstance(data.get("solvedStats"), dict) else {}

    def bucket_count(*names) -> int:
        for name in names:
            block = solved_stats.get(name)
            if isinstance(block, dict):
                return _to_int(block.get("count", len(block.get("questions", []) or [])))
        return 0

    solved = GfgSolvedBreakdown(
        school=bucket_count("school", "School"),
        basic=bucket_count("basic", "Basic"),
        easy=bucket_count("easy", "Easy"),
        medium=bucket_count("medium", "Medium"),
        hard=bucket_count("hard", "Hard"),
    )

    # If the API didn't return a per-difficulty breakdown at all, fall
    # back to whatever flat "totalProblemsSolved" figure it gives —
    # dumped into `easy` just so the total isn't lost, clearly
    # unreliable for a real difficulty split.
    if solved.total == 0:
        flat_total = _to_int(_first(info, "totalProblemsSolved", "total_problems_solved"))
        if flat_total:
            solved.easy = flat_total

    stats = GfgStats(
        username=_first(info, "userName", "username", default=username),
        coding_score=_to_int(_first(info, "codingScore", "score", "coding_score")),
        institute_rank=_first(info, "instituteRank", "institute_rank"),
        current_streak=_to_int(_first(info, "currentStreak", "current_streak")),
        max_streak=_to_int(_first(info, "maxStreak", "max_streak")),
        solved=solved,
    )

    _cache[username] = (time.monotonic(), stats)
    return stats


def get_cached_or_refresh(db, profile) -> GfgStats:
    """Same contract as leetcode_stats.get_cached_or_refresh: returns
    cached DB columns if fresh, otherwise tries a live fetch and
    persists it; on fetch failure, falls back to whatever's cached
    (even if stale) rather than showing a zero."""
    now = datetime.now(timezone.utc)

    updated_at = profile.gfg_stats_updated_at
    if updated_at and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)

    is_stale = (
        updated_at is None or now - updated_at > timedelta(minutes=GFG_STATS_CACHE_MINUTES)
    )

    if is_stale and profile.gfg_username:
        fresh = fetch_gfg_stats(profile.gfg_username)
        if fresh is not None:
            profile.gfg_problems_solved = fresh.solved.total
            profile.gfg_coding_score = fresh.coding_score
            profile.gfg_school_solved = fresh.solved.school
            profile.gfg_basic_solved = fresh.solved.basic
            profile.gfg_easy_solved = fresh.solved.easy
            profile.gfg_medium_solved = fresh.solved.medium
            profile.gfg_hard_solved = fresh.solved.hard
            profile.gfg_stats_updated_at = now.replace(tzinfo=None)
            db.commit()
            return fresh

    return GfgStats(
        username=profile.gfg_username or "",
        coding_score=profile.gfg_coding_score,
        solved=GfgSolvedBreakdown(
            school=profile.gfg_school_solved,
            basic=profile.gfg_basic_solved,
            easy=profile.gfg_easy_solved,
            medium=profile.gfg_medium_solved,
            hard=profile.gfg_hard_solved,
        ),
    )
