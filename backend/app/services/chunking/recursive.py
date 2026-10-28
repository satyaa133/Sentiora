"""Recursive splitter for articles, PDFs and untimed transcripts.

Text is first cut into sections at headings (and PDF page markers). Each
section is split recursively, paragraphs → lines → sentences → words, until
every piece fits, and the pieces are packed into ~400–600 token chunks with
~15% overlap. Headings and pages are hard boundaries: a chunk never spans two
sections, except that sections too short to stand alone merge into the next.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.memory_item import SourceType
from app.services.chunking.types import (
    MAX_CHUNK_CHARS,
    MIN_SECTION_CHARS,
    OVERLAP_CHARS,
    TARGET_CHUNK_CHARS,
    ChunkDraft,
)

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_PAGE_RE = re.compile(
    r"(?:^|\n)\s*(?:page|pg\.?)\s+(\d+)\s*(?:\n|$)",
    re.IGNORECASE,
)
_HEADING_RE = re.compile(
    r"^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 ,/&'’:-]{3,80}|[A-Z0-9][A-Z0-9 ,/&'’:-]{3,60})$"
)

# Separators tried in order, each with the string used to re-join its pieces.
_SEPARATORS: tuple[tuple[re.Pattern[str], str], ...] = (
    (re.compile(r"\n{2,}"), "\n\n"),
    (re.compile(r"\n"), "\n"),
    (_SENTENCE_RE, " "),
    (re.compile(r"\s+"), " "),
)


@dataclass
class _Section:
    heading: str | None
    page_number: int | None
    text: str


def chunk_content(
    text: str,
    source_type: SourceType,
    *,
    title: str | None = None,
) -> list[ChunkDraft]:
    """Chunk plain text. ``title`` is accepted for compatibility and not used:
    the title is memory metadata and never part of chunk text."""
    if not text or not text.strip():
        return []

    drafts: list[ChunkDraft] = []
    for section in _merge_short_sections(_sections(text.strip(), source_type)):
        for body in _pack(_split(section.text, MAX_CHUNK_CHARS)):
            drafts.append(
                ChunkDraft(
                    chunk_index=len(drafts),
                    content=body,
                    heading=section.heading,
                    page_number=section.page_number,
                )
            )
    return drafts


# --- sections -----------------------------------------------------------------


def _sections(text: str, source_type: SourceType) -> list[_Section]:
    if source_type == SourceType.pdf:
        return _pdf_sections(text)
    if source_type == SourceType.youtube:
        # Untimed transcripts have no headings; detecting them would misfire.
        return [_Section(heading=None, page_number=None, text=text)]
    return _article_sections(text, page_number=None)


def _pdf_sections(text: str) -> list[_Section]:
    parts = _PAGE_RE.split(text)
    if len(parts) == 1:
        return _article_sections(text, page_number=None)

    sections: list[_Section] = []
    preamble = parts[0].strip()
    if preamble:
        sections.extend(_article_sections(preamble, page_number=None))
    for index in range(1, len(parts), 2):
        body = parts[index + 1].strip() if index + 1 < len(parts) else ""
        if body:
            sections.extend(_article_sections(body, page_number=int(parts[index])))
    return sections


def _looks_like_heading(line: str) -> bool:
    compact = line.strip()
    if len(compact) < 4 or len(compact) > 90:
        return False
    if compact.endswith((".", "!", "?", ",", ";")):
        return False
    return bool(_HEADING_RE.match(compact))


def _article_sections(text: str, page_number: int | None) -> list[_Section]:
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
    if len(paragraphs) <= 1:
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        paragraphs = lines or [text]

    sections: list[_Section] = []
    heading: str | None = None
    body: list[str] = []
    for paragraph in paragraphs:
        if _looks_like_heading(paragraph):
            if body:
                sections.append(_Section(heading, page_number, "\n\n".join(body)))
            heading = paragraph.lstrip("# ").strip()
            body = []
            continue
        body.append(paragraph)
    if body:
        sections.append(_Section(heading, page_number, "\n\n".join(body)))
    return sections


def _merge_short_sections(sections: list[_Section]) -> list[_Section]:
    """Fold sections too short to stand alone into the following section."""
    merged: list[_Section] = []
    pending: _Section | None = None
    for section in sections:
        if pending and pending.page_number == section.page_number:
            section = _Section(
                pending.heading or section.heading,
                section.page_number,
                f"{pending.text}\n\n{section.text}",
            )
        elif pending:
            merged.append(pending)
        pending = None
        if len(section.text) < MIN_SECTION_CHARS:
            pending = section
            continue
        merged.append(section)
    if pending:
        merged.append(pending)
    return merged


# --- recursive split and pack -------------------------------------------------


def _split(text: str, limit: int, level: int = 0) -> list[tuple[str, str]]:
    """Split ``text`` into (piece, joiner) pairs, each piece at most ``limit``.

    ``joiner`` is the separator that originally preceded the piece, used when
    pieces are packed back together.
    """
    text = text.strip()
    if not text:
        return []
    if len(text) <= limit:
        return [(text, "\n\n")]
    for depth in range(level, len(_SEPARATORS)):
        pattern, joiner = _SEPARATORS[depth]
        parts = [part for part in pattern.split(text) if part.strip()]
        if len(parts) <= 1:
            continue
        pieces: list[tuple[str, str]] = []
        for part in parts:
            sub = _split(part, limit, depth + 1)
            if sub:
                # The first sub-piece follows this level's separator.
                pieces.append((sub[0][0], joiner))
                pieces.extend(sub[1:])
        return pieces
    # A single unbroken run of characters: hard cut.
    return [(text[i : i + limit], "") for i in range(0, len(text), limit)]


def _join(pieces: list[tuple[str, str]]) -> str:
    out = ""
    for piece, joiner in pieces:
        out = f"{out}{joiner}{piece}" if out else piece
    return out.strip()


def _tail(text: str, limit: int) -> str:
    """The last whole sentences (or, failing that, words) of ``text`` within ``limit``."""
    for pattern in (_SENTENCE_RE, re.compile(r"\s+")):
        parts = [part for part in pattern.split(text) if part.strip()]
        tail: list[str] = []
        size = 0
        for part in reversed(parts):
            if size + len(part) + 1 > limit:
                break
            tail.insert(0, part)
            size += len(part) + 1
        if tail and len(tail) < len(parts):
            return " ".join(tail)
    return ""


def _pack(pieces: list[tuple[str, str]]) -> list[str]:
    chunks: list[str] = []
    current: list[tuple[str, str]] = []
    overlap_only = False

    def flush() -> None:
        nonlocal current, overlap_only
        if current and not overlap_only:
            body = _join(current)
            chunks.append(body)
            overlap = _tail(body, OVERLAP_CHARS)
            current = [(overlap, "")] if overlap else []
            overlap_only = bool(overlap)
        else:
            current = []
            overlap_only = False

    for piece, joiner in pieces:
        size = len(_join([*current, (piece, joiner)]))
        if current and size > MAX_CHUNK_CHARS:
            flush()
            if current and len(_join([*current, (piece, " ")])) > MAX_CHUNK_CHARS:
                current, overlap_only = [], False
        current.append((piece, joiner if current and not overlap_only else " "))
        overlap_only = False
        if len(_join(current)) >= TARGET_CHUNK_CHARS:
            flush()
    if current and not overlap_only:
        chunks.append(_join(current))
    return chunks
