"""Small shared helper — LLMs asked for pure JSON (via json_mode=True in
services/ai_assistant.complete) sometimes still wrap it in markdown
fences or add a stray sentence, so every caller that parses a
structured completion goes through this rather than a bare
json.loads()."""

import json
import re


def extract_json(raw: str) -> dict:
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```(?:json)?", "", raw).rstrip("`").strip()
    try:
        return json.loads(raw)
    except ValueError:
        pass
    match = re.search(r"\{.*\}", raw, re.DOTALL)
    if match:
        return json.loads(match.group(0))
    raise ValueError("Model response did not contain valid JSON.")
