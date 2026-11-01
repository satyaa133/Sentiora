"""Structured answer metadata: schema, validation and graceful fallback.

After the answer text is generated, a separate non-streaming call asks the
model for ``{mode, usedSources, followUps}`` using OpenRouter Structured
Outputs (``response_format: json_schema``, ``strict: true``,
``provider.require_parameters: true``). The reply is validated here; on any
failure the metadata is derived from the answer's ``[S#]`` markers instead and
follow-ups are left empty.
"""

from __future__ import annotations

import json
import re
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

MetaMode = Literal["memory", "general", "mixed"]

ANSWER_META_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "mode": {"type": "string", "enum": ["memory", "general", "mixed"]},
        "usedSources": {"type": "array", "items": {"type": "string"}},
        "followUps": {"type": "array", "items": {"type": "string"}, "maxItems": 3},
    },
    "required": ["mode", "usedSources", "followUps"],
    "additionalProperties": False,
}

RESPONSE_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {
        "name": "answer_meta",
        "strict": True,
        "schema": ANSWER_META_SCHEMA,
    },
}

_MARKER_RE = re.compile(r"\[S(\d+)\]")
_MAX_FOLLOWUP_CHARS = 140


class AnswerMeta(BaseModel):
    model_config = ConfigDict(extra="forbid")

    mode: MetaMode
    usedSources: list[str] = Field(default_factory=list)  # noqa: N815 (wire format)
    followUps: list[str] = Field(default_factory=list, max_length=3)  # noqa: N815

    @field_validator("followUps", mode="before")
    @classmethod
    def _clean_followups(cls, value: object) -> object:
        if not isinstance(value, list):
            return value
        cleaned: list[str] = []
        for item in value:
            if not isinstance(item, str):
                continue
            text = " ".join(item.split()).strip()
            if 8 <= len(text) <= _MAX_FOLLOWUP_CHARS and text.lower() not in {
                c.lower() for c in cleaned
            }:
                cleaned.append(text if text.endswith("?") else f"{text}?")
        return cleaned[:3]


def cited_sources(answer: str, source_count: int) -> list[str]:
    """``S#`` ids cited in ``answer`` that exist, in first-use order."""
    seen: list[str] = []
    for raw in _MARKER_RE.findall(answer):
        index = int(raw)
        sid = f"S{index}"
        if 1 <= index <= source_count and sid not in seen:
            seen.append(sid)
    return seen


def parse_meta(raw: str) -> AnswerMeta | None:
    """Validate the model's JSON; None when it is missing or malformed."""
    if not raw or not raw.strip():
        return None
    text = raw.strip()
    if text.startswith("```"):
        text = text.strip("`").removeprefix("json").strip()
    try:
        return AnswerMeta.model_validate(json.loads(text))
    except (json.JSONDecodeError, ValidationError, TypeError):
        return None


def reconcile(
    meta: AnswerMeta | None, answer: str, source_count: int, question: str = ""
) -> AnswerMeta:
    """Final metadata consistent with the answer text.

    The answer's own valid ``[S#]`` markers are the ground truth for which
    sources were used; the model's mode is kept unless it contradicts them.
    """
    cited = cited_sources(answer, source_count)
    if meta is None:
        return AnswerMeta(
            mode="memory" if cited else "general", usedSources=cited, followUps=[]
        )
    mode: MetaMode = meta.mode
    if not cited:
        mode = "general"
    elif mode == "general":
        mode = "mixed"
    asked = " ".join(question.lower().split()).rstrip("?")
    followups = [f for f in meta.followUps if f.lower().rstrip("?") != asked]
    return AnswerMeta(mode=mode, usedSources=cited, followUps=followups)


def strip_unknown_markers(answer: str, source_count: int) -> str:
    """Remove ``[S#]`` markers that point at no supplied source."""

    def keep(match: re.Match[str]) -> str:
        return match.group(0) if 1 <= int(match.group(1)) <= source_count else ""

    text = _MARKER_RE.sub(keep, answer)
    return re.sub(r"[ \t]+([.,;:!?])", r"\1", text).strip()


_LEGACY_MARKER_RE = re.compile(
    r"\[(?:Sources?\s*|S\s*)(\d+(?:\s*(?:,|and|&)\s*(?:S\s*)?\d+)*)\]", re.IGNORECASE
)


def normalize_markers(answer: str) -> str:
    """Rewrite ``[Source 2]``, ``[S1, S3]`` and similar into ``[S2]``, ``[S1][S3]``.

    Bare ``[3]`` is left alone: it is as likely to be code (``arr[3]``).
    """
    return _LEGACY_MARKER_RE.sub(
        lambda m: "".join(f"[S{n}]" for n in re.findall(r"\d+", m.group(1))), answer
    )
