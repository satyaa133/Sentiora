"""Background AI enrichment of saves that matter (REBUILD_PLAN S5).

A save is enriched when the user asks for it (Save now, the Summarise
button), opens it in the app, or it is a source of an Ask answer. Auto-saved
pages are never enriched on capture. Each enrichment is one structured AI
call; a per-user daily cap (``ENRICH_DAILY_LIMIT``) bounds the cost.

Enrichment stores the summary and key points on the save, a context line on
each chunk and the questions the save answers (embedded locally, for the
question-bank leg). Chunks keep vectors of their own text: embedding the
context line with them scored lower in the S5 eval (owner, 2026-11-21).

Only Groq enriches (no paid fallback, owner 2026-11-21): when it is rate-
limited the job retries later instead of spending OpenRouter credit.
"""

from __future__ import annotations

import enum
import logging
import math
import time
from collections.abc import Sequence
from dataclasses import replace
from datetime import UTC, datetime, timedelta
from typing import cast
from uuid import UUID

from openai import OpenAI
from openai.types.shared_params import ResponseFormatJSONSchema
from sqlalchemy import delete, func, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import EnrichmentStatus, ItemStatus, MemoryItem
from app.models.memory_question import MemoryQuestion
from app.services.embedding_service import (
    chunk_vector,
    get_embedding_adapter,
    is_local_model,
)
from app.services.llm.clients import openai_compatible_client
from app.services.retrieval.reranker import get_reranker, passage_text
from app.services.llm.enrichment import (
    ENRICH_RESPONSE_FORMAT,
    ENRICH_SYSTEM_PROMPT,
    ChunkInput,
    Enrichment,
    enrich_prompt,
    parse_enrichment,
)
from app.services.llm_pool import (
    LLMBackend,
    build_backends,
    key_pool,
    max_attempts,
    retry_after_seconds,
)
from app.services.usage import UsageReport, record_usage, report_from_openai
from app.workers.queue import enrich_queue

logger = logging.getLogger(__name__)

# Providers that enrich: free tier, keeps and trains on nothing (D13). No paid
# fallback: a rate-limited provider means a retry later.
ENRICH_PROVIDERS = ("groq",)
# Enrichment runs in the background, so it can wait longer than an answer.
ENRICH_TIMEOUT_SECONDS = 60.0
# Output budget: summary, key points, questions and a line per chunk.
ENRICH_MAX_OUTPUT_TOKENS = 6000
ENRICH_JOB_TIMEOUT_SECONDS = 300
_ENRICH_JOB = "app.workers.jobs.enrich_memory.enrich_memory"


class EnrichmentError(RuntimeError):
    """Every AI backend failed or replied with something unusable (retryable)."""


class RequestResult(enum.StrEnum):
    queued = "queued"
    already_queued = "already_queued"
    already_enriched = "already_enriched"
    over_daily_limit = "over_daily_limit"
    not_available = "not_available"


def _utc_midnight(now: datetime) -> datetime:
    return now.replace(hour=0, minute=0, second=0, microsecond=0)


class EnrichmentService:
    def __init__(self, db: DBSession) -> None:
        self.db = db
        self.settings = get_settings()

    # -- requesting ---------------------------------------------------------

    def requests_today(self, user_id: UUID) -> int:
        since = _utc_midnight(datetime.now(UTC))
        return int(
            self.db.execute(
                select(func.count())
                .select_from(MemoryItem)
                .where(
                    MemoryItem.user_id == user_id,
                    MemoryItem.enrich_requested_at >= since,
                )
            ).scalar_one()
        )

    def request(self, item: MemoryItem, *, force: bool = False) -> RequestResult:
        """Queue enrichment of one save the user cares about.

        Without ``force`` (automatic triggers) a save that is already enriched,
        queued or failed is left alone. ``force`` (Summarise, Save now) also
        retries a failed one and re-enriches an enriched one.
        """
        if item.deleted_at is not None or item.status == ItemStatus.failed:
            return RequestResult.not_available
        current = item.enrichment_status
        if current == EnrichmentStatus.queued:
            return RequestResult.already_queued
        if not force and current in (EnrichmentStatus.ready, EnrichmentStatus.failed):
            return RequestResult.already_enriched
        if self.requests_today(item.user_id) >= int(self.settings.enrich_daily_limit):
            return RequestResult.over_daily_limit
        item.enrichment_status = EnrichmentStatus.queued.value
        item.enrich_requested_at = datetime.now(UTC)
        self.db.commit()
        if item.status == ItemStatus.ready:
            enqueue_enrichment(item.id)
        # Otherwise the capture job queues it once the save is processed.
        return RequestResult.queued

    def request_for_memories(self, user_id: UUID, memory_ids: list[UUID]) -> None:
        """Automatic trigger (save opened, Ask source): never raises, never forces."""
        if not memory_ids:
            return
        try:
            items = self.db.execute(
                select(MemoryItem).where(
                    MemoryItem.user_id == user_id,
                    MemoryItem.id.in_(list(dict.fromkeys(memory_ids))),
                    MemoryItem.deleted_at.is_(None),
                    MemoryItem.enrichment_status == EnrichmentStatus.none.value,
                )
            ).scalars()
            for item in items:
                if self.request(item) == RequestResult.over_daily_limit:
                    break
        except Exception:
            self.db.rollback()
            logger.warning("Could not request enrichment", exc_info=True)

    # -- running ------------------------------------------------------------

    def _backends(self) -> list[LLMBackend]:
        backends = [
            b for b in build_backends(self.settings) if b.provider in ENRICH_PROVIDERS
        ]
        model = (self.settings.enrich_model or "").strip()
        primary = (self.settings.llm_provider or "").strip().lower()
        if model:
            backends = [replace(b, model=model) if b.provider == primary else b for b in backends]
        return backends

    def generate(self, item: MemoryItem, chunks: list[MemoryChunk]) -> tuple[Enrichment, str]:
        """One structured call through the key pool; raises EnrichmentError."""
        backends = self._backends()
        if not backends:
            raise EnrichmentError("No enrichment provider (Groq) key is configured.")
        prompt = enrich_prompt(
            item.title,
            item.source_type.value,
            [
                ChunkInput(
                    index=i,
                    content=c.content,
                    heading=c.heading,
                    page_number=c.page_number,
                    start_sec=c.start_sec,
                    end_sec=c.end_sec,
                )
                for i, c in enumerate(chunks)
            ],
        )
        last_error: str = "no backend tried"
        for backend in key_pool.order(backends)[: max_attempts(self.settings)]:
            started = time.perf_counter()
            try:
                raw, report = self._call(backend, prompt)
            except Exception as exc:
                record_usage(
                    purpose="enrich",
                    provider=backend.provider,
                    model=backend.model,
                    started=started,
                    error=exc,
                    user_id=item.user_id,
                )
                key_pool.mark_failed(
                    backend,
                    getattr(exc, "status_code", None),
                    timed_out="timeout" in type(exc).__name__.lower(),
                    cooldown_seconds=int(self.settings.llm_key_cooldown_seconds),
                    max_cooldown_seconds=int(self.settings.llm_cooldown_max_seconds),
                    retry_after=retry_after_seconds(exc),
                )
                last_error = f"{backend.name}: {type(exc).__name__}"
                logger.warning("enrichment call failed backend=%s", backend.name)
                continue
            record_usage(
                purpose="enrich",
                provider=backend.provider,
                model=backend.model,
                started=started,
                report=report,
                user_id=item.user_id,
            )
            key_pool.mark_ok(backend)
            result = parse_enrichment(raw, len(chunks))
            if result is not None:
                return result, f"{backend.provider}:{backend.model}"
            last_error = f"{backend.name}: unusable reply"
            logger.warning("enrichment reply failed validation backend=%s", backend.name)
        raise EnrichmentError(f"Enrichment failed ({last_error}).")

    def _call(self, backend: LLMBackend, prompt: str) -> tuple[str, UsageReport | None]:
        client, extra = openai_compatible_client(
            backend,
            ENRICH_TIMEOUT_SECONDS,
            self.settings,
            structured=True,
            client_cls=OpenAI,
        )
        completion = client.chat.completions.create(
            model=backend.model,
            temperature=0,
            max_tokens=ENRICH_MAX_OUTPUT_TOKENS,
            messages=[
                {"role": "system", "content": ENRICH_SYSTEM_PROMPT},
                {"role": "user", "content": prompt},
            ],
            response_format=cast(ResponseFormatJSONSchema, ENRICH_RESPONSE_FORMAT),
            extra_headers=extra.headers,
            extra_body=extra.body,
        )
        report = report_from_openai(getattr(completion, "usage", None))
        return completion.choices[0].message.content or "", report

    # -- storing ------------------------------------------------------------

    def store(
        self, item: MemoryItem, chunks: list[MemoryChunk], result: Enrichment, model: str
    ) -> None:
        """Save the enrichment and embed its questions (local model)."""
        item.summary = result.summary
        item.key_points = result.key_points
        item.enrichment_status = EnrichmentStatus.ready.value
        item.enriched_at = datetime.now(UTC)
        item.enrichment_model = model[:128]
        for index, chunk in enumerate(chunks):
            chunk.context = result.contexts.get(index)

        adapter = None
        try:
            adapter = get_embedding_adapter()
        except Exception:
            logger.warning("No embedding adapter for enrichment", exc_info=True)
        model_id = getattr(adapter, "model_id", None)
        question_vectors: list[list[float] | None] = [None] * len(result.questions)
        answering = [hint for _, hint in result.questions]
        if adapter is not None:
            try:
                if is_local_model(model_id):
                    question_vectors = [
                        adapter.embed_query(question) for question, _ in result.questions
                    ]
                    stored = [chunk_vector(c, model_id) for c in chunks]
                    vectors = (
                        [list(v) for v in stored]
                        if all(v is not None for v in stored)
                        else adapter.embed_texts([c.content for c in chunks])
                    )
                    answering = answering_chunks(
                        result.questions, question_vectors, chunks, vectors
                    )
            except Exception:
                # Questions without vectors are kept; the model's chunk is used.
                logger.warning("Embedding enrichment questions failed", exc_info=True)

        self.db.execute(delete(MemoryQuestion).where(MemoryQuestion.memory_id == item.id))
        for (question, _), chunk_index, question_vector in zip(
            result.questions, answering, question_vectors, strict=True
        ):
            self.db.add(
                MemoryQuestion(
                    memory_id=item.id,
                    user_id=item.user_id,
                    chunk_id=chunks[chunk_index].id,
                    question=question,
                    embedding_local=question_vector,
                )
            )
        self.db.commit()

    def chunks_for(self, item: MemoryItem) -> list[MemoryChunk]:
        return list(
            self.db.execute(
                select(MemoryChunk)
                .where(MemoryChunk.memory_id == item.id, MemoryChunk.user_id == item.user_id)
                .order_by(MemoryChunk.chunk_index)
            ).scalars()
        )

    def enrich_now(self, item: MemoryItem) -> None:
        """Generate and store in this process (job and backfill); raises EnrichmentError."""
        chunks = self.chunks_for(item)
        if not chunks:
            raise EnrichmentError("The save has no chunks yet.")
        result, model = self.generate(item, chunks)
        self.store(item, chunks, result, model)


# Chunks (besides the model's own pick) considered as a question's answer.
_ANSWER_CANDIDATES = 5


def _cosine(a: Sequence[float], b: Sequence[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else 0.0


def answering_chunks(
    questions: Sequence[tuple[str, int]],
    question_vectors: Sequence[Sequence[float] | None],
    chunks: Sequence[MemoryChunk],
    chunk_vectors: Sequence[Sequence[float]],
) -> list[int]:
    """The chunk that answers each question, chosen on this machine.

    The model names a chunk for each question, but on a long save it sees only
    the start of each chunk and often guesses. Its pick and the chunks closest
    to the question are scored by the reranker (or, without one, by vector
    similarity), and the best one wins.
    """
    reranker = get_reranker()
    picks: list[int] = []
    for (question, hint), vector in zip(questions, question_vectors, strict=True):
        if vector is None:
            picks.append(hint)
            continue
        similarity = [_cosine(vector, cv) for cv in chunk_vectors]
        nearest = sorted(range(len(chunks)), key=lambda i: -similarity[i])[:_ANSWER_CANDIDATES]
        candidates = list(dict.fromkeys([hint, *nearest]))
        best = max(candidates, key=lambda i: similarity[i])
        if reranker is not None:
            try:
                scores = reranker.score(
                    question,
                    [passage_text("", chunks[i].heading, chunks[i].content) for i in candidates],
                )
                best = candidates[max(range(len(candidates)), key=lambda k: scores[k])]
            except Exception:
                logger.warning("Reranking answer chunks failed", exc_info=True)
        picks.append(best)
    return picks


def forget_enrichment(db: DBSession, item: MemoryItem) -> None:
    """Remove a save's questions and enrichment (deleted or re-chunked save)."""
    db.execute(delete(MemoryQuestion).where(MemoryQuestion.memory_id == item.id))
    item.summary = None
    item.key_points = None
    item.enrichment_status = EnrichmentStatus.none.value
    item.enriched_at = None
    item.enrichment_model = None


def enrichment_job_id(memory_id: UUID) -> str:
    """One job id per save, so a save is never waiting in the queue twice."""
    return f"enrich-{memory_id}"


def enrichment_job_pending(memory_id: UUID) -> bool:
    """True while the save's job is queued, scheduled (a retry) or running."""
    from rq.exceptions import NoSuchJobError
    from rq.job import Job, JobStatus

    queue = enrich_queue()
    try:
        job = Job.fetch(enrichment_job_id(memory_id), connection=queue.connection)
    except NoSuchJobError:
        return False
    return job.get_status() in (
        JobStatus.QUEUED,
        JobStatus.SCHEDULED,
        JobStatus.STARTED,
        JobStatus.DEFERRED,
    )


def enqueue_enrichment(
    memory_id: UUID, *, delay: timedelta | None = None, attempt: int = 0
) -> bool:
    """Queue the enrichment job; False when Redis is down (the worker recovers it)."""
    options = {
        "job_id": enrichment_job_id(memory_id),
        "job_timeout": ENRICH_JOB_TIMEOUT_SECONDS,
    }
    try:
        queue = enrich_queue()
        if delay is None:
            queue.enqueue(_ENRICH_JOB, str(memory_id), attempt, **options)
        else:
            queue.enqueue_in(delay, _ENRICH_JOB, str(memory_id), attempt, **options)
        return True
    except Exception:
        logger.warning("Could not queue enrichment for memory_id=%s", memory_id)
        return False
