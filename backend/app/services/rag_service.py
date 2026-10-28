"""RAG service: retrieves memory for a question and generates one cited answer.

Pipeline (docs/RAG_v2_ADDENDUM.md):
  prepare  question -> intent + scope -> query rewrite -> hybrid retrieval.
           Listing, "which sources mention" and not-found answers are fixed
           text; everything else needs the model. All database work is here.
  run      numbered sources [S1..Sn] -> one unified answer (streamed or not)
           -> structured metadata call {mode, usedSources, followUps}.
Without a reachable model, memory answers use a local extractive fallback.
"""

from __future__ import annotations

import logging
import re
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import tzinfo
from typing import Any, cast
from uuid import UUID

from openai import OpenAI
from openai.types.shared_params import ResponseFormatJSONSchema

from app.core.config import get_settings
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.repositories.memory_repository import MemoryFilters, MemoryRepository
from app.schemas.ask import AnswerMode, AskCitation, AskResponse, AskTurn
from app.services.ask_intent import (
    AskIntent,
    classify,
    resolve_timezone,
    scoped_intent,
)
from app.services.llm import prompts
from app.services.llm.structured import (
    RESPONSE_FORMAT,
    AnswerMeta,
    MetaMode,
    cited_sources,
    normalize_markers,
    parse_meta,
    reconcile,
    strip_unknown_markers,
)
from app.services.llm_pool import (
    DEFAULT_COOLDOWN_SECONDS,
    LLMBackend,
    build_backends,
    key_pool,
)
from app.services.rag_sanitize import (
    sanitize_untrusted_text,
    strip_instruction_like_lines,
)
from app.services.retrieval.query_rewriter import rewrite_query
from app.services.retrieval_service import (
    RetrievalService,
    RetrievedChunk,
    keyword_coverage,
    needs_document_context,
)

logger = logging.getLogger(__name__)

INSUFFICIENT_ANSWER = (
    "I couldn't find enough information in your saved memories to answer that."
)
NO_MODEL_FOR_GENERAL = (
    "I couldn't find enough information in your saved memories to answer that, "
    "and general-knowledge answers need the AI model, which is not configured on "
    "this server."
)
INSUFFICIENT_FOLLOWUP = "What did I capture this week?"
LISTING_LIMIT = 20
# Kept for callers that import it; the unified prompt replaced the per-mode ones.
SYSTEM_PROMPT = prompts.ANSWER_SYSTEM_PROMPT
COMBINED_HINT = (
    "\n\nThe user is also asking about their saved material: say what the sources "
    "contain about it, or plainly that nothing relevant is saved."
)
_LEGACY_MODES: dict[MetaMode, AnswerMode] = {
    "memory": "memory",
    "general": "general",
    "mixed": "combined",
}


class LLMNotConfiguredError(RuntimeError):
    """Raised when the LLM API key is not set and no retrieved memory is available."""


# Per-key limit for one answer. Answers take a few seconds; a key that hangs
# this long is treated as down so the next key (or the memory answer) is used.
CHAT_TIMEOUT_SECONDS = 25
META_TIMEOUT_SECONDS = 15


class LLMProviderError(RuntimeError):
    """Raised when a configured LLM provider fails at runtime."""

    # HTTP statuses that mean the provider account or service is unavailable
    # (no credits, bad key, quota, overload) rather than a one-off failure.
    UNAVAILABLE_STATUSES = frozenset({401, 402, 403, 429, 503})

    def __init__(self, message: str, status: int | None = None) -> None:
        super().__init__(message)
        self.status = status

    @property
    def provider_unavailable(self) -> bool:
        return self.status in self.UNAVAILABLE_STATUSES


@dataclass(frozen=True)
class AskEvent:
    """One server-sent event: ``sources``, ``delta``, ``final`` or ``error``."""

    name: str
    data: dict[str, Any]


@dataclass
class PreparedAnswer:
    """Everything needed to answer, gathered before any model call."""

    question: str
    history: tuple[AskTurn, ...]
    sources: list[AskCitation]
    # Chunks for the model, aligned with ``sources``; empty for fixed answers.
    chunks: list[RetrievedChunk] = field(default_factory=list)
    # Fixed answer text (with [S#] markers); None when the model must answer.
    fixed_answer: str | None = None
    fixed_mode: MetaMode = "memory"
    fixed_used: list[str] | None = None
    personal: bool = False
    combined: bool = False
    insufficient: bool = False
    used_fallback: bool = False
    followups: list[str] = field(default_factory=list)


def _group_by_memory(chunks: Sequence[RetrievedChunk]) -> list[list[RetrievedChunk]]:
    """Group ranked chunks by memory, in rank order."""
    groups: dict[UUID, list[RetrievedChunk]] = {}
    for chunk in chunks:
        groups.setdefault(chunk.memory_id, []).append(chunk)
    return list(groups.values())


def _citation(chunk: RetrievedChunk) -> AskCitation:
    return AskCitation(
        memory_id=chunk.memory_id,
        chunk_id=chunk.chunk_id,
        title=chunk.title,
        url=chunk.url,
        source_type=chunk.source_type,
        domain=chunk.domain,
        heading=chunk.heading,
        page_number=chunk.page_number,
        start_sec=chunk.start_sec,
        end_sec=chunk.end_sec,
        source_available=_source_available(chunk.url),
        captured_at=chunk.captured_at,
        excerpt=_excerpt(strip_instruction_like_lines(chunk.content), limit=220)
        or None,
    )


def _citations_from_chunks(chunks: list[RetrievedChunk]) -> list[AskCitation]:
    """One citation per memory (its best chunk), for fixed answers."""
    return [_citation(group[0]) for group in _group_by_memory(chunks)]


def _first_per_memory(chunks: Sequence[RetrievedChunk]) -> list[str]:
    """``S#`` ids of each memory's first chunk, for fallback answers that cite no markers."""
    seen: set[UUID] = set()
    ids: list[str] = []
    for index, chunk in enumerate(chunks, start=1):
        if chunk.memory_id not in seen:
            seen.add(chunk.memory_id)
            ids.append(prompts.source_id(index))
    return ids


def _to_legacy_markers(answer: str, used: list[str]) -> tuple[str, list[int]]:
    """Rewrite ``[S#]`` to ``[k]`` numbered by first use, for ``POST /chat`` clients."""
    order: list[int] = []

    def renumber(match: re.Match[str]) -> str:
        index = int(match.group(1))
        if index not in order:
            order.append(index)
        return f"[{order.index(index) + 1}]"

    text = re.sub(r"\[S(\d+)\]", renumber, answer)
    for sid in used:
        index = int(sid[1:])
        if index not in order:
            order.append(index)
    return text, order


def _status_of(exc: Exception) -> int | None:
    # openai errors carry status_code, google-genai errors carry code.
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    status = status if isinstance(status, int) else None
    if status == 400 and "api key" in str(exc).lower():
        # Gemini answers a bad or revoked key with 400, not 401.
        return 401
    return status


def _event_sources(sources: list[AskCitation]) -> AskEvent:
    return AskEvent(
        "sources",
        {
            "sources": [
                {"id": prompts.source_id(i), **source.model_dump(mode="json")}
                for i, source in enumerate(sources, start=1)
            ]
        },
    )


OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://github.com/satyaa133/Sentiora",
    "X-Title": "Sentiora",
}


@dataclass(frozen=True)
class _Extra:
    """Provider-specific headers and body fields for an OpenAI-compatible call."""

    headers: dict[str, str] | None = None
    body: dict[str, Any] | None = None


def openrouter_fallback_models(settings: Any) -> list[str]:
    """``OPENROUTER_FALLBACK_MODELS`` as a list (comma-separated in the env)."""
    raw = getattr(settings, "openrouter_fallback_models", None) or ""
    if isinstance(raw, list):
        return [str(m).strip() for m in raw if str(m).strip()]
    return [m.strip() for m in str(raw).split(",") if m.strip()]


def _source_available(url: str) -> bool:
    lower = (url or "").lower()
    if not lower:
        return False
    return not (
        lower.startswith("file://")
        or lower.startswith("chrome://")
        or lower.startswith("about:")
    )


def _dedupe_repeated_clauses(text: str) -> str:
    parts = re.split(r"(?<=[.!?])\s+", " ".join((text or "").split()))
    result: list[str] = []
    seen: set[str] = set()
    for part in parts:
        key = part.strip().lower()
        if not key or key in seen:
            continue
        seen.add(key)
        result.append(part.strip())
    return " ".join(result)


def _excerpt(text: str, limit: int = 420) -> str:
    unique = _unique_sentences(text, limit=50)
    if unique:
        collapsed = " ".join(unique)
        if len(collapsed) <= limit:
            return collapsed
        trimmed = collapsed[:limit].rsplit(" ", 1)[0]
        return f"{trimmed}…"
    collapsed = _dedupe_repeated_clauses(text)
    if len(collapsed) <= limit:
        return collapsed
    trimmed = collapsed[:limit].rsplit(" ", 1)[0]
    return f"{trimmed}…"


def _sentences(text: str) -> list[str]:
    parts = re.split(r"(?<=[.!?])\s+", " ".join((text or "").split()))
    return [part.strip() for part in parts if len(part.strip()) >= 24]


def _unique_sentences(text: str, limit: int = 5) -> list[str]:
    points: list[str] = []
    seen: set[str] = set()
    for part in _sentences(text):
        key = part.lower()
        if key in seen:
            continue
        seen.add(key)
        points.append(part)
        if len(points) >= limit:
            break
    return points


def _local_fallback_answer(chunks: list[RetrievedChunk]) -> str:
    """Deterministic answer from retrieved memory only. Does not invent facts."""
    if not chunks:
        return "I couldn't find relevant saved memory for that question."

    by_memory: dict[UUID, list[RetrievedChunk]] = {}
    memory_order: list[UUID] = []
    for chunk in chunks:
        if chunk.memory_id not in by_memory:
            if len(memory_order) >= 4:
                continue
            by_memory[chunk.memory_id] = []
            memory_order.append(chunk.memory_id)
        by_memory[chunk.memory_id].append(chunk)

    if len(memory_order) == 1:
        primary = by_memory[memory_order[0]][0]
        title = (primary.title or "Untitled memory").strip()
        cleaned = "\n\n".join(
            strip_instruction_like_lines(part.content)
            for part in by_memory[memory_order[0]]
        )
        points = _unique_sentences(cleaned, limit=5)
        if len(points) <= 1:
            body = _excerpt(cleaned)
            return f"Your saved memory '{title}' discusses {body}."
        bullets = "\n".join(f"- {point}" for point in points)
        return f"{title} covers the following from your saved memory:\n\n{bullets}"

    parts: list[str] = []
    for memory_id in memory_order:
        chunk_parts = by_memory[memory_id]
        primary = chunk_parts[0]
        title = (primary.title or "Untitled memory").strip()
        cleaned = "\n\n".join(
            strip_instruction_like_lines(part.content) for part in chunk_parts
        )
        points = _unique_sentences(cleaned, limit=3)
        if not points:
            continue
        if len(points) == 1:
            parts.append(f"- {title}: {points[0]}")
        else:
            nested = "; ".join(points[:3])
            parts.append(f"- {title}: {nested}")
    if not parts:
        first_chunks = by_memory[memory_order[0]]
        merged = "\n\n".join(
            strip_instruction_like_lines(part.content) for part in first_chunks
        )
        return _excerpt(merged)
    return "From your saved memories:\n\n" + "\n".join(parts)


def _matching_sentence(chunks: list[RetrievedChunk], topic: str) -> str | None:
    """First sentence that contains the topic words, for 'which sources mention X'."""
    words = [word for word in re.findall(r"[a-z0-9]+", topic.lower()) if len(word) >= 3]
    if not words:
        return None
    for chunk in chunks:
        for sentence in _sentences(strip_instruction_like_lines(chunk.content)):
            lower = sentence.lower()
            if all(word in lower for word in words):
                return (
                    sentence
                    if len(sentence) <= 220
                    else sentence[:219].rsplit(" ", 1)[0] + "…"
                )
    return None


_KIND_LABELS = {
    SourceType.webpage: "Web page",
    SourceType.pdf: "PDF",
    SourceType.youtube: "Video",
}


def _format_listing(
    items: list[MemoryItem], label: str, tz: tzinfo
) -> tuple[str, list[AskCitation]]:
    """Deterministic list of captures in a date window, each cited."""
    citations: list[AskCitation] = []
    lines: list[str] = []
    for index, item in enumerate(items, start=1):
        when = item.captured_at.astimezone(tz).strftime("%a %d %b, %H:%M")
        status = ""
        if item.status == ItemStatus.failed:
            status = " (not indexed: processing failed)"
        elif item.status != ItemStatus.ready:
            status = " (still being indexed)"
        domain = f" · {item.domain}" if item.domain else ""
        kind = _KIND_LABELS.get(item.source_type, "Capture")
        lines.append(f"- **{item.title}**: {kind}{domain} · {when}{status} [S{index}]")
        citations.append(
            AskCitation(
                memory_id=item.id,
                chunk_id=None,
                title=item.title,
                url=item.url,
                source_type=item.source_type,
                domain=item.domain,
                source_available=_source_available(item.url),
                captured_at=item.captured_at,
                excerpt=_excerpt(item.summary or item.content or "", limit=220) or None,
            )
        )
    noun = "memory" if len(items) == 1 else "memories"
    more = (
        f" Showing the latest {LISTING_LIMIT}." if len(items) >= LISTING_LIMIT else ""
    )
    return f"You captured {len(items)} {noun} {label}.{more}\n\n" + "\n".join(
        lines
    ), citations


class RagService:
    def __init__(self, retrieval: RetrievalService) -> None:
        self.retrieval = retrieval
        self.settings = get_settings()

    def _llm_configured(self) -> bool:
        return bool(build_backends(self.settings))

    # -- public API ---------------------------------------------------------

    def ask(
        self,
        user_id: UUID,
        question: str,
        source_type: SourceType | None = None,
        top_k: int | None = None,
        memory_id: UUID | None = None,
        history: Sequence[AskTurn] = (),
        tz: str | None = None,
    ) -> AskResponse:
        """Non-streaming answer in the ``POST /chat`` shape."""
        prepared = self.prepare(
            user_id, question, source_type, top_k, memory_id, history, tz
        )
        final: dict[str, Any] = {}
        for event in self.run(prepared, stream=False):
            if event.name == "final":
                final = event.data
            elif event.name == "error":
                raise LLMProviderError(
                    str(event.data.get("message")), event.data.get("status")
                )
        return self.to_response(prepared, final)

    def prepare(
        self,
        user_id: UUID,
        question: str,
        source_type: SourceType | None = None,
        top_k: int | None = None,
        memory_id: UUID | None = None,
        history: Sequence[AskTurn] = (),
        tz: str | None = None,
    ) -> PreparedAnswer:
        """Intent, query rewrite and retrieval. The only step that uses the database."""
        zone = resolve_timezone(tz)
        intent = classify(question, zone)
        if memory_id or source_type:
            intent = scoped_intent(intent, question)
        base = PreparedAnswer(question=question, history=tuple(history), sources=[])

        if intent.listing and intent.date_window and memory_id is None:
            return self._list_captures(user_id, base, intent, source_type, zone)

        effective_top_k = top_k
        if needs_document_context(question):
            configured = int(getattr(self.settings, "rag_top_k", 8) or 8)
            effective_top_k = max(top_k or configured, min(8, configured))

        llm = self._llm_configured()
        query = intent.mention_topic or rewrite_query(
            question, history, self._complete_raw if llm else None
        )
        # Date filters only apply to questions about the user's own saves.
        window = intent.date_window if intent.kind != "open" else None
        chunks = self.retrieval.retrieve_relevant_memories(
            user_id=user_id,
            query=query,
            top_k=effective_top_k,
            source_type=source_type or intent.source_type,
            memory_id=memory_id,
            **({"date_from": window.start, "date_to": window.end} if window else {}),
        )

        if intent.mention_topic:
            return self._mention_answer(base, intent.mention_topic, chunks)

        base.personal = intent.kind == "personal"
        base.combined = intent.kind == "combined"
        if base.personal and not chunks:
            return self._fixed(base, INSUFFICIENT_ANSWER, insufficient=True)
        if not llm:
            if chunks:
                return self._fallback(base, chunks)
            return self._fixed(
                base, NO_MODEL_FOR_GENERAL, mode="general", insufficient=True
            )

        base.chunks = list(chunks)
        base.sources = [_citation(chunk) for chunk in chunks]
        return base

    def run(
        self, prepared: PreparedAnswer, *, stream: bool = True
    ) -> Iterator[AskEvent]:
        """Answer events: ``sources``, then ``delta``s, then ``final`` (or ``error``).

        Uses no database access, so it can run while a response is streaming.
        """
        yield _event_sources(prepared.sources)
        if prepared.fixed_answer is not None:
            yield AskEvent("delta", {"text": prepared.fixed_answer})
            used = (
                prepared.fixed_used
                if prepared.fixed_used is not None
                else cited_sources(prepared.fixed_answer, len(prepared.sources))
            )
            yield self._final(
                prepared,
                prepared.fixed_answer,
                AnswerMeta(
                    mode=prepared.fixed_mode,
                    usedSources=used,
                    followUps=prepared.followups,
                ),
            )
            return

        text = ""
        try:
            if stream:
                for piece in self._stream_answer(prepared):
                    text += piece
                    yield AskEvent("delta", {"text": piece})
            else:
                text = self._generate(
                    prepared.question,
                    prepared.chunks,
                    self._system_prompt(prepared),
                    prepared.history,
                )
                yield AskEvent("delta", {"text": text})
        except LLMProviderError as exc:
            if text:
                # Part of the answer is already on screen; say it stopped.
                yield AskEvent(
                    "error",
                    {
                        "code": "ASK_STREAM_INTERRUPTED",
                        "message": "The answer was cut off.",
                        "status": exc.status,
                    },
                )
                return
            fallback = self._fallback_after_error(prepared)
            if fallback is None:
                raise
            yield AskEvent("delta", {"text": fallback.fixed_answer or ""})
            yield self._final(
                fallback,
                fallback.fixed_answer or "",
                AnswerMeta(
                    mode="memory", usedSources=fallback.fixed_used or [], followUps=[]
                ),
            )
            return

        count = len(prepared.chunks)
        answer = strip_unknown_markers(normalize_markers(text), count)
        meta = reconcile(
            self._answer_meta(prepared, answer), answer, count, prepared.question
        )
        yield self._final(prepared, answer, meta)

    def to_response(
        self, prepared: PreparedAnswer, final: dict[str, Any]
    ) -> AskResponse:
        """``POST /chat`` shape: ``[S#]`` becomes ``[k]`` and citations follow first use."""
        answer = str(final.get("answer", ""))
        used = list(final.get("usedSources") or [])
        text, order = _to_legacy_markers(answer, used)
        citations = [
            prepared.sources[i - 1] for i in order if 1 <= i <= len(prepared.sources)
        ]
        mode: MetaMode = final.get("mode", "memory")
        return AskResponse(
            answer=text,
            citations=citations,
            insufficient_context=bool(final.get("insufficient_context")),
            used_fallback=bool(final.get("used_fallback")),
            mode=_LEGACY_MODES.get(mode, "memory"),
            suggested_followups=list(final.get("followUps") or []),
        )

    # -- fixed answers --------------------------------------------------------

    @staticmethod
    def _fixed(
        base: PreparedAnswer,
        text: str,
        *,
        mode: MetaMode = "memory",
        insufficient: bool = False,
        sources: list[AskCitation] | None = None,
    ) -> PreparedAnswer:
        base.fixed_answer = text
        base.fixed_mode = mode
        base.insufficient = insufficient
        base.sources = sources or []
        base.chunks = []
        base.followups = [INSUFFICIENT_FOLLOWUP] if insufficient else []
        return base

    def _fallback(
        self, base: PreparedAnswer, chunks: Sequence[RetrievedChunk]
    ) -> PreparedAnswer:
        """Extractive answer from retrieved memory, for when no model can answer."""
        base.fixed_answer = _local_fallback_answer(list(chunks))
        base.fixed_mode = "memory"
        base.used_fallback = True
        base.sources = [_citation(chunk) for chunk in chunks]
        base.fixed_used = _first_per_memory(chunks)
        base.chunks = []
        return base

    def _fallback_after_error(self, prepared: PreparedAnswer) -> PreparedAnswer | None:
        """After a provider failure: answer from memory that clearly covers the question.

        Personal questions use any retrieved memory. Other questions need memory
        that covers most of their keywords; one shared word or a loose vector
        neighbour is not an answer to a general question.
        """
        chunks = prepared.chunks
        if not prepared.personal:
            chunks = [
                chunk
                for chunk in chunks
                if keyword_coverage(prepared.question, chunk.title, chunk.content)
                >= 2 / 3
            ]
        if not chunks:
            return None
        fallback = PreparedAnswer(
            question=prepared.question,
            history=prepared.history,
            sources=[],
            personal=prepared.personal,
        )
        return self._fallback(fallback, chunks)

    def _mention_answer(
        self, base: PreparedAnswer, topic: str, chunks: list[RetrievedChunk]
    ) -> PreparedAnswer:
        """'Which sources mention X': list the matching saves, never generate."""
        matching = self._clear_matches(chunks)
        clean_topic = sanitize_untrusted_text(topic)[:80]
        if not any(len(word) >= 3 for word in re.findall(r"[A-Za-z0-9]+", topic)):
            # Keyword search ignores words under 3 characters, so "none mention
            # AI" would be a claim we cannot back up.
            return self._fixed(
                base,
                f"“{clean_topic}” is too short for me to search reliably. "
                "Try a longer phrase, such as the full term.",
                insufficient=True,
            )
        if not matching:
            return self._fixed(
                base,
                f"None of your saved sources mention {clean_topic}.",
                insufficient=True,
            )
        citations = [
            citation.model_copy(
                update={"excerpt": _matching_sentence(group, topic) or citation.excerpt}
            )
            for citation, group in zip(
                _citations_from_chunks(matching),
                _group_by_memory(matching),
                strict=True,
            )
        ]
        lines = [
            f"- **{citation.title}**"
            + (f": {citation.excerpt}" if citation.excerpt else "")
            + f" [{prompts.source_id(index)}]"
            for index, citation in enumerate(citations, start=1)
        ]
        noun = "source mentions" if len(citations) == 1 else "sources mention"
        answer = f"{len(citations)} saved {noun} {clean_topic}:\n\n" + "\n".join(lines)
        return self._fixed(base, answer, sources=citations)

    def _list_captures(
        self,
        user_id: UUID,
        base: PreparedAnswer,
        intent: AskIntent,
        source_type: SourceType | None,
        zone: tzinfo,
    ) -> PreparedAnswer:
        window = intent.date_window
        assert window is not None
        repo = MemoryRepository(self.retrieval.db)
        items, _total = repo.list_for_user(
            user_id,
            page=1,
            per_page=LISTING_LIMIT,
            filters=MemoryFilters(
                source_type=source_type or intent.source_type,
                date_from=window.start,
                date_to=window.end,
            ),
        )
        if not items:
            latest = repo.latest_captured_at(user_id)
            note = (
                f" Your most recent capture was on {latest.astimezone(zone).strftime('%A %d %B')}."
                if latest
                else " You haven't saved any memories yet."
            )
            return self._fixed(
                base,
                f"You didn't capture anything {window.label}.{note}",
                insufficient=True,
            )
        answer, citations = _format_listing(items, window.label, zone)
        return self._fixed(base, answer, sources=citations)

    def _clear_matches(self, chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        """Keyword hits and strong semantic hits only."""
        strong = float(getattr(self.settings, "rag_strong_distance", 0.4))
        return [
            chunk
            for chunk in chunks
            if chunk.rank > 0
            or (chunk.distance is not None and chunk.distance <= strong)
        ]

    def _final(
        self, prepared: PreparedAnswer, answer: str, meta: AnswerMeta
    ) -> AskEvent:
        insufficient = prepared.insufficient or (
            prepared.personal and not meta.usedSources
        )
        return AskEvent(
            "final",
            {
                "answer": answer,
                "mode": meta.mode,
                "usedSources": meta.usedSources,
                "followUps": meta.followUps,
                "insufficient_context": insufficient,
                "used_fallback": prepared.used_fallback,
            },
        )

    # -- LLM --------------------------------------------------------------

    def _system_prompt(self, prepared: PreparedAnswer) -> str:
        return prompts.ANSWER_SYSTEM_PROMPT + (
            COMBINED_HINT if prepared.combined else ""
        )

    def _generate(
        self,
        question: str,
        chunks: list[RetrievedChunk],
        system_prompt: str,
        history: Sequence[AskTurn],
    ) -> str:
        try:
            answer = self._complete(
                question, chunks, system_prompt=system_prompt, history=history
            )
        except LLMProviderError:
            raise
        except Exception as exc:
            logger.exception("LLM completion failed for configured provider")
            raise LLMProviderError(
                str(exc) or type(exc).__name__, status=_status_of(exc)
            ) from exc
        cleaned = (answer or "").strip()
        if not cleaned:
            raise LLMProviderError("The language model returned an empty response.")
        return cleaned

    def _complete(
        self,
        question: str,
        chunks: list[RetrievedChunk],
        *,
        system_prompt: str = SYSTEM_PROMPT,
        history: Sequence[AskTurn] = (),
    ) -> str:
        prompt = prompts.answer_prompt(
            question, chunks, history, int(self.settings.rag_max_context_chars)
        )
        return self._complete_raw(prompt, system_prompt)

    def _cooldown(self) -> int:
        return int(
            getattr(self.settings, "llm_key_cooldown_seconds", DEFAULT_COOLDOWN_SECONDS)
            or DEFAULT_COOLDOWN_SECONDS
        )

    def _mark_failed(self, backend: LLMBackend, exc: Exception) -> None:
        status = _status_of(exc)
        timed_out = "timeout" in type(exc).__name__.lower()
        cooled = key_pool.mark_failed(
            backend, status, timed_out=timed_out, cooldown_seconds=self._cooldown()
        )
        logger.warning(
            "Chat backend %s failed (status=%s, cooled=%s); trying the next key",
            backend.name,
            status,
            cooled,
        )

    def _complete_raw(self, prompt: str, system_prompt: str) -> str:
        """Send one prompt through the rotating key pool; raises when every key fails."""
        backends = build_backends(self.settings)
        if not backends:
            raise LLMProviderError("No chat model key is configured.")
        last_error: Exception | None = None
        # Rotate across keys; a key that fails is skipped for a while and the
        # next one answers. Only when every key fails does the error surface.
        for backend in key_pool.order(backends):
            try:
                answer = self._call_backend(backend, prompt, system_prompt)
            except Exception as exc:
                self._mark_failed(backend, exc)
                last_error = exc
                continue
            key_pool.mark_ok(backend)
            return answer
        assert last_error is not None
        raise last_error

    def _stream_answer(self, prepared: PreparedAnswer) -> Iterator[str]:
        """Stream answer text, failing over to the next key only before the first token."""
        backends = build_backends(self.settings)
        if not backends:
            raise LLMProviderError("No chat model key is configured.")
        prompt = prompts.answer_prompt(
            prepared.question,
            prepared.chunks,
            prepared.history,
            int(self.settings.rag_max_context_chars),
        )
        system_prompt = self._system_prompt(prepared)
        last_error: Exception | None = None
        for backend in key_pool.order(backends):
            started = False
            try:
                for piece in self._stream_backend(backend, prompt, system_prompt):
                    if piece:
                        started = True
                        yield piece
            except Exception as exc:
                if started:
                    logger.exception("Answer stream broke after the first token")
                    raise LLMProviderError(
                        str(exc) or type(exc).__name__, _status_of(exc)
                    ) from exc
                self._mark_failed(backend, exc)
                last_error = exc
                continue
            if not started:
                last_error = LLMProviderError(
                    "The language model returned an empty response."
                )
                continue
            key_pool.mark_ok(backend)
            return
        status = _status_of(last_error) if isinstance(last_error, Exception) else None
        if isinstance(last_error, LLMProviderError):
            status = last_error.status
        raise LLMProviderError(
            str(last_error) or "Every chat backend failed.", status=status
        )

    def _answer_meta(self, prepared: PreparedAnswer, answer: str) -> AnswerMeta | None:
        """Structured {mode, usedSources, followUps}; None on any failure (callers degrade)."""
        backends = [
            b
            for b in key_pool.order(build_backends(self.settings), rotate=False)
            if b.provider != "gemini"
        ][:2]
        prompt = prompts.meta_prompt(prepared.question, answer, prepared.chunks)
        for backend in backends:
            try:
                raw = self._call_structured(backend, prompt, prompts.META_SYSTEM_PROMPT)
            except Exception as exc:
                logger.warning(
                    "answer metadata call failed backend=%s status=%s",
                    backend.name,
                    _status_of(exc),
                )
                if _status_of(exc) in LLMProviderError.UNAVAILABLE_STATUSES:
                    self._mark_failed(backend, exc)
                continue
            meta = parse_meta(raw)
            if meta is not None:
                return meta
            logger.warning("answer metadata failed validation backend=%s", backend.name)
        return None

    def _call_backend(
        self, backend: LLMBackend, prompt: str, system_prompt: str
    ) -> str:
        if backend.provider == "gemini":
            return self._complete_gemini(prompt, system_prompt, backend)
        if backend.provider == "openrouter":
            return self._complete_openrouter(prompt, system_prompt, backend)
        return self._complete_openai(prompt, system_prompt, backend)

    def _stream_backend(
        self, backend: LLMBackend, prompt: str, system_prompt: str
    ) -> Iterator[str]:
        if backend.provider == "gemini":
            # One piece: the answer still reaches the client through the same events.
            yield self._complete_gemini(prompt, system_prompt, backend)
            return
        client, extra = self._openai_client(backend, CHAT_TIMEOUT_SECONDS)
        stream = client.chat.completions.create(
            model=backend.model,
            temperature=0.2,
            max_tokens=self._max_output_tokens(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            extra_headers=extra.headers,
            extra_body=extra.body,
        )
        for chunk in stream:
            choices = getattr(chunk, "choices", None) or []
            delta = getattr(choices[0], "delta", None) if choices else None
            text = getattr(delta, "content", None)
            if text:
                yield text

    def _call_structured(
        self, backend: LLMBackend, prompt: str, system_prompt: str
    ) -> str:
        client, extra = self._openai_client(
            backend, META_TIMEOUT_SECONDS, structured=True
        )
        completion = client.chat.completions.create(
            model=backend.model,
            temperature=0,
            max_tokens=300,
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            response_format=cast(ResponseFormatJSONSchema, RESPONSE_FORMAT),
            extra_headers=extra.headers,
            extra_body=extra.body,
        )
        return completion.choices[0].message.content or ""

    def _openai_client(
        self, backend: LLMBackend, timeout: float, *, structured: bool = False
    ) -> tuple[OpenAI, _Extra]:
        """Client and extra request arguments for an OpenAI-compatible backend."""
        if backend.provider != "openrouter":
            return OpenAI(
                api_key=backend.api_key, timeout=timeout, max_retries=0
            ), _Extra()
        body: dict[str, Any] = {}
        fallbacks = [
            m for m in openrouter_fallback_models(self.settings) if m != backend.model
        ]
        if fallbacks:
            # OpenRouter tries these in order when the primary model is unavailable.
            body["models"] = [backend.model, *fallbacks]
        if structured:
            # Only route to providers that actually enforce response_format.
            body["provider"] = {"require_parameters": True}
        extra = _Extra(headers=OPENROUTER_HEADERS, body=body or None)
        client = OpenAI(
            api_key=backend.api_key,
            base_url="https://openrouter.ai/api/v1",
            timeout=timeout,
            max_retries=0,  # the key pool fails over instead of the SDK retrying
        )
        return client, extra

    def _max_output_tokens(self) -> int:
        return int(getattr(self.settings, "rag_max_output_tokens", 900) or 900)

    def _complete_openai(
        self, prompt: str, system_prompt: str, backend: LLMBackend
    ) -> str:
        client, extra = self._openai_client(backend, CHAT_TIMEOUT_SECONDS)
        completion = client.chat.completions.create(
            model=backend.model,
            temperature=0.2,
            max_tokens=self._max_output_tokens(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            extra_headers=extra.headers,
            extra_body=extra.body,
        )
        return completion.choices[0].message.content or ""

    def _complete_openrouter(
        self, prompt: str, system_prompt: str, backend: LLMBackend
    ) -> str:
        return self._complete_openai(prompt, system_prompt, backend)

    def _complete_gemini(
        self, prompt: str, system_prompt: str, backend: LLMBackend
    ) -> str:
        from google import genai
        from google.genai import types

        client = genai.Client(
            api_key=backend.api_key,
            http_options=types.HttpOptions(timeout=CHAT_TIMEOUT_SECONDS * 1000),  # ms
        )

        def generate(thinking: types.ThinkingConfig | None) -> object:
            return client.models.generate_content(
                model=backend.model,
                contents=prompt,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.2,
                    max_output_tokens=self._max_output_tokens(),
                    thinking_config=thinking,
                ),
            )

        # Thinking tokens count against max_output_tokens on Gemini 2.5+/3.x and
        # cut answers off before the cited memory part; grounded answers don't
        # need them, and skipping them roughly halves latency.
        try:
            response = generate(types.ThinkingConfig(thinking_budget=0))
        except Exception as exc:
            # Some models (e.g. 2.5 Pro) refuse to switch thinking off; any other
            # 400 (a bad key, a bad request) would only fail again.
            if getattr(exc, "code", None) != 400 or "thinking" not in str(exc).lower():
                raise
            response = generate(None)
        return _gemini_response_text(response)


def _gemini_response_text(response: object) -> str:
    try:
        text = getattr(response, "text", None)
        if isinstance(text, str) and text.strip():
            return text.strip()
    except Exception as exc:
        logger.warning("Gemini response.text is unusable: %s", exc)

    candidates = getattr(response, "candidates", None) or []
    parts: list[str] = []
    for candidate in candidates:
        content = getattr(candidate, "content", None)
        for part in getattr(content, "parts", None) or []:
            value = getattr(part, "text", None)
            if isinstance(value, str) and value.strip():
                parts.append(value.strip())
    if parts:
        return "\n".join(parts)

    raise LLMProviderError(
        "Gemini returned no usable text (blocked, empty, or malformed)."
    )
