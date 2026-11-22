"""Instant answer: the sentences of the user's saves that best answer the question.

No model writes anything here, so the answer cannot contain an invented fact:
every sentence is quoted from a retrieved source and cited ``[S#]``.

1. The reranked chunks are split into sentences (video transcripts, which have
   little punctuation, into lines of about ``_TRANSCRIPT_LINE_WORDS`` words with
   an estimated time).
2. The cross-encoder scores each (question, sentence) pair; at most
   ``MAX_SENTENCES`` sentences are scored, from the best chunks first.
3. The best ``MAX_QUOTES`` sentences scoring at least ``RAG_EXTRACT_MIN_SCORE``
   are kept, at most ``MAX_PER_SOURCE`` from one source; a short sentence brings
   its neighbour along so it reads on its own.
4. They are rendered as Markdown, grouped by source in document order.

When nothing clears the threshold the question is not answered by the saves
(``ExtractedAnswer.text`` is None).
"""

from __future__ import annotations

import logging
import math
import re
from collections.abc import Callable, Sequence
from dataclasses import dataclass

from app.core.metrics import observe_stage
from app.services.chunking import format_timestamp
from app.services.rag_sanitize import strip_instruction_like_lines
from app.services.retrieval.reranker import get_reranker
from app.services.retrieval_service import (
    RetrievedChunk,
    keyword_coverage,
    needs_document_context,
)

logger = logging.getLogger(__name__)

# Sentences scored per question (the reranker costs CPU per pair).
MAX_SENTENCES = 60
MAX_QUOTES = 5
MAX_PER_SOURCE = 2
# A sentence shorter than this brings the next one from its source.
SHORT_SENTENCE_CHARS = 90
_MIN_SENTENCE_CHARS = 24
# A chunk with no full sentence is quoted whole when it is at least this long.
_MIN_TINY_CHARS = 8
_MAX_SENTENCE_CHARS = 400
_TRANSCRIPT_LINE_WORDS = 28
# Without a reranker, a sentence needs this share of the question's keywords.
_KEYWORD_MIN_COVERAGE = 0.5
# Two quotes sharing this share of words are one quote (overlapping windows).
_DUPLICATE_OVERLAP = 0.8

# "What is X about?", "What does X cover?": asks for an overview of a save.
_ABOUT_RE = re.compile(
    r"\bwhat\b.{0,80}\b(about|cover|covers|contain|contains)\s*[?.!]*\s*$", re.IGNORECASE
)
_SENTENCE_END_RE = re.compile(r"(?<=[.!?])\s+(?=[\"'“(\[]?[A-Z0-9])")
_WORD_RE = re.compile(r"[a-z0-9]+")

# (question, sentences) -> one score per sentence, higher is better.
Scorer = Callable[[str, Sequence[str]], list[float]]


@dataclass(frozen=True)
class Sentence:
    source: int  # 1-based index of the source ([S#])
    position: int  # order within its source
    text: str
    start_sec: float | None = None


@dataclass(frozen=True)
class ExtractedAnswer:
    text: str | None
    used_sources: list[str]
    best_score: float | None


def _clip(text: str) -> str:
    if len(text) <= _MAX_SENTENCE_CHARS:
        return text
    return text[: _MAX_SENTENCE_CHARS - 1].rsplit(" ", 1)[0] + "…"


def _prose_sentences(content: str) -> list[str]:
    sentences: list[str] = []
    for block in re.split(r"\n\s*\n|\n(?=[-*•]\s)", content):
        flat = " ".join(block.split()).lstrip("-*• ").strip()
        if not flat:
            continue
        for part in _SENTENCE_END_RE.split(flat):
            part = part.strip()
            if len(part) >= _MIN_SENTENCE_CHARS:
                sentences.append(_clip(part))
    return sentences


def is_overview_question(question: str) -> bool:
    """Summaries, key points, explanations and "what is X about?" questions."""
    return needs_document_context(question) or bool(_ABOUT_RE.search(question.strip()))


def _transcript_lines(chunk: RetrievedChunk) -> list[tuple[str, float | None]]:
    """Lines of about ``_TRANSCRIPT_LINE_WORDS`` words with an estimated start time.

    A chunk records only its window's start and end, so a line's time is
    interpolated by its word position: close enough to jump to the moment.
    """
    words = strip_instruction_like_lines(chunk.content).split()
    if not words:
        return []
    start = chunk.start_sec or 0.0
    end = chunk.end_sec if chunk.end_sec is not None else start
    span = max(end - start, 0.0)
    lines: list[tuple[str, float | None]] = []
    for offset in range(0, len(words), _TRANSCRIPT_LINE_WORDS):
        piece = words[offset : offset + _TRANSCRIPT_LINE_WORDS]
        if len(piece) < 6 and lines:
            # A short tail joins the line before it.
            text, at = lines[-1]
            lines[-1] = (f"{text} {' '.join(piece)}", at)
            continue
        lines.append((" ".join(piece), start + span * offset / len(words)))
    return lines


def split_sentences(chunks: Sequence[RetrievedChunk]) -> list[Sentence]:
    """Sentences of each chunk, best chunk first, at most ``MAX_SENTENCES``."""
    found: list[Sentence] = []
    for index, chunk in enumerate(chunks, start=1):
        if chunk.start_sec is not None:
            parts = _transcript_lines(chunk)
        else:
            content = strip_instruction_like_lines(chunk.content)
            parts = [(text, None) for text in _prose_sentences(content)]
            tiny = " ".join(content.split())
            if not parts and len(tiny) >= _MIN_TINY_CHARS:
                # A save shorter than one sentence is quoted whole.
                parts = [(_clip(tiny), None)]
        found.extend(
            Sentence(index, position, text, at)
            for position, (text, at) in enumerate(parts)
        )
    if len(found) <= MAX_SENTENCES:
        return found
    # Share the budget across sources so a long first chunk can't take it all.
    by_source: dict[int, list[Sentence]] = {}
    for sentence in found:
        by_source.setdefault(sentence.source, []).append(sentence)
    picked: list[Sentence] = []
    depth = 0
    while len(picked) < MAX_SENTENCES:
        added = False
        for sentences in by_source.values():
            if depth < len(sentences) and len(picked) < MAX_SENTENCES:
                picked.append(sentences[depth])
                added = True
        if not added:
            break
        depth += 1
    return sorted(picked, key=lambda s: (s.source, s.position))


def _words(text: str) -> set[str]:
    return set(_WORD_RE.findall(text.lower()))


def _duplicate(a: str, b: str) -> bool:
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return False
    return len(wa & wb) / min(len(wa), len(wb)) >= _DUPLICATE_OVERLAP


def _default_scorer() -> tuple[Scorer, float | None]:
    """The cross-encoder, or keyword coverage when it is off (with its own bar)."""
    reranker = get_reranker()
    if reranker is not None:
        return reranker.score_sentences, None

    def keywords(question: str, sentences: Sequence[str]) -> list[float]:
        return [keyword_coverage(question, text) for text in sentences]

    return keywords, _KEYWORD_MIN_COVERAGE


def extract_answer(
    question: str,
    chunks: Sequence[RetrievedChunk],
    min_score: float,
    scorer: Scorer | None = None,
) -> ExtractedAnswer:
    """Best quoted sentences for ``question`` from ``chunks`` (cited by position)."""
    sentences = split_sentences(chunks)
    if not sentences:
        return ExtractedAnswer(None, [], None)
    threshold = min_score
    if scorer is None:
        scorer, keyword_bar = _default_scorer()
        if keyword_bar is not None:
            threshold = keyword_bar
    try:
        with observe_stage("extract"):
            scores = scorer(question, [s.text for s in sentences])
    except Exception:
        logger.warning("Sentence scoring failed; using keyword overlap", exc_info=True)
        scores = [keyword_coverage(question, s.text) for s in sentences]
        threshold = _KEYWORD_MIN_COVERAGE
    if len(scores) != len(sentences):
        raise RuntimeError("The scorer returned the wrong number of scores.")

    ranked = sorted(zip(sentences, scores, strict=True), key=lambda pair: -pair[1])
    best = ranked[0][1]
    chosen: list[Sentence] = []
    per_source: dict[int, int] = {}
    for sentence, score in ranked:
        if score < threshold or len(chosen) >= MAX_QUOTES:
            break
        if per_source.get(sentence.source, 0) >= MAX_PER_SOURCE:
            continue
        if any(_duplicate(sentence.text, other.text) for other in chosen):
            continue
        chosen.append(sentence)
        per_source[sentence.source] = per_source.get(sentence.source, 0) + 1
    if not chosen:
        return ExtractedAnswer(None, [], best)

    text, used = _render(chosen, sentences)
    return ExtractedAnswer(text, used, best)


def _with_neighbour(sentence: Sentence, everything: Sequence[Sentence]) -> list[Sentence]:
    # Transcript lines are cut by word count, not at sentence ends, so the
    # next line usually finishes the thought.
    if sentence.start_sec is None and len(sentence.text) >= SHORT_SENTENCE_CHARS:
        return [sentence]
    following = next(
        (
            s
            for s in everything
            if s.source == sentence.source and s.position == sentence.position + 1
        ),
        None,
    )
    return [sentence, following] if following else [sentence]


def _render(chosen: list[Sentence], everything: Sequence[Sentence]) -> tuple[str, list[str]]:
    """Markdown with ``[S#]`` markers: sources in order of their best quote."""
    order: list[int] = []
    for sentence in chosen:
        if sentence.source not in order:
            order.append(sentence.source)
    quoted: set[tuple[int, int]] = set()
    items: list[str] = []
    for source in order:
        mine = sorted(
            (s for s in chosen if s.source == source), key=lambda s: s.position
        )
        for sentence in mine:
            group = [
                s
                for s in _with_neighbour(sentence, everything)
                if (s.source, s.position) not in quoted
            ]
            if not group:
                continue
            quoted.update((s.source, s.position) for s in group)
            body = " ".join(s.text for s in group)
            when = (
                f"({format_timestamp(sentence.start_sec)}) "
                if sentence.start_sec is not None
                else ""
            )
            items.append(f"{when}{body} [S{source}]")
    used = [f"S{source}" for source in order]
    if len(items) == 1:
        return items[0], used
    return "\n".join(f"- {item}" for item in items), used


def overview_answer(chunks: Sequence[RetrievedChunk]) -> ExtractedAnswer:
    """Leading sentences of the best-matching save, for "summarise X" questions.

    Used when the save has no stored summary yet (not enriched): the opening
    sentences of each of its retrieved sections, in reading order.
    """
    if not chunks:
        return ExtractedAnswer(None, [], None)
    target = chunks[0].memory_id
    mine = [
        (index, chunk)
        for index, chunk in enumerate(chunks, start=1)
        if chunk.memory_id == target
    ]
    mine.sort(
        key=lambda pair: (
            pair[1].start_sec if pair[1].start_sec is not None else float("inf"),
            pair[1].page_number if pair[1].page_number is not None else 0,
            pair[0],
        )
    )
    everything = split_sentences([chunk for _, chunk in mine])
    # Opening sentences of each section, more of each when there are few.
    per_chunk = max(2, math.ceil(MAX_QUOTES / len(mine)))
    picked: list[Sentence] = []
    for position, (index, _chunk) in enumerate(mine, start=1):
        leading = [s for s in everything if s.source == position][:per_chunk]
        for sentence in leading:
            if len(picked) >= MAX_QUOTES:
                break
            if any(_duplicate(sentence.text, other.text) for other in picked):
                continue
            picked.append(
                Sentence(index, sentence.position, sentence.text, sentence.start_sec)
            )
    if not picked:
        return ExtractedAnswer(None, [], None)
    items = [
        (f"({format_timestamp(s.start_sec)}) " if s.start_sec is not None else "")
        + f"{s.text} [S{s.source}]"
        for s in picked
    ]
    used = list(dict.fromkeys(f"S{s.source}" for s in picked))
    if len(items) == 1:
        return ExtractedAnswer(items[0], used, None)
    return ExtractedAnswer("\n".join(f"- {item}" for item in items), used, None)
