"""Enrichment of one save: prompt, JSON schema and validation (REBUILD_PLAN S5).

One structured call reads a save (title, headings and as much of every chunk
as fits the input cap) and returns a summary, key points, questions the save
answers (each with the chunk that answers it) and one context line per chunk.
The reply is validated here; anything that doesn't fit is dropped rather than
stored.
"""

from __future__ import annotations

import json
from collections.abc import Sequence
from dataclasses import dataclass
from typing import Any

from pydantic import BaseModel, ConfigDict, Field, ValidationError, field_validator

from app.services.chunking import format_timestamp
from app.services.rag_sanitize import (
    UNTRUSTED_CONTEXT_INSTRUCTIONS,
    strip_instruction_like_lines,
)

# Characters of saved text sent per save (all chunks share it), plus headings.
MAX_INPUT_CHARS = 12_000
# Every chunk is shown, however long the save, so it can get a context line.
MIN_CHARS_PER_CHUNK = 100
MAX_KEY_POINTS = 8
MIN_QUESTIONS = 5
MAX_QUESTIONS = 10
MAX_SUMMARY_CHARS = 1200
MAX_LINE_CHARS = 300

ENRICH_SYSTEM_PROMPT = (
    """You index one document a user saved in Sentiora, a private memory app, so they \
can find it again later. Return only JSON matching the schema.

- summary: 2-4 sentences saying what the document is and what it covers.
- key_points: up to 8 short points with the document's main ideas or facts.
- questions: 5-10 questions a reader might later ask that this document answers. Word them \
the way a person would ask, not with the document's own phrasing, and make each one specific \
and standalone. "chunk" is the number of the chunk that answers it.
- contexts: one entry per chunk number. "context" is one short line (under 25 words) saying \
which part of the document the chunk is and what it is about, e.g. "From the YOLO tutorial: \
how anchor boxes let one grid cell detect two objects."

Write in the document's language. State only what the document says."""
    + "\n"
    + UNTRUSTED_CONTEXT_INSTRUCTIONS.strip()
)

ENRICH_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "summary": {"type": "string"},
        "key_points": {"type": "array", "items": {"type": "string"}},
        "questions": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "question": {"type": "string"},
                    "chunk": {"type": "integer"},
                },
                "required": ["question", "chunk"],
                "additionalProperties": False,
            },
        },
        "contexts": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "chunk": {"type": "integer"},
                    "context": {"type": "string"},
                },
                "required": ["chunk", "context"],
                "additionalProperties": False,
            },
        },
    },
    "required": ["summary", "key_points", "questions", "contexts"],
    "additionalProperties": False,
}

ENRICH_RESPONSE_FORMAT: dict[str, Any] = {
    "type": "json_schema",
    "json_schema": {"name": "save_enrichment", "strict": True, "schema": ENRICH_SCHEMA},
}


@dataclass(frozen=True)
class ChunkInput:
    index: int
    content: str
    heading: str | None = None
    page_number: int | None = None
    start_sec: float | None = None
    end_sec: float | None = None


def _clean_line(value: str, limit: int = MAX_LINE_CHARS) -> str:
    return " ".join(value.split())[:limit].strip()


def _where(chunk: ChunkInput) -> str:
    if chunk.start_sec is not None:
        end = chunk.end_sec if chunk.end_sec is not None else chunk.start_sec
        return f" [{format_timestamp(chunk.start_sec)}-{format_timestamp(end)}]"
    if chunk.page_number is not None:
        return f" (page {chunk.page_number})"
    return ""


def enrich_prompt(title: str, source_type: str, chunks: Sequence[ChunkInput]) -> str:
    """The user message: the save's title and every chunk, cut to share the cap."""
    per_chunk = max(MIN_CHARS_PER_CHUNK, MAX_INPUT_CHARS // max(len(chunks), 1))
    blocks = []
    for chunk in chunks:
        text = strip_instruction_like_lines(chunk.content)
        text = " ".join(text.split())
        if len(text) > per_chunk:
            text = text[:per_chunk].rsplit(" ", 1)[0] + " …"
        heading = f" — {_clean_line(chunk.heading, 120)}" if chunk.heading else ""
        blocks.append(f"[chunk {chunk.index}]{_where(chunk)}{heading}\n{text}")
    safe_title = _clean_line(strip_instruction_like_lines(title), 300)
    return (
        f"Document title: {safe_title}\nType: {source_type}\nChunks: {len(chunks)} "
        f"(numbered 0-{len(chunks) - 1}; long chunks are cut short)\n\n"
        "<<DOCUMENT\n" + "\n\n".join(blocks) + "\nDOCUMENT"
    )


class _Question(BaseModel):
    question: str
    chunk: int


class _Context(BaseModel):
    chunk: int
    context: str


class _RawEnrichment(BaseModel):
    model_config = ConfigDict(extra="ignore")

    summary: str
    key_points: list[str] = Field(default_factory=list)
    questions: list[_Question] = Field(default_factory=list)
    contexts: list[_Context] = Field(default_factory=list)

    @field_validator("summary")
    @classmethod
    def _summary(cls, value: str) -> str:
        cleaned = " ".join(value.split())[:MAX_SUMMARY_CHARS].strip()
        if not cleaned:
            raise ValueError("empty summary")
        return cleaned


@dataclass(frozen=True)
class Enrichment:
    summary: str
    key_points: list[str]
    # (question, index of the chunk that answers it)
    questions: list[tuple[str, int]]
    # chunk index -> context line
    contexts: dict[int, str]


def parse_enrichment(raw: str, chunk_count: int) -> Enrichment | None:
    """Validated enrichment, or None when the reply is unusable.

    Questions and context lines that point at a chunk that doesn't exist are
    dropped; fewer than MIN_QUESTIONS usable questions makes the reply unusable.
    """
    try:
        parsed = _RawEnrichment.model_validate(json.loads(raw))
    except (ValueError, ValidationError):
        return None
    points: list[str] = []
    for point in parsed.key_points:
        line = _clean_line(point)
        if line and line.lower() not in {p.lower() for p in points}:
            points.append(line)
    questions: list[tuple[str, int]] = []
    seen: set[str] = set()
    for item in parsed.questions:
        text = _clean_line(item.question)
        if len(text) < 8 or not 0 <= item.chunk < chunk_count or text.lower() in seen:
            continue
        seen.add(text.lower())
        questions.append((text if text.endswith("?") else f"{text}?", item.chunk))
    if len(questions) < min(MIN_QUESTIONS, chunk_count * 2):
        return None
    contexts: dict[int, str] = {}
    for entry in parsed.contexts:
        line = _clean_line(entry.context)
        if line and 0 <= entry.chunk < chunk_count and entry.chunk not in contexts:
            contexts[entry.chunk] = line
    return Enrichment(
        summary=parsed.summary,
        key_points=points[:MAX_KEY_POINTS],
        questions=questions[:MAX_QUESTIONS],
        contexts=contexts,
    )
