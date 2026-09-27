"""
AI-assist for grading a CustomQuestion submission — see the module
docstring on models/custom_question.py for the overall design: this
is always a *suggestion* for the teacher, generated against the
teacher's own reference_solution, never an authoritative grade.
"""

from sqlalchemy.orm import Session

from app.models.custom_question import CustomQuestion, CustomSubmission
from app.services.ai_assistant import CUSTOM_GRADING_PROMPT, complete
from app.services.json_extract import extract_json


def ai_assist_grade(db: Session, question: CustomQuestion, submission: CustomSubmission) -> dict:
    """Returns {"suggested_score", "suggested_feedback", "matches_reference_approach"}.
    Raises ValueError if the question has no reference_solution set yet
    (caller — the router — turns that into a 400, not a 503, since it's
    a teacher setup issue, not an AI-availability issue) and
    AssistantError (from ai_assistant.complete) if the AI call itself fails."""
    if not question.reference_solution.strip():
        raise ValueError(
            "Add your own correct reference implementation to this question before using AI assist."
        )

    user_content = (
        f"Problem statement: {question.title}\n{question.description}\n\n"
        f"Constraints/examples: {question.constraints or 'none given'}\n\n"
        f"Teacher's reference implementation ({question.reference_language}):\n"
        f"{question.reference_solution}\n\n"
        f"Student's submitted code ({submission.language}):\n{submission.code}"
    )

    raw = complete(db, CUSTOM_GRADING_PROMPT, user_content, json_mode=True)
    parsed = extract_json(raw)

    suggested_score = int(parsed.get("suggested_score", 0))
    suggested_score = max(0, min(100, suggested_score))

    return {
        "suggested_score": suggested_score,
        "suggested_feedback": parsed.get("suggested_feedback", ""),
        "matches_reference_approach": bool(parsed.get("matches_reference_approach", False)),
    }
