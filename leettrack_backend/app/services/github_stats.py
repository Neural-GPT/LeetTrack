"""
Fetches public GitHub profile + repository statistics for the
Achievements page's GitHub section — profile card (avatar, bio,
followers/following, public repo count) plus the stats needed for the
frontend's commits-by-repo and language-distribution graphs.

Same spirit as services/leetcode_profile.py: unauthenticated, hits
GitHub's public REST API (api.github.com), so it's subject to GitHub's
unauthenticated rate limit (60 requests/hour per IP). Results are
cached in-process with a TTL so normal page traffic doesn't burn
through that budget. Returns None on any failure (private/nonexistent
username, rate limit, network error) so the caller can fall back to
"couldn't load" rather than a 500.
"""

import re
import time
from dataclasses import dataclass, field

import httpx

TIMEOUT_SECONDS = 8.0
CACHE_TTL_SECONDS = 600  # 10 minutes
REPOS_PER_PAGE = 100  # one page covers the vast majority of student accounts

# Ranking repos by commit count needs one extra API call per repo (see
# _commit_count below), so it's capped to the N most recently updated
# repos rather than every repo the student has — keeps this within
# GitHub's unauthenticated rate limit (60 req/hour/IP) even for
# accounts with a lot of repos. `repos` is already sorted by
# `updated` from the API call below.
MAX_REPOS_TO_RANK = 12
TOP_REPOS_SHOWN = 6


@dataclass
class RepoStat:
    name: str
    commits: int
    stars: int
    forks: int
    language: str | None


@dataclass
class GithubStats:
    username: str
    name: str | None
    avatar_url: str
    bio: str | None
    public_repos: int
    followers: int
    following: int
    profile_url: str
    total_stars: int
    total_forks: int
    top_repos: list[RepoStat] = field(default_factory=list)
    # {"Python": 12, "TypeScript": 5, ...} — count of repos per primary language
    language_breakdown: dict[str, int] = field(default_factory=dict)


_cache: dict[str, tuple[float, GithubStats | None]] = {}

_LAST_PAGE_RE = re.compile(r'[?&]page=(\d+)>;\s*rel="last"')


def _commit_count(owner: str, repo: str, headers: dict[str, str]) -> int:
    """
    Total commit count on a repo's default branch, without paginating
    through every commit. GitHub's commits endpoint paginates like any
    other list endpoint, so requesting 1 commit per page and reading
    the last page number out of the response's `Link` header gives the
    total count in a single request. If there's no `Link` header, the
    whole (small) result fit on one page, so the count is just how
    many commits came back (0 or 1 here since per_page=1).
    """
    try:
        resp = httpx.get(
            f"https://api.github.com/repos/{owner}/{repo}/commits",
            headers=headers,
            params={"per_page": 1},
            timeout=TIMEOUT_SECONDS,
        )
    except httpx.HTTPError:
        return 0
    if resp.status_code != 200:
        return 0

    link = resp.headers.get("Link", "")
    match = _LAST_PAGE_RE.search(link)
    if match:
        return int(match.group(1))
    commits = resp.json()
    return len(commits) if isinstance(commits, list) else 0


def fetch_github_stats(username: str) -> GithubStats | None:
    if not username:
        return None

    cached = _cache.get(username)
    if cached and time.monotonic() - cached[0] < CACHE_TTL_SECONDS:
        return cached[1]

    headers = {"Accept": "application/vnd.github+json"}

    try:
        profile_resp = httpx.get(
            f"https://api.github.com/users/{username}",
            headers=headers,
            timeout=TIMEOUT_SECONDS,
        )
        if profile_resp.status_code != 200:
            _cache[username] = (time.monotonic(), None)
            return None
        profile = profile_resp.json()

        repos_resp = httpx.get(
            f"https://api.github.com/users/{username}/repos",
            headers=headers,
            params={"per_page": REPOS_PER_PAGE, "sort": "updated"},
            timeout=TIMEOUT_SECONDS,
        )
        repos = repos_resp.json() if repos_resp.status_code == 200 else []
        if not isinstance(repos, list):
            repos = []
    except httpx.HTTPError:
        _cache[username] = (time.monotonic(), None)
        return None

    # Exclude forks from stats, same as GitHub's own profile stats.
    non_fork_repos = [r for r in repos if not r.get("fork")]

    all_repo_stats = [
        RepoStat(
            name=r.get("name", ""),
            commits=0,
            stars=r.get("stargazers_count", 0) or 0,
            forks=r.get("forks_count", 0) or 0,
            language=r.get("language"),
        )
        for r in non_fork_repos
    ]

    language_breakdown: dict[str, int] = {}
    for r in all_repo_stats:
        if r.language:
            language_breakdown[r.language] = language_breakdown.get(r.language, 0) + 1

    # Only the most recently updated repos get a commit-count lookup
    # (see MAX_REPOS_TO_RANK above) — then ranked by whichever of those
    # actually has the most commits.
    owner_login = profile.get("login") or username
    ranked = []
    for r in non_fork_repos[:MAX_REPOS_TO_RANK]:
        repo_name = r.get("name", "")
        commits = _commit_count(owner_login, repo_name, headers)
        ranked.append(
            RepoStat(
                name=repo_name,
                commits=commits,
                stars=r.get("stargazers_count", 0) or 0,
                forks=r.get("forks_count", 0) or 0,
                language=r.get("language"),
            )
        )

    top_repos = sorted(ranked, key=lambda r: r.commits, reverse=True)[:TOP_REPOS_SHOWN]

    stats = GithubStats(
        username=owner_login,
        name=profile.get("name"),
        avatar_url=profile.get("avatar_url") or "",
        bio=profile.get("bio"),
        public_repos=profile.get("public_repos", 0) or 0,
        followers=profile.get("followers", 0) or 0,
        following=profile.get("following", 0) or 0,
        profile_url=profile.get("html_url") or f"https://github.com/{username}",
        total_stars=sum(r.stars for r in all_repo_stats),
        total_forks=sum(r.forks for r in all_repo_stats),
        top_repos=top_repos,
        language_breakdown=language_breakdown,
    )

    _cache[username] = (time.monotonic(), stats)
    return stats
