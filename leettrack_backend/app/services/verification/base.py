"""
Submission verification is deliberately behind an abstract interface —
the spec calls this out explicitly: "designed to remain independent so
different verification strategies can be adopted in future versions."

Today: poll LeetCode's public (unofficial) GraphQL endpoint for a
student's recent accepted submissions and match against assigned
problems by slug.

Tomorrow, if LeetCode locks down that endpoint or you want to trust a
browser extension / webhook / OAuth submission feed instead, implement
another SubmissionVerifier subclass and swap it in get_verifier() —
nothing in routers/services calling verify_submission() has to change.
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime


@dataclass
class VerificationResult:
    solved: bool
    accepted_at: datetime | None = None
    total_attempts: int = 0
    # Raw attempts seen in the lookback window, accepted or not — used to
    # populate Submission.total_attempts even when not yet solved.


class SubmissionVerifier(ABC):
    @abstractmethod
    def check(self, leetcode_username: str, problem_slug: str) -> VerificationResult:
        """Check whether `leetcode_username` has an accepted submission
        for `problem_slug`. Implementations should be side-effect free —
        callers persist the result."""
        raise NotImplementedError
