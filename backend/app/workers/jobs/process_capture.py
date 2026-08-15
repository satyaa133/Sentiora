import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.core.db import SessionLocal
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem
from app.repositories.chunk_repository import ChunkRepository
from app.services.chunking import chunk_content
from app.services.content_normalizer import (
    calculate_reading_time,
    calculate_word_count,
    detect_language,
    extract_domain,
    normalize_content,
)
from app.services.embedding_service import get_embedding_adapter

logger = logging.getLogger(__name__)

MIN_SEARCHABLE_WORDS = 8
STALE_AFTER = timedelta(minutes=2)
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
    return db.execute(stmt).scalar_one_or_none()


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
                        source_type=chunk.source_type,
                        embedding=chunk.embedding,
                    )
                    for chunk in originals
                ]
                ChunkRepository(db).replace_for_memory(item.id, item.user_id, clones)
                db.commit()
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
        normalized = normalize_content(item.content, item.source_type)
        if not normalized and item.content:
            normalized = item.content.strip()

        if not normalized or _looks_like_stub(normalized):
            raise CaptureProcessingError(
                "Extraction produced no searchable content (metadata/stub only)."
            )

        word_count = calculate_word_count(normalized)
        if word_count < MIN_SEARCHABLE_WORDS:
            raise CaptureProcessingError(
                f"Extracted text is too short to index ({word_count} words)."
            )

        logger.info("memory_id=%s stage=chunk words=%d", memory_item_id_str, word_count)
        drafts = chunk_content(normalized, item.source_type, title=item.title)
        if not drafts:
            raise CaptureProcessingError("Chunking produced no searchable units.")

        item.content = normalized
        item.domain = extract_domain(item.url) or item.domain
        item.language = detect_language(normalized)
        item.content_length = len(normalized)
        item.word_count = word_count
        item.reading_time_seconds = calculate_reading_time(item.word_count)

        chunks = [
            MemoryChunk(
                memory_id=item.id,
                user_id=item.user_id,
                chunk_index=draft.chunk_index,
                content=draft.content,
                heading=draft.heading,
                page_number=draft.page_number,
                source_type=item.source_type,
            )
            for draft in drafts
        ]
        ChunkRepository(db).replace_for_memory(item.id, item.user_id, chunks)

        adapter = None
        try:
            adapter = get_embedding_adapter()
        except Exception as adapter_exc:
            logger.exception(
                "memory_id=%s stage=embed adapter_init_failed",
                memory_item_id_str,
            )
            raise CaptureProcessingError(
                f"Embedding adapter failed to initialize: {adapter_exc}"
            ) from adapter_exc

        if adapter:
            logger.info("memory_id=%s stage=embed chunks=%d", memory_item_id_str, len(chunks))
            try:
                vectors = adapter.embed_texts([chunk.content for chunk in chunks])
                expected = _vector_dim()
                if len(vectors) != len(chunks):
                    raise CaptureProcessingError(
                        f"Embedding count mismatch: got {len(vectors)} for {len(chunks)} chunks."
                    )
                for chunk, vector in zip(chunks, vectors, strict=True):
                    if not vector or len(vector) != expected:
                        raise CaptureProcessingError(
                            f"Embedding dimension mismatch: expected {expected}, got {len(vector) if vector else 0}."
                        )
                    chunk.embedding = vector
                logger.info("memory_id=%s stage=store embeddings=%d", memory_item_id_str, len(vectors))
            except CaptureProcessingError:
                raise
            except Exception as emb_exc:
                logger.exception("memory_id=%s stage=embed failed", memory_item_id_str)
                raise CaptureProcessingError(f"Embedding generation failed: {emb_exc}") from emb_exc
        else:
            logger.warning(
                "memory_id=%s stage=embed skipped=no_api_key lexical_only=true",
                memory_item_id_str,
            )

        item.status = ItemStatus.ready
        item.processing_error = None
        db.commit()
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
