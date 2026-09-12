"""
AI assistant backed by NVIDIA's OpenAI-compatible NIM chat-completions
API (model: nvidia/nemotron-3-ultra-550b-a55b, per settings.NVIDIA_MODEL),
hosted at https://integrate.api.nvidia.com/v1/chat/completions.

Stateless by design — no chat history stored server-side, only aggregate
usage metadata for the Data Center export (see AIInteractionLog). The
client sends the full message list each turn; nothing is persisted or
replayed across sessions.

Two things shape the system prompt:
  1. General website knowledge, so the assistant can answer "how does
     LeetTrack work" type questions, not just DSA content. This is the
     bulk of BASE_SYSTEM_PROMPT below — it's intentionally detailed
     (roles, scoring, streaks, sections, notifications, weekend rules)
     so the assistant gives accurate answers instead of guessing at
     how a feature works.
  2. Optional problem context — only included when the student picked an
     assignment from their AI-eligible list (assignments the teacher
     explicitly flagged `allow_ai_help=True`). Without a problem selected,
     the assistant sticks to general DSA/website help and won't discuss
     assignment specifics it wasn't given.

Keys are managed by the Super Admin through the UI (NvidiaApiKey rows), not
a single .env value — see `_active_keys` below. Multiple keys let usage
keep flowing if one hits a rate limit; a key that fails outright (bad
credentials) gets auto-disabled after a few strikes rather than retried
forever.

Two entry points: `chat()` (returns the full reply at once — kept for
anything that doesn't need streaming) and `chat_stream()` (a generator
yielding text chunks as NVIDIA sends them — what the /chat/stream
endpoint uses so the frontend can render tokens as they arrive instead
of waiting for the whole reply).
"""

import json
from datetime import datetime, timezone
from typing import Iterator

import httpx
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.system import NvidiaApiKey


MAX_FAILURES_BEFORE_DISABLE = 5

BASE_SYSTEM_PROMPT = """You are the LeetTrack assistant, a coding tutor embedded in LeetTrack.

What LeetTrack is:
LeetTrack is a platform colleges and teachers use to assign LeetCode problems to students and track how they do. There are three account types. Students get assignments, either individually, by their class section, or platform-wide. They solve them on real LeetCode, connect their LeetCode account so LeetTrack can verify submissions automatically, and build a daily solving streak. Teachers create assignments by picking a problem, a point value, a deadline, and optionally a hint or notes and whether AI help is allowed for it, then assign them to a section or specific students, and see their students' progress. The Super Admin runs the platform itself: creates teacher and student accounts, manages the site's AI key pool, reviews feedback, and can send broadcast announcements.

How scoring works:
Every assignment has a base point value the teacher sets, called max marks in the UI, but that is a floor a student builds from, not a hard ceiling. The actual score per solve factors in speed (how quickly they solved it relative to release time and deadline), attempts (fewer submission attempts before an Accepted result scores higher), a position bonus (being one of the first students in their group to solve it), a streak bonus (an active daily-solving streak), and a late penalty (solving after the deadline multiplies the score down instead of zeroing it out). Because of the position, streak, and first-solver bonuses, a strong, fast, early solve can score above the base point value the teacher set. That is intentional, not a bug, and is explained in the UI next to the points value.

Streaks, leaderboard, sections:
A streak increases by one for each consecutive day the student solves at least one assigned problem, and resets to zero if a day is missed entirely. The leaderboard ranks students by total score and can be filtered by section. A section is just a class or cohort a student is assigned to, chosen at registration or set by a teacher or the Super Admin later. Assignments can target a whole section, specific students, or everyone.

LeetCode connection:
A student links their real LeetCode username in Settings so LeetTrack can verify their submissions; nothing gets scored without it. Connecting it for the very first time works any day. Once it is connected, changing it, or changing the student's display name, is only allowed on weekends, Saturday and Sunday, IST. That rule exists to stop last-minute username swapping around deadlines.

Notifications, feedback, broadcasts:
The bell icon shows notifications: new assignments, deadline reminders, a broken streak, weekly result digests, leaderboard rank changes, and, for teachers and the Super Admin, alerts when a student changes their display name. Students and teachers can send free-text feedback to the Super Admin from the Feedback pill in the nav. The Super Admin can also broadcast a message to everyone, all students, all teachers, or one specific person, and it lands in that notification bell too.

What you help with:
First, questions about how LeetTrack works: assignments, deadlines, scoring, streaks, the leaderboard, sections, the weekend rule, notifications, feedback. Second, DSA and algorithms help, but only discuss a specific assignment's problem if one has been explicitly provided to you below. If a student asks about a problem that was not provided, tell them it is not enabled for AI help and to ask their teacher, or to pick it from the problem selector if it is actually eligible.

Rules for problem help: guide, do not solve. Prefer hints, clarifying questions, and naming the relevant pattern, such as sliding window, two pointers, or dynamic programming, over handing over a complete working solution. If a student is clearly stuck after a couple of exchanges, walk through the approach in more detail, but still let them write the code themselves. Keep explanations concise and concrete, favoring small examples over abstract theory.

If asked about anything unrelated to LeetTrack or CS fundamentals, gently redirect back.

How to format every response:
Write in plain, clean prose, like you are explaining something to someone directly, not writing documentation. Do not use markdown formatting of any kind: no asterisks for bold or italics, no headers, no horizontal rules, no tables, no bullet or numbered lists built from symbols. If you need to list a few things, write them as a normal sentence or short paragraph instead ("There are three things to check here: the base case, the recurrence, and the return type."). Only exception: when showing actual code, put it in a fenced code block so it stays readable and monospaced. Everything else should read as ordinary written language with no decorative symbols."""


class AssistantError(Exception):
    pass


def build_system_prompt(problem_context: str | None) -> str:
    if not problem_context:
        return BASE_SYSTEM_PROMPT
    return (
        f"{BASE_SYSTEM_PROMPT}\n\n"
        f"The student is currently asking about this assignment "
        f"(the teacher has enabled AI help for it):\n{problem_context}"
    )


def _active_keys(db: Session) -> list[NvidiaApiKey]:
    return list(
        db.scalars(
            select(NvidiaApiKey)
            .where(NvidiaApiKey.is_active.is_(True))
            .order_by(NvidiaApiKey.last_used_at.asc().nulls_first())
        ).all()
    )


def has_active_key(db: Session) -> bool:
    return bool(_active_keys(db))


def _build_payload(messages: list[dict], problem_context: str | None, stream: bool) -> dict:
    return {
        "model": settings.NVIDIA_MODEL,
        "messages": [
            {"role": "system", "content": build_system_prompt(problem_context)},
            *messages,
        ],
        "stream": stream,
        "temperature": 0.4,
        # Nemotron models support a "reasoning" mode that emits its
        # chain-of-thought as visible text by default. Turned off here
        # so students get a normal, direct tutor reply instead of a
        # wall of exposed reasoning traces.
        "chat_template_kwargs": {"enable_thinking": False, "force_nonempty_content": True},
    }


def chat(
    db: Session,
    messages: list[dict],
    problem_context: str | None = None,
) -> str:
    """
    `messages` is the OpenAI-style list of {"role": ..., "content": ...}
    from the client — no server-side history lookup. Non-streaming;
    returns the full reply. Kept around for any caller that doesn't need
    token-by-token streaming — the AI Chat page itself uses
    `chat_stream()` instead.
    """
    keys = _active_keys(db)
    if not keys:
        raise AssistantError(
            "No NVIDIA API key is configured — add one from the Super Admin settings page."
        )

    payload = _build_payload(messages, problem_context, stream=False)
    last_error: Exception | None = None

    for key_row in keys:
        try:
            resp = httpx.post(
                settings.NVIDIA_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {key_row.key}"},
                timeout=30.0,
            )
            key_row.last_used_at = datetime.now(timezone.utc)

            if resp.status_code in (401, 403):
                key_row.is_active = False
                db.commit()
                last_error = AssistantError("A configured NVIDIA key was rejected.")
                continue

            if resp.status_code == 429:
                db.commit()
                last_error = AssistantError("NVIDIA rate limit hit on one key.")
                continue

            resp.raise_for_status()
            key_row.failure_count = 0
            db.commit()
            data = resp.json()
            return data["choices"][0]["message"]["content"]

        except httpx.HTTPError as e:
            key_row.failure_count += 1
            if key_row.failure_count >= MAX_FAILURES_BEFORE_DISABLE:
                key_row.is_active = False
            db.commit()
            last_error = e
            continue

    raise AssistantError(f"All configured NVIDIA keys failed. Last error: {last_error}")


def chat_stream(
    db: Session,
    messages: list[dict],
    problem_context: str | None = None,
) -> Iterator[str]:
    """
    Same key-rotation/fallback behavior as chat(), but yields text chunks
    as NVIDIA streams them (OpenAI-compatible SSE: lines of
    `data: {...}` ending in `data: [DONE]`) instead of returning the
    full reply at once.

    Caller (the /chat/stream route) is expected to have already checked
    has_active_key() before starting the HTTP response — once this
    generator starts yielding, the client's response has already begun
    streaming, so a mid-stream failure just ends the stream early rather
    than being able to change the HTTP status at that point.
    """
    keys = _active_keys(db)
    if not keys:
        raise AssistantError(
            "No NVIDIA API key is configured — add one from the Super Admin settings page."
        )

    payload = _build_payload(messages, problem_context, stream=True)
    last_error: Exception | None = None

    for key_row in keys:
        got_any_content = False
        try:
            with httpx.stream(
                "POST",
                settings.NVIDIA_API_URL,
                json=payload,
                headers={"Authorization": f"Bearer {key_row.key}"},
                timeout=60.0,
            ) as resp:
                key_row.last_used_at = datetime.now(timezone.utc)

                if resp.status_code in (401, 403):
                    key_row.is_active = False
                    db.commit()
                    last_error = AssistantError("A configured NVIDIA key was rejected.")
                    continue

                if resp.status_code == 429:
                    db.commit()
                    last_error = AssistantError("NVIDIA rate limit hit on one key.")
                    continue

                resp.raise_for_status()
                key_row.failure_count = 0
                db.commit()

                for line in resp.iter_lines():
                    if not line or not line.startswith("data:"):
                        continue
                    data_str = line[len("data:"):].strip()
                    if data_str == "[DONE]":
                        break
                    try:
                        chunk = json.loads(data_str)
                    except ValueError:
                        continue
                    delta = (chunk.get("choices") or [{}])[0].get("delta", {})
                    content = delta.get("content")
                    if content:
                        got_any_content = True
                        yield content

            if got_any_content:
                return

        except httpx.HTTPError as e:
            key_row.failure_count += 1
            if key_row.failure_count >= MAX_FAILURES_BEFORE_DISABLE:
                key_row.is_active = False
            db.commit()
            last_error = e
            if got_any_content:
                # Partial reply already streamed to the client — better
                # to end cleanly than raise mid-stream, which FastAPI
                # can't turn into a clean error response at this point.
                return
            continue

    raise AssistantError(f"All configured NVIDIA keys failed. Last error: {last_error}")
