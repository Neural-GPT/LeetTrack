"""
The two AI-backed pieces of the Contest Simulator: generating (and
caching) a reference solution for a problem, and judging a student's
submitted code against it. See the module docstring on models/contest.py
for why this is AI-judged rather than executed against real test cases.
"""

import json
from datetime import datetime, timezone

from sqlalchemy.orm import Session

from app.models.assignment import Problem
from app.services.ai_assistant import (
    CONTEST_JUDGE_PROMPT,
    REFERENCE_SOLUTION_PROMPT,
    complete,
)
from app.services.json_extract import extract_json as _extract_json

REFERENCE_SOLUTION_STALE_DAYS = 90  # essentially "forever" — problems don't change


def get_or_generate_reference_solution(db: Session, problem: Problem) -> dict:
    """Returns {"code", "time_complexity", "space_complexity", "approach"}.
    Cached on the Problem row after first generation. Raises
    AssistantError if generation is needed but no AI key is configured
    or all keys fail — caller decides how to degrade (the contest
    grading endpoint falls back to a correctness-only judge prompt
    without a reference when this happens, see contest_simulator.py)."""
    if problem.reference_solution:
        try:
            return json.loads(problem.reference_solution)
        except ValueError:
            pass  # cache row is somehow corrupt — fall through and regenerate

    user_content = (
        f"Title: {problem.title}\n"
        f"Difficulty: {problem.difficulty.value}\n"
        f"Tags: {problem.tags or 'none listed'}\n"
        f"LeetCode URL: {problem.leetcode_url}"
    )
    raw = complete(db, REFERENCE_SOLUTION_PROMPT, user_content, json_mode=True)
    parsed = _extract_json(raw)

    problem.reference_solution = json.dumps(parsed)
    problem.reference_solution_updated_at = datetime.now(timezone.utc).replace(tzinfo=None)
    db.commit()
    return parsed


def judge_submission(
    db: Session,
    problem: Problem,
    reference: dict | None,
    student_code: str,
    language: str,
) -> dict:
    """Returns {"score", "verdict", "complexity_estimate", "feedback"}."""
    reference_block = (
        f"Reference solution ({reference.get('approach', '')}, "
        f"time {reference.get('time_complexity', '?')}, space {reference.get('space_complexity', '?')}):\n"
        f"{reference.get('code', '')}"
        if reference
        else "No reference solution is available for this attempt — judge on correctness and "
        "complexity reasoning alone, don't compare to a missing reference."
    )

    user_content = (
        f"Problem: {problem.title} ({problem.difficulty.value})\n"
        f"Tags: {problem.tags or 'none listed'}\n\n"
        f"{reference_block}\n\n"
        f"Student's submitted code (language: {language}):\n{student_code}"
    )

    raw = complete(db, CONTEST_JUDGE_PROMPT, user_content, json_mode=True)
    parsed = _extract_json(raw)

    score = int(parsed.get("score", 0))
    score = max(0, min(100, score))
    verdict = parsed.get("verdict") or ("pass" if score >= 90 else "needs_work" if score >= 60 else "fail")
    if verdict not in ("pass", "needs_work", "fail"):
        verdict = "pass" if score >= 90 else "needs_work" if score >= 60 else "fail"

    return {
        "score": score,
        "verdict": verdict,
        "complexity_estimate": parsed.get("complexity_estimate", ""),
        "feedback": parsed.get("feedback", ""),
    }
