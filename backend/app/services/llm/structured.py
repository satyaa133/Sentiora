"""Answer metadata: validation, citation checks and the one-call trailer.

Since S6 the AI answer call returns its metadata in a trailer after the answer
text (``<<<META>>>``, a mode line, follow-up questions) instead of a second
structured call. The trailer is validated here; when it is missing or
malformed the metadata is derived from the answer's ``[S#]`` markers and
follow-ups are left empty.
"""

from __future__ import annotations

import json
import re
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

MetaMode = Literal["memory", "general", "mixed"]

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


# -- one-call answers (S6) ----------------------------------------------------
# The AI answer ends with a trailer instead of a second metadata call:
#
#   <answer text>
#   <<<META>>>
#   mode: memory | general | mixed
#   - follow-up question?
#
# The trailer is never streamed to the client.
TRAILER_MARKER = "<<<META>>>"
_MODE_LINE_RE = re.compile(r"^\s*mode\s*[:=]\s*(memory|general|mixed)\b", re.IGNORECASE)
_FOLLOWUP_LINE_RE = re.compile(r"^\s*(?:[-*•]|\d+[.)])\s*(.+)$")


class TrailerSplitter:
    """Splits streamed model output into answer text and the metadata trailer.

    ``feed`` returns the text that is safe to show now: it holds back a tail
    that could be the start of the marker, and everything after the marker.
    """

    def __init__(self) -> None:
        self._pending = ""
        self._trailer: str | None = None

    def feed(self, piece: str) -> str:
        if self._trailer is not None:
            self._trailer += piece
            return ""
        text = self._pending + piece
        at = text.find(TRAILER_MARKER)
        if at >= 0:
            self._trailer = text[at + len(TRAILER_MARKER) :]
            self._pending = ""
            return text[:at]
        keep = 0
        for size in range(min(len(TRAILER_MARKER) - 1, len(text)), 0, -1):
            if TRAILER_MARKER.startswith(text[-size:]):
                keep = size
                break
        self._pending = text[len(text) - keep :] if keep else ""
        return text[: len(text) - keep]

    def finish(self) -> str:
        """Text still held back (a marker prefix that never completed)."""
        rest, self._pending = self._pending, ""
        return rest if self._trailer is None else ""

    @property
    def trailer(self) -> str | None:
        return self._trailer


def split_trailer(text: str) -> tuple[str, str | None]:
    """``(answer, trailer)`` for a complete, non-streamed reply."""
    at = text.find(TRAILER_MARKER)
    if at < 0:
        return text, None
    return text[:at], text[at + len(TRAILER_MARKER) :]


def parse_trailer(trailer: str | None) -> AnswerMeta | None:
    """Mode and follow-ups from the trailer; None when it is missing or unusable."""
    if not trailer or not trailer.strip():
        return None
    mode: MetaMode | None = None
    followups: list[str] = []
    for line in trailer.splitlines():
        found = _MODE_LINE_RE.match(line)
        if found:
            mode = found.group(1).lower()  # type: ignore[assignment]
            continue
        item = _FOLLOWUP_LINE_RE.match(line)
        if item:
            followups.append(item.group(1).strip())
    if mode is None:
        return None
    try:
        return AnswerMeta(mode=mode, usedSources=[], followUps=followups)
    except ValidationError:
        return AnswerMeta(mode=mode, usedSources=[], followUps=[])
