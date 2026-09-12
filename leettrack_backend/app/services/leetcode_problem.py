"""
Fetches a problem's title/difficulty/topic-tags from LeetCode's public
(unofficial) GraphQL `question` query, given its slug. Used to auto-fill
the difficulty (and title/tags, if the teacher left them blank) on the
teacher's assignment-creation form from just the LeetCode URL, instead
of the teacher having to look it up and set it by hand.

Same caveats as the rest of the LeetCode integration (see
verification/leetcode_graphql.py, leetcode_stats.py): unauthenticated,
unofficial, rate-limited, no SLA. Returns None on any failure — the
caller falls back to letting the teacher fill difficulty in manually
rather than blocking assignment creation on this.
"""

from dataclasses import dataclass

import httpx

from app.core.config import settings

QUESTION_QUERY = """
query questionData($titleSlug: String!) {
  question(titleSlug: $titleSlug) {
    title
    difficulty
    topicTags {
      name
    }
  }
}
"""

TIMEOUT_SECONDS = 8.0


@dataclass
class ProblemMetadata:
    title: str
    difficulty: str  # "Easy" | "Medium" | "Hard" — matches Difficulty enum values
    tags: list[str]


def fetch_problem_metadata(slug: str) -> ProblemMetadata | None:
    if not slug:
        return None
    try:
        resp = httpx.post(
            settings.LEETCODE_GRAPHQL_URL,
            json={"query": QUESTION_QUERY, "variables": {"titleSlug": slug}},
            headers={"Content-Type": "application/json"},
            timeout=TIMEOUT_SECONDS,
        )
        resp.raise_for_status()
        question = resp.json().get("data", {}).get("question")
        if not question or not question.get("difficulty"):
            return None
        return ProblemMetadata(
            title=question.get("title") or "",
            difficulty=question["difficulty"],
            tags=[t["name"] for t in question.get("topicTags") or []],
        )
    except (httpx.HTTPError, ValueError, KeyError):
        return None
