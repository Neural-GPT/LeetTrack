"""
Pulls a student's total solved-problem counts (by difficulty) from
LeetCode's public GraphQL endpoint — separate from
verification/leetcode_graphql.py, which only checks one specific problem.
This is used for the profile-wide LeetCode Score badge and leaderboard
column, not per-assignment verification.

Same caveats as the verifier: unauthenticated, unofficial, rate-limited.
Results are cached on StudentProfile with a TTL (see
LEETCODE_STATS_CACHE_MINUTES) rather than fetched on every request.
"""

import time
from dataclasses import dataclass

import httpx
from app.core.config import settings

# Default kept for reference; actual URL always comes from settings
# (see app/core/config.py: LEETCODE_GRAPHQL_URL).

STATS_QUERY = """
query userProblemsSolved($username: String!) {
  matchedUser(username: $username) {
    submitStatsGlobal {
      acSubmissionNum {
        difficulty
        count
      }
    }
  }
}
"""

MAX_RETRIES = 2
BACKOFF_SECONDS = 1.5

LEETCODE_STATS_CACHE_MINUTES = 15


@dataclass
class SolvedCounts:
    easy: int = 0
    medium: int = 0
    hard: int = 0

    @property
    def total(self) -> int:
        return self.easy + self.medium + self.hard

    @property
    def score(self) -> int:
        """score = 1*easy + 2*medium + 3*hard"""
        return 1 * self.easy + 2 * self.medium + 3 * self.hard


def fetch_solved_counts(leetcode_username: str) -> SolvedCounts | None:
    """Returns None on any failure (bad username, LeetCode unreachable,
    rate limited) — caller falls back to whatever's cached."""
    if not leetcode_username:
        return None

    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = httpx.post(
                settings.LEETCODE_GRAPHQL_URL,
                json={
                    "query": STATS_QUERY,
                    "variables": {"username": leetcode_username},
                },
                headers={"Content-Type": "application/json"},
                timeout=8.0,
            )
            resp.raise_for_status()
            data = resp.json()
            break
        except (httpx.HTTPError, ValueError):
            if attempt == MAX_RETRIES:
                return None
            time.sleep(BACKOFF_SECONDS * (attempt + 1))

    matched_user = data.get("data", {}).get("matchedUser")
    if not matched_user:
        return None  # username doesn't exist on LeetCode, or profile is private

    counts = SolvedCounts()
    for row in matched_user["submitStatsGlobal"]["acSubmissionNum"]:
        if row["difficulty"] == "Easy":
            counts.easy = row["count"]
        elif row["difficulty"] == "Medium":
            counts.medium = row["count"]
        elif row["difficulty"] == "Hard":
            counts.hard = row["count"]
        # LeetCode also returns a "All" row — deliberately ignored, we
        # sum the three real difficulties ourselves via .total

    return counts


def get_cached_or_refresh(db, profile) -> SolvedCounts:
    """
    Returns cached counts if still fresh; otherwise tries a live fetch
    and updates the cache on success. On fetch failure, falls back to
    whatever's cached (even if stale) rather than showing a zero score —
    a transient LeetCode outage shouldn't wipe someone's leaderboard
    position.
    """
    from datetime import datetime, timedelta, timezone

    now = datetime.now(timezone.utc)

    # SQLite round-trips naive datetimes — normalize before comparing.
    updated_at = profile.leetcode_stats_updated_at
    if updated_at and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)

    is_stale = (
        updated_at is None
        or now - updated_at > timedelta(minutes=LEETCODE_STATS_CACHE_MINUTES)
    )

    if is_stale and profile.leetcode_username:
        fresh = fetch_solved_counts(profile.leetcode_username)
        if fresh is not None:
            profile.leetcode_easy_solved = fresh.easy
            profile.leetcode_medium_solved = fresh.medium
            profile.leetcode_hard_solved = fresh.hard
            profile.leetcode_stats_updated_at = now.replace(tzinfo=None)
            db.commit()
            return fresh

    return SolvedCounts(
        easy=profile.leetcode_easy_solved,
        medium=profile.leetcode_medium_solved,
        hard=profile.leetcode_hard_solved,
    )
