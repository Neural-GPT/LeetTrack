from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.api.deps import require_role
from app.db.session import get_db
from app.models.assignment import Assignment
from app.models.enums import Role
from app.models.submission import Submission
from app.models.system import AIInteractionLog
from app.models.user import User
from app.services.ai_assistant import AssistantError, chat, chat_stream, has_active_key

router = APIRouter(prefix="/api/assistant", tags=["assistant"])


class ChatMessage(BaseModel):
    role: str  # "user" | "assistant"
    content: str


class ChatRequest(BaseModel):
    messages: list[ChatMessage]
    assignment_id: int | None = None


class ChatResponse(BaseModel):
    reply: str


class EligibleAssignment(BaseModel):
    assignment_id: int
    problem_title: str
    difficulty: str

    model_config = {"from_attributes": True}


@router.get("/eligible-assignments", response_model=list[EligibleAssignment])
def eligible_assignments(
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    """Assignments this student has, where the teacher enabled AI help."""
    rows = db.scalars(
        select(Submission)
        .join(Assignment, Submission.assignment_id == Assignment.id)
        .where(
            Submission.student_id == student.id,
            Assignment.allow_ai_help.is_(True),
        )
    ).all()
    return [
        EligibleAssignment(
            assignment_id=s.assignment.id,
            problem_title=s.assignment.problem.title,
            difficulty=s.assignment.problem.difficulty.value,
        )
        for s in rows
    ]


def _build_problem_context(db: Session, student: User, assignment_id: int) -> str:
    submission = db.scalar(
        select(Submission).where(
            Submission.assignment_id == assignment_id,
            Submission.student_id == student.id,
        )
    )
    if not submission:
        raise HTTPException(404, "That assignment isn't yours.")

    assignment = submission.assignment
    if not assignment.allow_ai_help:
        raise HTTPException(
            403, "Your teacher hasn't enabled AI help for this assignment."
        )

    problem = assignment.problem
    lines = [
        f"Title: {problem.title}",
        f"Difficulty: {problem.difficulty.value}",
        f"Tags: {problem.tags or 'none listed'}",
        f"LeetCode URL: {problem.leetcode_url}",
    ]
    if assignment.notes:
        lines.append(f"Teacher's notes: {assignment.notes}")
    if assignment.hint:
        lines.append(f"Teacher's hint: {assignment.hint}")
    return "\n".join(lines)


@router.post("/chat", response_model=ChatResponse)
def assistant_chat(
    payload: ChatRequest,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    if not payload.messages:
        raise HTTPException(400, "Send at least one message.")

    problem_context = None
    if payload.assignment_id is not None:
        problem_context = _build_problem_context(db, student, payload.assignment_id)

    try:
        reply = chat(
            db,
            [m.model_dump() for m in payload.messages],
            problem_context=problem_context,
        )
    except AssistantError as e:
        raise HTTPException(503, str(e)) from e

    # Metadata only, no content — see AIInteractionLog docstring.
    db.add(AIInteractionLog(student_id=student.id, message_count=len(payload.messages)))
    db.commit()

    return ChatResponse(reply=reply)


@router.post("/chat/stream")
def assistant_chat_stream(
    payload: ChatRequest,
    student: User = Depends(require_role(Role.student)),
    db: Session = Depends(get_db),
):
    """
    Same request shape as /chat, but streams the reply as plain text
    chunks as they arrive from NVIDIA, instead of waiting for the full
    reply — powers the token-by-token rendering on the AI Chat page.
    """
    if not payload.messages:
        raise HTTPException(400, "Send at least one message.")

    problem_context = None
    if payload.assignment_id is not None:
        problem_context = _build_problem_context(db, student, payload.assignment_id)

    # Checked eagerly, before the streaming response starts, so a
    # missing key still comes back as a normal 503 instead of an empty
    # or broken stream (once StreamingResponse starts, the HTTP status
    # is already committed and can't change).
    if not has_active_key(db):
        raise HTTPException(
            503, "No NVIDIA API key is configured — add one from the Super Admin settings page."
        )

    # Metadata only, no content — see AIInteractionLog docstring.
    db.add(AIInteractionLog(student_id=student.id, message_count=len(payload.messages)))
    db.commit()

    def generate():
        try:
            yield from chat_stream(
                db, [m.model_dump() for m in payload.messages], problem_context=problem_context
            )
        except AssistantError:
            # Response has already started streaming by this point (or
            # this is the very first chunk with nothing sent yet) —
            # either way, the client sees an empty/short stream and its
            # own error handling (no content received) takes over.
            return

    return StreamingResponse(generate(), media_type="text/plain")
