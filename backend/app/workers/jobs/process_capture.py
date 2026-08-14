import logging
from uuid import UUID

from sqlalchemy import and_, select
from sqlalchemy.orm import Session as DBSession

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


def _find_existing_ready(db: DBSession, user_id: UUID, url: str, current_id: UUID) -> MemoryItem | None:
    """Return the first existing ready memory item for this user+URL that is not the current item."""
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


def process_capture(memory_item_id_str: str) -> None:
    """Normalize captured content, store searchable chunks, then mark the memory ready."""
    logger.info("Starting processing job for MemoryItem: %s", memory_item_id_str)
    db = SessionLocal()
    try:
        item_id = UUID(memory_item_id_str)
        item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
        if not item:
            logger.error("MemoryItem %s not found in DB.", memory_item_id_str)
            return

        # ── Soft deduplication ──────────────────────────────────────────────
        # If the user already has a ready item with the same URL, mark this
        # new one ready immediately to avoid building duplicate chunk sets
        # that would dilute semantic retrieval.
        existing = _find_existing_ready(db, item.user_id, item.url, item.id)
        if existing:
            logger.info(
                "MemoryItem %s is a duplicate of ready item %s (same URL). "
                "Marking ready without re-processing.",
                memory_item_id_str,
                existing.id,
            )
            item.status = ItemStatus.ready
            item.content = existing.content
            item.domain = existing.domain
            item.language = existing.language
            item.content_length = existing.content_length
            item.word_count = existing.word_count
            item.reading_time_seconds = existing.reading_time_seconds
            db.commit()
            return
        # ────────────────────────────────────────────────────────────────────

        item.status = ItemStatus.processing
        item.processing_error = None
        db.commit()

        normalized = normalize_content(item.content, item.source_type)
        if not normalized and item.content:
            normalized = item.content.strip()
        drafts = chunk_content(normalized, item.source_type, title=item.title)

        item.content = normalized
        item.domain = extract_domain(item.url) or item.domain
        item.language = detect_language(normalized)
        item.content_length = len(normalized)
        item.word_count = calculate_word_count(normalized)
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

        # ── Embedding generation ─────────────────────────────────────────────
        # Capture MUST remain fast; embeddings are generated here in the
        # background worker, never during the HTTP capture request.
        adapter = get_embedding_adapter()
        if adapter and chunks:
            try:
                vectors = adapter.embed_texts([chunk.content for chunk in chunks])
                for chunk, vector in zip(chunks, vectors, strict=False):
                    chunk.embedding = vector
                logger.info(
                    "Generated %d embeddings for MemoryItem %s",
                    len(vectors),
                    memory_item_id_str,
                )
            except Exception as emb_exc:
                # Embeddings are best-effort. Item can still be retrieved lexically.
                logger.warning(
                    "Embedding generation failed for MemoryItem %s: %s",
                    memory_item_id_str,
                    emb_exc,
                )
        elif not adapter:
            logger.warning(
                "OPENAI_API_KEY not set — MemoryItem %s will have no embeddings. "
                "Semantic search and Ask Sentiora will not work until the key is configured.",
                memory_item_id_str,
            )

        item.status = ItemStatus.ready
        db.commit()
        logger.info(
            "Processed MemoryItem %s (words=%d chunks=%d embedded=%s)",
            memory_item_id_str,
            item.word_count,
            len(chunks),
            adapter is not None,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Error processing MemoryItem %s: %s", memory_item_id_str, exc)
        try:
            item_id = UUID(memory_item_id_str)
            item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
            if item:
                item.status = ItemStatus.failed
                item.processing_error = type(exc).__name__
                db.commit()
        except Exception:
            db.rollback()
    finally:
        db.close()

