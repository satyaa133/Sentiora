"""RAG service: retrieves memory for a question and answers it (REBUILD_PLAN S6).

Pipeline:
  prepare  answer cache -> intent + scope -> heuristic follow-up rewrite ->
           hybrid retrieval (vector, full-text, question bank, reranked).
           Listing, "which sources mention" and not-found answers are fixed
           text. In ``instant`` mode (the default) the answer is quoted from the
           retrieved sentences here, with no model call. In ``ai`` mode an AI
           slot is taken (``AI_BUSY`` when none is free). All database work is
           here.
  run      ``instant``: the prepared answer. ``ai``: numbered sources
           [S1..Sn] -> one model call (streamed or not) returning the answer and
           a metadata trailer (mode, follow-ups) -> citation check. Finished
           answers go to the answer cache.
Without a reachable model, ``ai`` requests get the instant answer instead.
"""

from __future__ import annotations

import logging
import re
import time
from collections.abc import Iterator, Sequence
from dataclasses import dataclass, field
from datetime import tzinfo
from typing import Any
from uuid import UUID

from openai import OpenAI
from sqlalchemy import select

from app.core.config import get_settings
from app.core.metrics import ASK_STAGE_SECONDS, observe_stage
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.models.memory_question import MemoryQuestion
from app.repositories.memory_repository import MemoryFilters, MemoryRepository
from app.schemas.ask import AnswerMode, AskCitation, AskResponse, AskTurn, ChatMode
from app.services.ai_gate import AIBusyError, AISlot, ai_gate
from app.services.answer.extractive import (
    extract_answer,
    is_overview_question,
    overview_answer,
)
from app.services.answer_cache import (
    CacheKey,
    answer_cache,
    cache_key,
    library_version,
    normalize_question,
)
from app.services.ask_intent import (
    AskIntent,
    classify,
    resolve_timezone,
    scoped_intent,
)
from app.services.enrichment_service import EnrichmentService
from app.services.llm import prompts
from app.services.llm.clients import Extra, openai_compatible_client
from app.services.llm.structured import (
    AnswerMeta,
    MetaMode,
    TrailerSplitter,
    cited_sources,
    normalize_markers,
    parse_trailer,
    reconcile,
    split_trailer,
    strip_unknown_markers,
)
from app.services.llm_pool import (
    DEFAULT_COOLDOWN_SECONDS,
    DEFAULT_MAX_COOLDOWN_SECONDS,
    LLMBackend,
    build_backends,
    key_pool,
    max_attempts,
    retry_after_seconds,
)
from app.services.rag_sanitize import (
    sanitize_untrusted_text,
    strip_instruction_like_lines,
)
from app.services.retrieval.query_rewriter import rewrite_query
from app.services.retrieval_service import (
    RetrievalService,
    RetrievedChunk,
    has_keywords,
    keyword_coverage,
    needs_document_context,
)
from app.services.usage import (
    UsageReport,
    record_usage,
    report_from_gemini,
    report_from_openai,
)

logger = logging.getLogger(__name__)

__all__ = ["AIBusyError", "LLMNotConfiguredError", "LLMProviderError", "RagService"]

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
# Follow-up suggestions taken from the matched saves' stored questions.
FOLLOWUP_LIMIT = 3
# A stored question this close to the asked one (cosine distance) is the same.
_SAME_QUESTION_DISTANCE = 0.08
# Kept for callers that import it; the unified prompt replaced the per-mode ones.
SYSTEM_PROMPT = prompts.ANSWER_SYSTEM_PROMPT
COMBINED_HINT = (
    "\n\nThe user is also asking about their saved material: say what the sources "
    "contain about it, or plainly that nothing relevant is saved."
)
_LEGACY_MODES: dict[str, AnswerMode] = {
    "memory": "memory",
    "general": "general",
    "mixed": "combined",
    # POST /chat keeps its shape: an instant answer is a memory answer.
    "instant": "memory",
}


class LLMNotConfiguredError(RuntimeError):
    """Raised when the LLM API key is not set and no retrieved memory is available."""


# Defaults when settings lack the values (tests pass partial settings objects).
DEFAULT_CHAT_TIMEOUT_SECONDS = 10.0
DEFAULT_EXTRACT_MIN_SCORE = 0.0
# A key is not tried with less time than this left in the answer's budget.
MIN_ATTEMPT_SECONDS = 1.0
# Gemini rejects a deadline under 10 s (400 INVALID_ARGUMENT); its SDK sends the
# timeout as that deadline, so a Gemini attempt always gets at least this much.
GEMINI_MIN_DEADLINE_SECONDS = 10.0


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
    answer_mode: ChatMode = "instant"
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
    # "Explain with AI" can improve on this answer (final.aiAvailable).
    ai_available: bool = False
    # Held AI slot (ai mode with a model call); released when run() ends.
    slot: AISlot | None = None
    # Answer cache entry: where to store the result, or the cached result.
    cache: CacheKey | None = None
    cached: dict[str, Any] | None = None

    def release(self) -> None:
        if self.slot is not None:
            self.slot.release()
            self.slot = None


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


_Extra = Extra


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
    # Time limit for the key being tried now (see _attempts).
    _attempt_timeout: float = DEFAULT_CHAT_TIMEOUT_SECONDS
    # Usage of the latest provider call, set by the call methods (llm_usage).
    _last_usage: UsageReport | None = None
    # llm_usage attribution: the user asking, and what the next call is for.
    _usage_user_id: UUID | None = None
    _usage_purpose: str = "answer"

    def __init__(self, retrieval: RetrievalService) -> None:
        self.retrieval = retrieval
        self.settings = get_settings()
        self._attempt_timeout = self._chat_timeout()

    def _chat_timeout(self) -> float:
        value = getattr(self.settings, "llm_chat_timeout_seconds", None)
        return float(value) if value else DEFAULT_CHAT_TIMEOUT_SECONDS

    def _attempts(self, backends: list[LLMBackend]) -> Iterator[LLMBackend]:
        """Backends to try within one budget of ``llm_chat_timeout_seconds``.

        Each attempt gets the time that is left, so a hung provider costs the
        budget once instead of once per key. A key that fails fast (bad key,
        connection refused) leaves time for the next one.
        """
        deadline = time.monotonic() + self._chat_timeout()
        for index, backend in enumerate(
            key_pool.order(backends)[: max_attempts(self.settings)]
        ):
            remaining = deadline - time.monotonic()
            if index > 0 and remaining < MIN_ATTEMPT_SECONDS:
                logger.warning(
                    "Answer time budget used up; not trying backend %s", backend.name
                )
                return
            self._attempt_timeout = max(remaining, MIN_ATTEMPT_SECONDS)
            yield backend

    def _llm_configured(self) -> bool:
        return bool(build_backends(self.settings))

    def _default_mode(self) -> ChatMode:
        mode = getattr(self.settings, "ask_default_mode", "instant")
        return "ai" if mode == "ai" else "instant"

    def _extract_min_score(self) -> float:
        value = getattr(self.settings, "rag_extract_min_score", None)
        return DEFAULT_EXTRACT_MIN_SCORE if value is None else float(value)

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
        answer_mode: ChatMode | None = None,
    ) -> AskResponse:
        """Non-streaming answer in the ``POST /chat`` shape."""
        prepared = self.prepare(
            user_id, question, source_type, top_k, memory_id, history, tz, answer_mode
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
        answer_mode: ChatMode | None = None,
    ) -> PreparedAnswer:
        """Cache, intent, retrieval and (instant mode) the answer. The only DB step.

        In ``ai`` mode a model answer takes an AI slot here and raises
        ``AIBusyError`` when none is free; ``run`` gives the slot back.
        """
        self._usage_user_id = user_id
        mode: ChatMode = answer_mode or self._default_mode()
        zone = resolve_timezone(tz)
        base = PreparedAnswer(
            question=question, history=tuple(history), sources=[], answer_mode=mode
        )
        base.cache = self._cache_key(
            user_id, question, source_type, memory_id, top_k, history, zone
        )
        if base.cache is not None:
            base.cached = answer_cache.get_answer(base.cache, mode)
            if base.cached is not None:
                return base

        intent = classify(question, zone)
        if memory_id or source_type:
            intent = scoped_intent(intent, question)

        if intent.listing and intent.date_window and memory_id is None:
            return self._list_captures(user_id, base, intent, source_type, zone)

        effective_top_k = top_k
        if needs_document_context(question):
            configured = int(getattr(self.settings, "rag_top_k", 8) or 8)
            effective_top_k = max(top_k or configured, min(8, configured))

        llm = self._llm_configured()
        # Follow-ups are resolved without a model call; in ai mode the answer
        # call itself reads the conversation (one call per answer).
        query = intent.mention_topic or rewrite_query(question, history, None)
        chunks = (
            answer_cache.get_sources(base.cache)
            if mode == "ai" and base.cache is not None and not intent.mention_topic
            else None
        )
        if chunks is None:
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
            if base.cache is not None and not intent.mention_topic:
                answer_cache.set_sources(base.cache, chunks)

        self._request_enrichment(user_id, chunks)
        if intent.mention_topic:
            return self._mention_answer(base, intent.mention_topic, chunks)

        base.personal = intent.kind == "personal"
        base.combined = intent.kind == "combined"
        if base.personal and not chunks:
            return self._fixed(base, INSUFFICIENT_ANSWER, insufficient=True)
        base.followups = self._stored_followups(user_id, chunks, question)

        if mode == "instant":
            return self._instant(base, chunks, memory_id, llm)
        if not llm:
            if chunks:
                return self._fallback(base, chunks, memory_id)
            return self._fixed(
                base, NO_MODEL_FOR_GENERAL, mode="general", insufficient=True
            )

        base.chunks = list(chunks)
        base.sources = [_citation(chunk) for chunk in chunks]
        base.slot = ai_gate.acquire()
        return base

    def _cache_key(
        self,
        user_id: UUID,
        question: str,
        source_type: SourceType | None,
        memory_id: UUID | None,
        top_k: int | None,
        history: Sequence[AskTurn],
        zone: tzinfo,
    ) -> CacheKey | None:
        db = getattr(self.retrieval, "db", None)
        if db is None or not int(getattr(self.settings, "answer_cache_ttl_seconds", 0)):
            return None
        try:
            version = library_version(db, user_id)
        except Exception:
            logger.warning("Library version lookup failed; not caching", exc_info=True)
            db.rollback()
            return None
        return cache_key(
            user_id=user_id,
            question=question,
            source_type=source_type,
            memory_id=memory_id,
            top_k=top_k,
            history=history,
            zone=zone,
            version=version,
        )

    def _request_enrichment(self, user_id: UUID, chunks: Sequence[RetrievedChunk]) -> None:
        """Saves that answer a question matter: enrich them in the background (S5)."""
        db = getattr(self.retrieval, "db", None)
        if db is None or not chunks:
            return
        EnrichmentService(db).request_for_memories(
            user_id, [chunk.memory_id for chunk in chunks]
        )

    def _stored_followups(
        self, user_id: UUID, chunks: Sequence[RetrievedChunk], question: str
    ) -> list[str]:
        """Questions the matched saves answer (from enrichment), nearest first.

        No model call: they were written when the saves were enriched. Without
        the query vector they come in source order.
        """
        db = getattr(self.retrieval, "db", None)
        memory_ids = list(dict.fromkeys(chunk.memory_id for chunk in chunks))
        if db is None or not memory_ids:
            return []
        vector = getattr(self.retrieval, "_query_vector", None)
        stmt = select(MemoryQuestion.question, MemoryQuestion.memory_id).where(
            MemoryQuestion.user_id == user_id,
            MemoryQuestion.memory_id.in_(memory_ids),
        )
        if vector is not None:
            distance = MemoryQuestion.embedding_local.cosine_distance(vector)
            stmt = stmt.add_columns(distance.label("distance")).order_by(
                distance.asc().nulls_last()
            )
        else:
            stmt = stmt.order_by(MemoryQuestion.created_at.asc())
        try:
            rows = db.execute(stmt.limit(FOLLOWUP_LIMIT * 4)).all()
        except Exception:
            logger.warning("Stored follow-up lookup failed", exc_info=True)
            db.rollback()
            return []
        if vector is None:
            rank = {memory_id: i for i, memory_id in enumerate(memory_ids)}
            rows = sorted(rows, key=lambda row: rank.get(row[1], len(rank)))
        asked = normalize_question(question)
        picked: list[str] = []
        for row in rows:
            text = " ".join(str(row[0]).split())
            distance = row[2] if len(row) > 2 else None
            if (
                not text
                or normalize_question(text) == asked
                or (distance is not None and float(distance) < _SAME_QUESTION_DISTANCE)
                or normalize_question(text) in {normalize_question(p) for p in picked}
            ):
                continue
            picked.append(text if text.endswith("?") else f"{text}?")
            if len(picked) >= FOLLOWUP_LIMIT:
                break
        return picked

    def run(
        self, prepared: PreparedAnswer, *, stream: bool = True
    ) -> Iterator[AskEvent]:
        """Answer events: ``sources``, then ``delta``s, then ``final`` (or ``error``).

        Uses no database access, so it can run while a response is streaming.
        """
        try:
            yield from self._run(prepared, stream=stream)
        finally:
            prepared.release()

    def _run(self, prepared: PreparedAnswer, *, stream: bool) -> Iterator[AskEvent]:
        if prepared.cached is not None:
            yield AskEvent("sources", {"sources": prepared.cached.get("sources", [])})
            final = dict(prepared.cached.get("final") or {})
            yield AskEvent("delta", {"text": str(final.get("answer", ""))})
            yield AskEvent("final", final)
            return

        sources_event = _event_sources(prepared.sources)
        yield sources_event
        if prepared.fixed_answer is not None:
            yield AskEvent("delta", {"text": prepared.fixed_answer})
            used = (
                prepared.fixed_used
                if prepared.fixed_used is not None
                else cited_sources(prepared.fixed_answer, len(prepared.sources))
            )
            final_event = self._final(
                prepared,
                prepared.fixed_answer,
                AnswerMeta(
                    mode=prepared.fixed_mode,
                    usedSources=used,
                    followUps=prepared.followups,
                ),
            )
            self._store(prepared, sources_event, final_event)
            yield final_event
            return

        text = ""
        trailer: str | None = None
        try:
            if stream:
                splitter = TrailerSplitter()
                for piece in self._stream_answer(prepared):
                    visible = splitter.feed(piece)
                    if visible:
                        text += visible
                        yield AskEvent("delta", {"text": visible})
                rest = splitter.finish()
                if rest:
                    text += rest
                    yield AskEvent("delta", {"text": rest})
                trailer = splitter.trailer
            else:
                raw = self._generate(
                    prepared.question,
                    prepared.chunks,
                    self._system_prompt(prepared),
                    prepared.history,
                )
                text, trailer = split_trailer(raw)
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
        if not answer:
            raise LLMProviderError("The language model returned an empty response.")
        meta = reconcile(parse_trailer(trailer), answer, count, prepared.question)
        if not meta.followUps and prepared.followups:
            meta = meta.model_copy(update={"followUps": prepared.followups})
        final_event = self._final(prepared, answer, meta)
        self._store(prepared, sources_event, final_event)
        yield final_event

    def _store(
        self, prepared: PreparedAnswer, sources: AskEvent, final: AskEvent
    ) -> None:
        """Cache a finished answer (never a fallback after a provider failure)."""
        if prepared.cache is None or prepared.used_fallback:
            return
        answer_cache.set_answer(
            prepared.cache,
            prepared.answer_mode,
            {"sources": sources.data["sources"], "final": final.data},
        )

    def to_response(
        self, prepared: PreparedAnswer, final: dict[str, Any]
    ) -> AskResponse:
        """``POST /chat`` shape: ``[S#]`` becomes ``[k]`` and citations follow first use."""
        answer = str(final.get("answer", ""))
        used = list(final.get("usedSources") or [])
        text, order = _to_legacy_markers(answer, used)
        sources = prepared.sources
        if prepared.cached is not None:
            sources = [
                AskCitation.model_validate(
                    {k: v for k, v in source.items() if k != "id"}
                )
                for source in prepared.cached.get("sources", [])
            ]
        citations = [sources[i - 1] for i in order if 1 <= i <= len(sources)]
        mode = str(final.get("mode", "memory"))
        return AskResponse(
            answer=text,
            citations=citations,
            insufficient_context=bool(final.get("insufficient_context")),
            used_fallback=bool(final.get("used_fallback")),
            mode=_LEGACY_MODES.get(mode, "memory"),
            suggested_followups=list(final.get("followUps") or []),
        )

    # -- instant answers ------------------------------------------------------

    def _ai_ready(self) -> bool:
        """A model is configured and at least one key is not cooling down."""
        backends = build_backends(self.settings)
        return any(key_pool.cooldown_remaining(b) <= 0 for b in backends)

    def _instant(
        self,
        base: PreparedAnswer,
        chunks: Sequence[RetrievedChunk],
        memory_id: UUID | None,
        llm: bool,
    ) -> PreparedAnswer:
        """Quoted answer from the retrieved chunks, or "not in your saves"."""
        ai = llm and self._ai_ready()
        recent = bool(chunks) and not has_keywords(base.question) and not (
            is_overview_question(base.question)
        )
        followups = base.followups
        if self._quote(base, chunks, memory_id, use_db=True):
            # Listing the latest saves is nothing the AI could improve on.
            base.ai_available = ai and not recent
            return base
        self._fixed(base, INSUFFICIENT_ANSWER, insufficient=True)
        # The AI can still answer general questions, or read saves whose
        # sentences didn't clear the bar.
        base.ai_available = ai and (bool(chunks) or not base.personal)
        if chunks and followups:
            base.followups = followups
        return base

    def _quote(
        self,
        base: PreparedAnswer,
        chunks: Sequence[RetrievedChunk],
        memory_id: UUID | None,
        *,
        use_db: bool,
    ) -> bool:
        """Fill ``base`` with an answer quoted from ``chunks``; False when none fits.

        No keywords ("what did I save?") -> the latest saves; "summarise X" ->
        the stored summary (``use_db``) or the save's leading sentences;
        anything else -> the best-scoring sentences.
        """
        if not chunks:
            return False
        overview = is_overview_question(base.question)
        if not has_keywords(base.question) and not overview:
            self._recent_answer(base, chunks)
            return True
        if use_db and self._summary_answer(base, chunks, memory_id) is not None:
            return True
        extracted = (
            overview_answer(chunks)
            if overview
            else extract_answer(base.question, chunks, self._extract_min_score())
        )
        if extracted.text is None:
            return False
        base.fixed_answer = extracted.text
        base.fixed_used = extracted.used_sources
        base.sources = [_citation(chunk) for chunk in chunks]
        base.chunks = []
        return True

    def _recent_answer(
        self, base: PreparedAnswer, chunks: Sequence[RetrievedChunk]
    ) -> PreparedAnswer:
        """The user's latest saves, one line each, for questions with no keywords."""
        citations = _citations_from_chunks(list(chunks))
        lines = [
            f"- **{citation.title}**"
            + (f": {citation.excerpt}" if citation.excerpt else "")
            + f" [{prompts.source_id(index)}]"
            for index, citation in enumerate(citations, start=1)
        ]
        return self._fixed(
            base, "Your most recent saves:\n\n" + "\n".join(lines), sources=citations
        )

    def _summary_answer(
        self,
        base: PreparedAnswer,
        chunks: Sequence[RetrievedChunk],
        memory_id: UUID | None,
    ) -> PreparedAnswer | None:
        """Stored summary and key points for "summarise this save" questions."""
        if not chunks or not needs_document_context(base.question):
            return None
        memories = {chunk.memory_id for chunk in chunks}
        target = memory_id or (next(iter(memories)) if len(memories) == 1 else None)
        db = getattr(self.retrieval, "db", None)
        if target is None or db is None:
            return None
        item = db.get(MemoryItem, target)
        if item is None or not (item.summary or "").strip():
            return None
        mine = [chunk for chunk in chunks if chunk.memory_id == target] or list(chunks)
        lines = [f"{sanitize_untrusted_text(item.summary or '').strip()} [S1]"]
        points = [
            sanitize_untrusted_text(point).strip()
            for point in (item.key_points or [])
            if isinstance(point, str) and point.strip()
        ]
        if points:
            lines.append("")
            lines.extend(f"- {point}" for point in points)
        base.fixed_answer = "\n".join(lines)
        base.fixed_used = ["S1"]
        base.sources = [_citation(chunk) for chunk in mine]
        return base

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
        self,
        base: PreparedAnswer,
        chunks: Sequence[RetrievedChunk],
        memory_id: UUID | None = None,
        *,
        use_db: bool = True,
    ) -> PreparedAnswer:
        """The instant answer, for an ai request no model can answer."""
        if not self._quote(base, chunks, memory_id, use_db=use_db):
            return self._fixed(base, INSUFFICIENT_ANSWER, insufficient=True)
        base.fixed_mode = "memory"
        base.used_fallback = True
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
            answer_mode=prepared.answer_mode,
            personal=prepared.personal,
        )
        result = self._fallback(fallback, chunks, use_db=False)
        return result if result.used_fallback else None

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
        # Every instant-mode answer is made without a model call.
        mode = "instant" if prepared.answer_mode == "instant" else meta.mode
        return AskEvent(
            "final",
            {
                "answer": answer,
                "mode": mode,
                "usedSources": meta.usedSources,
                "followUps": meta.followUps,
                "insufficient_context": insufficient,
                "used_fallback": prepared.used_fallback,
                "aiAvailable": prepared.ai_available,
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
            with observe_stage("answer_total"):
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
            backend,
            status,
            timed_out=timed_out,
            cooldown_seconds=self._cooldown(),
            max_cooldown_seconds=int(
                getattr(self.settings, "llm_cooldown_max_seconds", None)
                or DEFAULT_MAX_COOLDOWN_SECONDS
            ),
            retry_after=retry_after_seconds(exc),
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
        for backend in self._attempts(backends):
            self._last_usage = None
            started = time.perf_counter()
            try:
                answer = self._call_backend(backend, prompt, system_prompt)
            except Exception as exc:
                self._record_call(backend, started, exc)
                self._mark_failed(backend, exc)
                last_error = exc
                continue
            self._record_call(backend, started)
            key_pool.mark_ok(backend)
            return answer
        assert last_error is not None
        raise last_error

    def _record_call(
        self,
        backend: LLMBackend,
        started: float,
        error: BaseException | None = None,
        *,
        purpose: str | None = None,
    ) -> None:
        record_usage(
            purpose=purpose or self._usage_purpose,
            provider=backend.provider,
            model=backend.model,
            started=started,
            report=self._last_usage,
            error=error,
            user_id=self._usage_user_id,
        )

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
        began = time.perf_counter()
        for backend in self._attempts(backends):
            started = False
            self._last_usage = None
            call_started = time.perf_counter()
            try:
                for piece in self._stream_backend(backend, prompt, system_prompt):
                    if piece:
                        if not started:
                            ASK_STAGE_SECONDS.labels(stage="answer").observe(
                                time.perf_counter() - began
                            )
                        started = True
                        yield piece
            except Exception as exc:
                self._record_call(backend, call_started, exc)
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
            self._record_call(backend, call_started)
            key_pool.mark_ok(backend)
            ASK_STAGE_SECONDS.labels(stage="answer_total").observe(
                time.perf_counter() - began
            )
            return
        status = _status_of(last_error) if isinstance(last_error, Exception) else None
        if isinstance(last_error, LLMProviderError):
            status = last_error.status
        raise LLMProviderError(
            str(last_error) or "Every chat backend failed.", status=status
        )

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
        client, extra = self._openai_client(backend, self._attempt_timeout)
        stream = client.chat.completions.create(
            model=backend.model,
            temperature=0.2,
            max_tokens=self._max_output_tokens(),
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": prompt},
            ],
            stream=True,
            stream_options={"include_usage": True},
            extra_headers=extra.headers,
            extra_body=extra.body,
        )
        for chunk in stream:
            usage = getattr(chunk, "usage", None)
            if usage is not None:
                self._last_usage = report_from_openai(usage)
            choices = getattr(chunk, "choices", None) or []
            delta = getattr(choices[0], "delta", None) if choices else None
            text = getattr(delta, "content", None)
            if text:
                yield text

    def _openai_client(
        self, backend: LLMBackend, timeout: float, *, structured: bool = False
    ) -> tuple[OpenAI, _Extra]:
        """Client and extra request arguments for an OpenAI-compatible backend."""
        return openai_compatible_client(
            backend, timeout, self.settings, structured=structured, client_cls=OpenAI
        )

    def _max_output_tokens(self) -> int:
        return int(getattr(self.settings, "rag_max_output_tokens", 900) or 900)

    def _complete_openai(
        self, prompt: str, system_prompt: str, backend: LLMBackend
    ) -> str:
        client, extra = self._openai_client(backend, self._attempt_timeout)
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
        self._last_usage = report_from_openai(getattr(completion, "usage", None))
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
            http_options=types.HttpOptions(
                timeout=int(max(self._attempt_timeout, GEMINI_MIN_DEADLINE_SECONDS) * 1000)
            ),  # ms
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
        # need them, and keeping them low roughly halves latency.
        try:
            response = generate(gemini_thinking_config(backend.model))
        except Exception as exc:
            # Some models refuse a thinking setting (2.5 Pro cannot switch it off,
            # 3.x lite rejects a zero budget); any other 400 (a bad key, a bad
            # request) would only fail again.
            if getattr(exc, "code", None) != 400 or not _rejects_thinking(exc):
                raise
            response = generate(None)
        self._last_usage = report_from_gemini(response)
        return _gemini_response_text(response)


_GEMINI_MAJOR_RE = re.compile(r"gemini-(\d+)")


def gemini_thinking_config(model: str) -> Any:
    """Least thinking the model accepts.

    Gemini 3.x (and the ``-latest`` aliases, which point at 3.x) take
    ``thinking_level``; a zero ``thinking_budget`` makes some of them hang or
    reject the request. ``low`` is the lowest level every 3.x model accepts.
    Gemini 2.x switches thinking off with ``thinking_budget=0``.
    """
    from google.genai import types

    match = _GEMINI_MAJOR_RE.search(model)
    if (match and int(match.group(1)) >= 3) or model.endswith("-latest"):
        return types.ThinkingConfig(thinking_level=types.ThinkingLevel.LOW)
    return types.ThinkingConfig(thinking_budget=0)


def _rejects_thinking(exc: BaseException) -> bool:
    text = str(exc).lower()
    return "thinking" in text or "invalid argument" in text


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
