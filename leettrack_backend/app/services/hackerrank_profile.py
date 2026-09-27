"""
Pulls a student's HackerRank badge stats from HackerRank's public
(unauthenticated, unofficial) REST endpoint used to render the badges
grid on a profile page: /rest/hackers/<username>/badges. Each badge
carries a 0-5 star rating per track (Problem Solving, SQL, Python,
etc.) — we sum stars across badges as the "score", same spirit as
LeetCode's 1/2/3-weighted solved score.

Same caveats as the rest of the platform integrations in this codebase:
unofficial, no SLA, can change or start requiring auth without notice.
Returns None on any failure so callers fall back to whatever's cached.
"""

import time
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone

import httpx

BADGES_URL = "https://www.hackerrank.com/rest/hackers/{username}/badges"

TIMEOUT_SECONDS = 8.0
MAX_RETRIES = 1
HACKERRANK_STATS_CACHE_MINUTES = 30

_cache: dict[str, tuple[float, "HackerRankStats"]] = {}


@dataclass
class HackerRankBadge:
    name: str
    stars: int
    solved: int = 0


@dataclass
class HackerRankStats:
    username: str
    badges: list[HackerRankBadge] = field(default_factory=list)
    # Precomputed at fetch time (or restored straight from the cached
    # DB columns when reconstructing from cache, where the individual
    # badge list isn't stored) rather than derived live from `badges`,
    # since the cache-fallback path doesn't have the real badge list.
    total_stars: int = 0
    badges_count: int = 0

    def __post_init__(self):
        if self.badges and not self.total_stars and not self.badges_count:
            self.total_stars = sum(b.stars for b in self.badges)
            self.badges_count = len(self.badges)

    @property
    def score(self) -> int:
        """Stars weighted more heavily than raw badge count — a 5-star
        badge represents real depth in a track, so it should count for
        more than five separate 1-star badges."""
        return self.total_stars * 10 + self.badges_count


def _to_int(value) -> int:
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def fetch_hackerrank_stats(username: str) -> HackerRankStats | None:
    """Returns None on any failure (bad username, private profile,
    upstream down/shape change) — caller falls back to whatever's cached."""
    if not username:
        return None

    cached = _cache.get(username)
    if cached and time.monotonic() - cached[0] < HACKERRANK_STATS_CACHE_MINUTES * 60:
        return cached[1]

    data = None
    for attempt in range(MAX_RETRIES + 1):
        try:
            resp = httpx.get(
                BADGES_URL.format(username=username),
                timeout=TIMEOUT_SECONDS,
                headers={"Accept": "application/json"},
            )
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

    models = data.get("models")
    if models is None:
        # Username doesn't exist / has no public badges at all — treat
        # as "connected but nothing to show yet" rather than a failure,
        # same as an empty-but-valid LeetCode profile would be.
        if "models" in data:
            return HackerRankStats(username=username, badges=[])
        return None

    badges = [
        HackerRankBadge(
            name=str(b.get("badge_name") or b.get("category_name") or "Badge"),
            stars=_to_int(b.get("stars")),
            solved=_to_int(b.get("solved")),
        )
        for b in models
        if isinstance(b, dict)
    ]

    stats = HackerRankStats(username=username, badges=badges)
    _cache[username] = (time.monotonic(), stats)
    return stats


def get_cached_or_refresh(db, profile) -> HackerRankStats:
    """Same contract as leetcode_stats.get_cached_or_refresh."""
    now = datetime.now(timezone.utc)

    updated_at = profile.hackerrank_stats_updated_at
    if updated_at and updated_at.tzinfo is None:
        updated_at = updated_at.replace(tzinfo=timezone.utc)

    is_stale = (
        updated_at is None
        or now - updated_at > timedelta(minutes=HACKERRANK_STATS_CACHE_MINUTES)
    )

    if is_stale and profile.hackerrank_username:
        fresh = fetch_hackerrank_stats(profile.hackerrank_username)
        if fresh is not None:
            profile.hackerrank_total_stars = fresh.total_stars
            profile.hackerrank_badges_count = fresh.badges_count
            profile.hackerrank_stats_updated_at = now.replace(tzinfo=None)
            db.commit()
            return fresh

    return HackerRankStats(
        username=profile.hackerrank_username or "",
        total_stars=profile.hackerrank_total_stars,
        badges_count=profile.hackerrank_badges_count,
    )
