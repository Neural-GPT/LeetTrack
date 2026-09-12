"""
Fetches the richer LeetCode profile data behind the Achievements page's
"Progress" tab — the circular solved-vs-total ring, the submission
heatmap, and the profile card (avatar, rank, links). Separate from
services/leetcode_stats.py, which only fetches solved counts for the
score badge/leaderboard and is called far more often (every leaderboard
row) — this hits three extra fields (allQuestionsCount, profile,
submissionCalendar) that aren't needed anywhere else, so keeping them
in a dedicated query avoids paying for them on every leaderboard fetch.

Same caveats as the rest of the LeetCode integration: unauthenticated,
unofficial, rate-limited, no SLA. Returns None on any failure.

LeetCode's public API doesn't expose follower/following counts (that's
gated behind their own session-authenticated social graph) — the
profile card below reflects that honestly rather than guessing at a
field name that isn't part of the public schema.
"""

import json
import time
from dataclasses import dataclass, field

import httpx

from app.core.config import settings

PROFILE_QUERY = """
query userProfile($username: String!) {
  matchedUser(username: $username) {
    username
    githubUrl
    twitterUrl
    linkedinUrl
    profile {
      ranking
      userAvatar
      realName
      websites
      countryName
    }
    submissionCalendar
    submitStatsGlobal {
      acSubmissionNum { difficulty count }
      totalSubmissionNum { difficulty count }
    }
  }
  allQuestionsCount {
    difficulty
    count
  }
}
"""

TIMEOUT_SECONDS = 8.0
MAX_RETRIES = 1
CACHE_TTL_SECONDS = 600  # 10 minutes — heavier query than leetcode_stats, cached longer


@dataclass
class DifficultyBreakdown:
    easy: int = 0
    medium: int = 0
    hard: int = 0

    @property
    def total(self) -> int:
        return self.easy + self.medium + self.hard


@dataclass
class LeetCodeProfile:
    username: str
    real_name: str
    avatar_url: str
    ranking: int | None
    country: str | None
    github_url: str
    website: str | None
    solved: DifficultyBreakdown
    total_questions: DifficultyBreakdown
    attempting: int  # approximate — see note below
    # {"YYYY-MM-DD": submission_count}, most recent ~371 days
    submission_calendar: dict[str, int] = field(default_factory=dict)
    total_active_days: int = 0
    max_streak: int = 0
    total_submissions_past_year: int = 0


_cache: dict[str, tuple[float, LeetCodeProfile]] = {}


def _parse_calendar(raw: str | None) -> dict[str, int]:
    if not raw:
        return {}
    try:
        by_day_ts = json.loads(raw)
    except ValueError:
        return {}
    result: dict[str, int] = {}
    for ts_str, count in by_day_ts.items():
        try:
            day = time.strftime("%Y-%m-%d", time.gmtime(int(ts_str)))
            result[day] = int(count)
        except (ValueError, OSError):
            continue
    return result


def _max_streak(days_sorted: list[str]) -> int:
    """Longest run of consecutive calendar days with >=1 submission."""
    if not days_sorted:
        return 0
    from datetime import date

    parsed = sorted(date.fromisoformat(d) for d in days_sorted)
    longest = current = 1
    for prev, nxt in zip(parsed, parsed[1:]):
        if (nxt - prev).days == 1:
            current += 1
            longest = max(longest, current)
        elif (nxt - prev).days > 1:
            current = 1
    return longest


def fetch_leetcode_profile(username: str) -> LeetCodeProfile | None:
    if not username:
        return None

    cached = _cache.get(username)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    data = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = httpx.post(
                settings.LEETCODE_GRAPHQL_URL,
                json={"query": PROFILE_QUERY, "variables": {"username": username}},
                headers={"Content-Type": "application/json"},
                timeout=TIMEOUT_SECONDS,
            )
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError):
            if attempt == MAX_RETRIES:
                return None
            time.sleep(1.0)

    if data is None:
        return None

    matched_user = data.get("data", {}).get("matchedUser")
    if not matched_user:
        return None

    solved = DifficultyBreakdown()
    total_submissions = DifficultyBreakdown()
    for row in matched_user["submitStatsGlobal"]["acSubmissionNum"]:
        if row["difficulty"] == "Easy":
            solved.easy = row["count"]
        elif row["difficulty"] == "Medium":
            solved.medium = row["count"]
        elif row["difficulty"] == "Hard":
            solved.hard = row["count"]
    for row in matched_user["submitStatsGlobal"].get("totalSubmissionNum", []):
        if row["difficulty"] == "Easy":
            total_submissions.easy = row["count"]
        elif row["difficulty"] == "Medium":
            total_submissions.medium = row["count"]
        elif row["difficulty"] == "Hard":
            total_submissions.hard = row["count"]

    total_questions = DifficultyBreakdown()
    for row in data.get("data", {}).get("allQuestionsCount") or []:
        if row["difficulty"] == "Easy":
            total_questions.easy = row["count"]
        elif row["difficulty"] == "Medium":
            total_questions.medium = row["count"]
        elif row["difficulty"] == "Hard":
            total_questions.hard = row["count"]

    calendar = _parse_calendar(matched_user.get("submissionCalendar"))
    days_active = [d for d, c in calendar.items() if c > 0]

    profile_block = matched_user.get("profile") or {}
    websites = profile_block.get("websites") or []

    # "Attempting" here approximates LeetCode's own profile-page figure:
    # extra submissions beyond the ones that were accepted (not unique
    # in-progress *problems*, since the public API doesn't expose that
    # breakdown) — same spirit as the "N Attempting" stat on a LeetCode
    # profile, close but not pixel-identical.
    attempting = max(0, total_submissions.total - solved.total)

    profile = LeetCodeProfile(
        username=matched_user.get("username") or username,
        real_name=profile_block.get("realName") or matched_user.get("username") or username,
        avatar_url=profile_block.get("userAvatar") or "",
        ranking=profile_block.get("ranking"),
        country=profile_block.get("countryName"),
        github_url=matched_user.get("githubUrl") or "",
        website=websites[0] if websites else None,
        solved=solved,
        total_questions=total_questions,
        attempting=attempting,
        submission_calendar=calendar,
        total_active_days=len(days_active),
        max_streak=_max_streak(days_active),
        total_submissions_past_year=sum(calendar.values()),
    )

    _cache[username] = (time.monotonic(), profile)
    return profile
