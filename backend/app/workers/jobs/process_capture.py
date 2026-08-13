import logging
from uuid import UUID

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

logger = logging.getLogger(__name__)


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

        item.status = ItemStatus.ready
        db.commit()
        logger.info(
            "Processed MemoryItem %s (words=%d chunks=%d)",
            memory_item_id_str,
            item.word_count,
            len(chunks),
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
