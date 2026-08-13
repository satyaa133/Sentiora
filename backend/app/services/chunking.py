from __future__ import annotations

import re
from dataclasses import dataclass

from app.models.memory_item import SourceType

MIN_CHUNK_CHARS = 220
TARGET_CHUNK_CHARS = 1200
MAX_CHUNK_CHARS = 1800

_SENTENCE_RE = re.compile(r"(?<=[.!?])\s+")
_PAGE_RE = re.compile(
    r"(?:^|\n)\s*(?:page|pg\.?)\s+(\d+)\s*(?:\n|$)",
    re.IGNORECASE,
)
_HEADING_RE = re.compile(
    r"^(#{1,6}\s+.+|[A-Z][A-Za-z0-9 ,/&'’:-]{3,80}|[A-Z0-9][A-Z0-9 ,/&'’:-]{3,60})$"
)


@dataclass(frozen=True)
class ChunkDraft:
    chunk_index: int
    content: str
    heading: str | None = None
    page_number: int | None = None


@dataclass
class _Block:
    text: str
    heading: str | None
    page_number: int | None
    is_heading: bool = False


def chunk_content(
    text: str,
    source_type: SourceType,
    *,
    title: str | None = None,
) -> list[ChunkDraft]:
    if not text or not text.strip():
        return []

    blocks = _split_into_blocks(text.strip(), source_type, title)
    packed = _pack_blocks(blocks, fallback_heading=title if source_type != SourceType.webpage else None)
    return [
        ChunkDraft(
            chunk_index=index,
            content=chunk.content,
            heading=chunk.heading,
            page_number=chunk.page_number,
        )
        for index, chunk in enumerate(packed)
    ]


def _split_into_blocks(text: str, source_type: SourceType, title: str | None) -> list[_Block]:
    if source_type == SourceType.pdf:
        return _split_pdf_blocks(text)
    if source_type == SourceType.youtube:
        return _split_transcript_blocks(text, title)
    return _split_article_blocks(text)


def _split_pdf_blocks(text: str) -> list[_Block]:
    parts = _PAGE_RE.split(text)
    if len(parts) == 1:
        return _split_article_blocks(text)

    blocks: list[_Block] = []
    preamble = parts[0].strip()
    if preamble:
        blocks.extend(_split_article_blocks(preamble))

    for index in range(1, len(parts), 2):
        page_number = int(parts[index])
        body = parts[index + 1].strip() if index + 1 < len(parts) else ""
        page_blocks = _split_article_blocks(body) if body else []
        if not page_blocks:
            continue
        for block in page_blocks:
            block.page_number = page_number
            blocks.append(block)
    return blocks


def _split_transcript_blocks(text: str, title: str | None) -> list[_Block]:
    heading = title or "Transcript"
    sentences = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    if not sentences:
        return [_Block(text=text, heading=heading, page_number=None)]
    return [
        _Block(text=sentence, heading=heading, page_number=None)
        for sentence in sentences
    ]


def _looks_like_heading(line: str) -> bool:
    compact = line.strip()
    if len(compact) < 4 or len(compact) > 90:
        return False
    if compact.endswith((".", "!", "?", ",", ";")):
        return False
    if compact.startswith("[Transcript unavailable]"):
        return True
    return bool(_HEADING_RE.match(compact))


def _split_article_blocks(text: str) -> list[_Block]:
    paragraphs = [part.strip() for part in re.split(r"\n{2,}", text) if part.strip()]
    if len(paragraphs) <= 1:
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        paragraphs = lines or [text]

    blocks: list[_Block] = []
    current_heading: str | None = None
    for paragraph in paragraphs:
        if _looks_like_heading(paragraph):
            current_heading = paragraph.lstrip("# ").strip()
            blocks.append(
                _Block(
                    text=current_heading,
                    heading=current_heading,
                    page_number=None,
                    is_heading=True,
                )
            )
            continue
        blocks.append(
            _Block(text=paragraph, heading=current_heading, page_number=None)
        )
    return blocks


def _split_oversize(text: str) -> list[str]:
    if len(text) <= MAX_CHUNK_CHARS:
        return [text]
    sentences = [part.strip() for part in _SENTENCE_RE.split(text) if part.strip()]
    if not sentences:
        return [
            text[i : i + TARGET_CHUNK_CHARS].strip()
            for i in range(0, len(text), TARGET_CHUNK_CHARS)
        ]

    pieces: list[str] = []
    current = ""
    for sentence in sentences:
        candidate = f"{current} {sentence}".strip() if current else sentence
        if len(candidate) > MAX_CHUNK_CHARS and current:
            pieces.append(current)
            current = sentence
            continue
        current = candidate
    if current:
        pieces.append(current)
    return pieces


def _format_chunk(parts: list[str], heading: str | None) -> str:
    body = "\n\n".join(part.strip() for part in parts if part.strip())
    if heading and heading not in body[: len(heading) + 8]:
        return f"{heading}\n\n{body}".strip()
    return body.strip()


def _pack_blocks(blocks: list[_Block], fallback_heading: str | None) -> list[ChunkDraft]:
    if not blocks:
        return []

    drafts: list[ChunkDraft] = []
    current_parts: list[str] = []
    current_heading = fallback_heading
    current_page: int | None = None

    def flush() -> None:
        nonlocal current_parts, current_heading, current_page
        if not current_parts:
            return
        content = _format_chunk(current_parts, current_heading)
        if not content:
            current_parts = []
            return
        drafts.append(
            ChunkDraft(
                chunk_index=len(drafts),
                content=content,
                heading=current_heading,
                page_number=current_page,
            )
        )
        current_parts = []

    for block in blocks:
        if block.is_heading:
            if current_parts and len("\n\n".join(current_parts)) >= MIN_CHUNK_CHARS:
                flush()
            current_heading = block.heading or block.text
            current_page = block.page_number
            continue

        if (
            current_parts
            and block.page_number is not None
            and current_page is not None
            and block.page_number != current_page
        ):
            flush()
            current_heading = block.heading or current_heading
            current_page = block.page_number

        pieces = _split_oversize(block.text)
        for piece in pieces:
            candidate_parts = [*current_parts, piece]
            candidate_len = len(_format_chunk(candidate_parts, current_heading or block.heading))
            if current_parts and candidate_len > MAX_CHUNK_CHARS:
                flush()
                current_heading = block.heading or current_heading
                current_page = block.page_number
            elif not current_parts:
                current_heading = block.heading or current_heading or fallback_heading
                current_page = block.page_number

            current_parts.append(piece)
            if len(_format_chunk(current_parts, current_heading)) >= TARGET_CHUNK_CHARS:
                flush()
                current_heading = block.heading or current_heading
                current_page = block.page_number

    flush()
    if not drafts:
        body = "\n\n".join(block.text for block in blocks if not block.is_heading) or blocks[0].text
        return [
            ChunkDraft(
                chunk_index=0,
                content=_format_chunk([body], fallback_heading),
                heading=fallback_heading,
                page_number=blocks[0].page_number,
            )
        ]
    return drafts
