"""
Concrete verifier using LeetCode's public (unofficial) GraphQL endpoint.

This hits `recentAcSubmissionList` for a username and checks whether the
target problem's slug shows up. LeetCode doesn't publish an official
submissions API, and this endpoint is:
  - unauthenticated (only sees a user's public recent-AC feed, which is
    capped at ~20 entries and can be empty if the student's LeetCode
    privacy setting hides it)
  - rate-limited and not covered by an SLA — the request-count/backoff
    settings below are conservative on purpose.

If LeetCode changes or blocks this, swap in another SubmissionVerifier
(browser extension postback, official API if one ever ships, etc.) —
see base.py for why this is behind an interface at all.
"""

import time
from datetime import datetime, timezone

import httpx

from app.services.verification.base import SubmissionVerifier, VerificationResult
from app.core.config import settings

# Default kept for reference; actual URL always comes from settings
# (see app/core/config.py: LEETCODE_GRAPHQL_URL).

RECENT_AC_QUERY = """
query recentAcSubmissions($username: String!, $limit: Int!) {
  recentAcSubmissionList(username: $username, limit: $limit) {
    id
    title
    titleSlug
    timestamp
  }
}
"""

MAX_RETRIES = 2
BACKOFF_SECONDS = 1.5


class LeetCodeGraphQLVerifier(SubmissionVerifier):
    def __init__(self, client: httpx.Client | None = None, limit: int = 20):
        self.client = client or httpx.Client(timeout=8.0)
        self.limit = limit

    def check(self, leetcode_username: str, problem_slug: str) -> VerificationResult:
        for attempt in range(MAX_RETRIES + 1):
            try:
                resp = self.client.post(
                    settings.LEETCODE_GRAPHQL_URL,
                    json={
                        "query": RECENT_AC_QUERY,
                        "variables": {
                            "username": leetcode_username,
                            "limit": self.limit,
                        },
                    },
                    headers={"Content-Type": "application/json"},
                )
                resp.raise_for_status()
                data = resp.json()
                break
            except (httpx.HTTPError, ValueError):
                if attempt == MAX_RETRIES:
                    # Fail closed: treat as "not yet verified" rather than
                    # crash the caller — a poll loop will retry later.
                    return VerificationResult(solved=False)
                time.sleep(BACKOFF_SECONDS * (attempt + 1))

        submissions = (
            data.get("data", {}).get("recentAcSubmissionList") or []
        )
        for sub in submissions:
            if sub.get("titleSlug") == problem_slug:
                return VerificationResult(
                    solved=True,
                    accepted_at=None
                    if not sub.get("timestamp")
                    else datetime.fromtimestamp(int(sub["timestamp"]), tz=timezone.utc),
                    total_attempts=1,
                )

        return VerificationResult(solved=False)


def get_verifier() -> SubmissionVerifier:
    """Single seam to swap verification strategy app-wide."""
    return LeetCodeGraphQLVerifier()
