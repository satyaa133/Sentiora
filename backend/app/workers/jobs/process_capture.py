import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, or_, select, update
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import EnrichmentStatus, ItemStatus, MemoryItem, SourceType
from app.repositories.chunk_repository import ChunkRepository
from app.services.chunking import ChunkDraft, chunk_content, chunk_transcript
from app.services.content_normalizer import (
    calculate_reading_time,
    calculate_word_count,
    detect_language,
    extract_domain,
    normalize_content,
)
from app.services.embedding_service import (
    chunk_embedding_text,
    current_embedding_model,
    get_embedding_adapter,
    needs_vector_for,
    set_chunk_vector,
)
from app.services.ingest.pdf_title import readable_pdf_title
from app.services.ingest.transcript_normalizer import (
    clean_transcript_nodes,
    clean_transcript_text,
)
from app.services.usage import usage_for
from app.workers.queue import create_queues
from app.services.enrichment_service import enqueue_enrichment

logger = logging.getLogger(__name__)

MIN_SEARCHABLE_WORDS = 8
STALE_AFTER = timedelta(minutes=2)
# When embedding fails at capture, it is retried after each of these delays.
EMBEDDING_RETRY_DELAYS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
)
_STUB_MARKERS = (
    "captured youtube content:",
    "captured pdf content:",
    "captured webpage content:",
    "open the dashboard to view full extracted content",
    "[transcript unavailable]",
)


class CaptureProcessingError(RuntimeError):
    """Raised when a capture cannot become a searchable READY memory."""


def _find_existing_ready(db: DBSession, user_id: UUID, url: str, current_id: UUID) -> MemoryItem | None:
    stmt = select(MemoryItem).where(
        and_(
            MemoryItem.user_id == user_id,
            MemoryItem.url == url,
            MemoryItem.status == ItemStatus.ready,
            MemoryItem.deleted_at.is_(None),
            MemoryItem.id != current_id,
        )
    )
    # Several READY rows can share a URL after races; reuse the oldest one.
    return db.execute(stmt.order_by(MemoryItem.created_at).limit(1)).scalars().first()


def _looks_like_stub(text: str) -> bool:
    compact = " ".join((text or "").lower().split())
    return any(marker in compact for marker in _STUB_MARKERS)


def _fail_item(item: MemoryItem, reason: str) -> None:
    item.status = ItemStatus.failed
    item.processing_error = reason[:2000]
    logger.error(
        "memory_id=%s stage=failed reason=%s",
        item.id,
        reason,
    )


def _vector_dim() -> int:
    return get_settings().embedding_dimensions


def _claim(db: DBSession, item_id: UUID) -> bool:
    """Atomically take ownership of a pending (or abandoned processing) item.

    The worker, the API's inline fallback and stale recovery can all reach the
    same item; only the caller whose UPDATE matches may process it, so chunks are
    never written twice concurrently and READY/FAILED items are not reprocessed.
    """
    now = datetime.now(UTC)
    result = db.execute(
        update(MemoryItem)
        .where(
            MemoryItem.id == item_id,
            MemoryItem.deleted_at.is_(None),
            or_(
                MemoryItem.status == ItemStatus.pending,
                and_(
                    MemoryItem.status == ItemStatus.processing,
                    MemoryItem.updated_at < now - STALE_AFTER,
                ),
            ),
        )
        .values(status=ItemStatus.processing, processing_error=None, updated_at=now)
        .execution_options(synchronize_session=False)
    )
    db.commit()
    return getattr(result, "rowcount", 0) == 1


def prepare_chunks(item: MemoryItem) -> list[ChunkDraft]:
    """Normalize the item's text in place and return its chunk drafts.

    YouTube transcripts have rolling-caption overlap removed from both the
    timed nodes and the plain text first. Raises CaptureProcessingError when
    nothing searchable is left.
    """
    nodes = None
    if item.source_type == SourceType.youtube:
        nodes = clean_transcript_nodes(item.structured_content)
        if nodes:
            item.structured_content = nodes

    if nodes:
        normalized = normalize_content(
            "\n\n".join(node["text"] for node in nodes), item.source_type
        )
    else:
        normalized = normalize_content(item.content, item.source_type)
        if not normalized and item.content:
            normalized = item.content.strip()
        if item.source_type == SourceType.youtube and normalized:
            normalized = clean_transcript_text(normalized)

    if not normalized or _looks_like_stub(normalized):
        raise CaptureProcessingError(
            "Extraction produced no searchable content (metadata/stub only)."
        )
    if item.source_type == SourceType.pdf and item.title:
        item.title = readable_pdf_title(item.title, item.content or normalized)

    word_count = calculate_word_count(normalized)
    if word_count < MIN_SEARCHABLE_WORDS:
        raise CaptureProcessingError(
            f"Extracted text is too short to index ({word_count} words)."
        )

    drafts: list[ChunkDraft] = []
    if nodes:
        # Timestamped transcript segments keep their time range per chunk.
        drafts = chunk_transcript(nodes)
    if not drafts:
        drafts = chunk_content(normalized, item.source_type)
    if not drafts:
        raise CaptureProcessingError("Chunking produced no searchable units.")

    item.content = normalized
    item.domain = extract_domain(item.url) or item.domain
    item.language = detect_language(normalized)
    item.content_length = len(normalized)
    item.word_count = word_count
    item.reading_time_seconds = calculate_reading_time(word_count)
    return drafts


def build_chunk_rows(item: MemoryItem, drafts: list[ChunkDraft]) -> list[MemoryChunk]:
    return [
        MemoryChunk(
            memory_id=item.id,
            user_id=item.user_id,
            chunk_index=draft.chunk_index,
            content=draft.content,
            heading=draft.heading,
            page_number=draft.page_number,
            start_sec=draft.start_sec,
            end_sec=draft.end_sec,
            source_type=item.source_type,
        )
        for draft in drafts
    ]


def embed_chunks(chunks: list[MemoryChunk], memory_label: str) -> object | None:
    """Fill every chunk's vector for the active model.

    Remote models write ``embedding`` and ``embedding_model``; the local model
    writes ``embedding_local`` (``set_chunk_vector``).

    Returns the adapter used, or None when no provider is configured. Raises
    CaptureProcessingError when the provider fails; callers decide whether
    that is fatal.
    """
    try:
        adapter = get_embedding_adapter()
    except Exception as adapter_exc:
        logger.exception("memory_id=%s stage=embed adapter_init_failed", memory_label)
        raise CaptureProcessingError(
            f"Embedding adapter failed to initialize: {adapter_exc}"
        ) from adapter_exc

    if not adapter:
        logger.warning(
            "memory_id=%s stage=embed skipped=no_api_key lexical_only=true", memory_label
        )
        return None

    logger.info("memory_id=%s stage=embed chunks=%d", memory_label, len(chunks))
    try:
        vectors = adapter.embed_texts([chunk_embedding_text(chunk) for chunk in chunks])
        expected = int(getattr(adapter, "dimensions", 0) or _vector_dim())
        if len(vectors) != len(chunks):
            raise CaptureProcessingError(
                f"Embedding count mismatch: got {len(vectors)} for {len(chunks)} chunks."
            )
        for vector in vectors:
            if not vector or len(vector) != expected:
                raise CaptureProcessingError(
                    f"Embedding dimension mismatch: expected {expected}, got {len(vector) if vector else 0}."
                )
        model_id = getattr(adapter, "model_id", None)
        for chunk, vector in zip(chunks, vectors, strict=True):
            set_chunk_vector(chunk, model_id, vector)
    except CaptureProcessingError:
        raise
    except Exception as emb_exc:
        logger.exception("memory_id=%s stage=embed failed", memory_label)
        raise CaptureProcessingError(f"Embedding generation failed: {emb_exc}") from emb_exc
    logger.info("memory_id=%s stage=store embeddings=%d", memory_label, len(vectors))
    return adapter


def _queue_requested_enrichment(item: MemoryItem) -> None:
    """Enrichment asked for before the save was ready (Save now) starts now."""
    if item.enrichment_status == EnrichmentStatus.queued:
        enqueue_enrichment(item.id)


def process_capture(memory_item_id_str: str) -> None:
    """Normalize, chunk, optionally embed, then mark READY or FAILED."""
    logger.info("memory_id=%s stage=start", memory_item_id_str)
    db = SessionLocal()
    try:
        item_id = UUID(memory_item_id_str)
        item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
        if not item:
            logger.error("memory_id=%s stage=load reason=not_found", memory_item_id_str)
            return
        if not _claim(db, item_id):
            logger.info(
                "memory_id=%s stage=skip reason=not_claimable status=%s",
                memory_item_id_str,
                item.status,
            )
            return
        db.refresh(item)

        existing = _find_existing_ready(db, item.user_id, item.url, item.id)
        if existing:
            originals = ChunkRepository(db).list_for_memory(existing.id, item.user_id)
            if originals:
                logger.info(
                    "memory_id=%s stage=dedup source_id=%s chunks=%d",
                    memory_item_id_str,
                    existing.id,
                    len(originals),
                )
                item.status = ItemStatus.ready
                item.processing_error = None
                item.content = existing.content
                item.domain = existing.domain
                item.language = existing.language
                item.content_length = existing.content_length
                item.word_count = existing.word_count
                item.reading_time_seconds = existing.reading_time_seconds
                clones = [
                    MemoryChunk(
                        memory_id=item.id,
                        user_id=item.user_id,
                        chunk_index=chunk.chunk_index,
                        content=chunk.content,
                        heading=chunk.heading,
                        page_number=chunk.page_number,
                        start_sec=chunk.start_sec,
                        end_sec=chunk.end_sec,
                        source_type=chunk.source_type,
                        embedding=chunk.embedding,
                        embedding_model=chunk.embedding_model,
                        embedding_local=chunk.embedding_local,
                        context=chunk.context,
                    )
                    for chunk in originals
                ]
                ChunkRepository(db).replace_for_memory(item.id, item.user_id, clones)
                db.commit()
                _queue_requested_enrichment(item)
                logger.info("memory_id=%s stage=ready via=dedup", memory_item_id_str)
                return
            logger.warning(
                "memory_id=%s stage=dedup skipped empty_source_id=%s",
                memory_item_id_str,
                existing.id,
            )

        item.status = ItemStatus.processing
        item.processing_error = None
        db.commit()

        logger.info("memory_id=%s stage=normalize source_type=%s", memory_item_id_str, item.source_type)
        drafts = prepare_chunks(item)
        chunks = build_chunk_rows(item, drafts)
        ChunkRepository(db).replace_for_memory(item.id, item.user_id, chunks)
        try:
            with usage_for(item.user_id):
                adapter = embed_chunks(chunks, memory_item_id_str)
        except CaptureProcessingError as embed_exc:
            # The memory is still searchable by full text; the embedding
            # backfill (scripts.reprocess_memories --embed) fills it in later.
            for chunk in chunks:
                chunk.embedding = None
                chunk.embedding_model = None
                chunk.embedding_local = None
            adapter = None
            logger.warning(
                "memory_id=%s stage=embed pending reason=%s", memory_item_id_str, embed_exc
            )
            retry_embedding_later = True
        else:
            retry_embedding_later = False

        item.status = ItemStatus.ready
        item.processing_error = None
        db.commit()
        if retry_embedding_later:
            schedule_embedding_retry(memory_item_id_str, attempt=1)
        _queue_requested_enrichment(item)
        logger.info(
            "memory_id=%s stage=ready words=%d chunks=%d embedded=%s",
            memory_item_id_str,
            item.word_count,
            len(chunks),
            adapter is not None,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("memory_id=%s stage=error error=%s", memory_item_id_str, exc)
        try:
            item_id = UUID(memory_item_id_str)
            item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
            if item:
                reason = str(exc) if isinstance(exc, CaptureProcessingError) else type(exc).__name__
                _fail_item(item, reason)
                db.commit()
        except Exception:
            db.rollback()
            logger.exception("memory_id=%s stage=fail_commit_failed", memory_item_id_str)
    finally:
        db.close()


def recover_stale_captures(limit: int = 25) -> int:
    """Re-process pending/processing items left behind by a dead worker."""
    cutoff = datetime.now(UTC) - STALE_AFTER
    db = SessionLocal()
    ids: list[str] = []
    try:
        stale = (
            db.query(MemoryItem)
            .filter(
                MemoryItem.status.in_([ItemStatus.pending, ItemStatus.processing]),
                MemoryItem.deleted_at.is_(None),
                MemoryItem.updated_at < cutoff,
            )
            .order_by(MemoryItem.updated_at.asc())
            .limit(limit)
            .all()
        )
        ids = [str(item.id) for item in stale]
    finally:
        db.close()

    for item_id in ids:
        logger.warning("memory_id=%s stage=stale_recover", item_id)
        process_capture(item_id)
    return len(ids)


def schedule_embedding_retry(memory_item_id_str: str, attempt: int) -> bool:
    """Queue embedding retry number ``attempt`` (1-based) after its delay.

    Returns False when every retry is used up or the queue can't be reached;
    the memory stays searchable by full text and the backfill
    (scripts.reprocess_memories --embed) can still fill it in.
    """
    if attempt > len(EMBEDDING_RETRY_DELAYS):
        logger.warning(
            "memory_id=%s stage=embed_retry gave_up attempts=%d",
            memory_item_id_str,
            len(EMBEDDING_RETRY_DELAYS),
        )
        return False
    delay = EMBEDDING_RETRY_DELAYS[attempt - 1]
    try:
        queue = create_queues()[0]
        queue.enqueue_in(delay, retry_embedding, memory_item_id_str, attempt)
    except Exception:
        logger.exception(
            "memory_id=%s stage=embed_retry schedule_failed attempt=%d",
            memory_item_id_str,
            attempt,
        )
        return False
    logger.info(
        "memory_id=%s stage=embed_retry scheduled attempt=%d in=%ds",
        memory_item_id_str,
        attempt,
        int(delay.total_seconds()),
    )
    return True


def retry_embedding(memory_item_id_str: str, attempt: int) -> None:
    """Embed a READY memory's chunks that have no vector for the active model."""
    db = SessionLocal()
    try:
        item = db.get(MemoryItem, UUID(memory_item_id_str))
        if item is None or item.deleted_at is not None or item.status != ItemStatus.ready:
            return
        model_id = current_embedding_model()
        if model_id is None:
            return
        chunks = (
            db.query(MemoryChunk)
            .filter(
                MemoryChunk.memory_id == item.id,
                MemoryChunk.user_id == item.user_id,
                needs_vector_for(model_id),
            )
            .order_by(MemoryChunk.chunk_index)
            .all()
        )
        if not chunks:
            return
        try:
            with usage_for(item.user_id):
                adapter = embed_chunks(chunks, memory_item_id_str)
        except CaptureProcessingError as exc:
            db.rollback()
            logger.warning(
                "memory_id=%s stage=embed_retry failed attempt=%d reason=%s",
                memory_item_id_str,
                attempt,
                exc,
            )
            schedule_embedding_retry(memory_item_id_str, attempt + 1)
            return
        if adapter is None:
            db.rollback()
            return
        db.commit()
        logger.info(
            "memory_id=%s stage=embed_retry done attempt=%d chunks=%d",
            memory_item_id_str,
            attempt,
            len(chunks),
        )
    finally:
        db.close()
