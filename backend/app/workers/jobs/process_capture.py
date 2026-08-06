import logging
import re
from uuid import UUID

from app.core.db import SessionLocal
from app.models.memory_item import ItemStatus, MemoryItem

logger = logging.getLogger(__name__)


def clean_text(text: str | None) -> str:
    if not text:
        return ""
    # Strip HTML tags if any residual tags exist
    cleaned = re.sub(r"<[^>]+>", " ", text)
    # Normalise whitespace
    cleaned = re.sub(r"\s+", " ", cleaned).strip()

    # Filter out repetitive metric badge noise (e.g., "3k 1.6m 3.2k 1.4m 2.4k 1.6m...")
    words = cleaned.split(" ")
    cleaned_words: list[str] = []
    stat_streak = 0
    metric_pattern = re.compile(r"^\d+(\.\d+)?[kmKMbB]?$", re.IGNORECASE)

    for word in words:
        clean_word = word.replace(",", "")
        if metric_pattern.match(clean_word):
            stat_streak += 1
            if stat_streak <= 2:
                cleaned_words.append(word)
        else:
            stat_streak = 0
            cleaned_words.append(word)

    return " ".join(cleaned_words).strip()


def calculate_word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.split())


def calculate_reading_time(word_count: int) -> int:
    # Standard average reading speed ~200 wpm
    wpm = 200
    minutes = word_count / wpm
    return max(1, int(minutes * 60)) if word_count > 0 else 0


def process_capture(memory_item_id_str: str) -> None:
    """RQ background job to clean text, compute word count & reading time, and mark item ready."""
    logger.info("Starting processing job for MemoryItem: %s", memory_item_id_str)
    db = SessionLocal()
    try:
        item_id = UUID(memory_item_id_str)
        item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
        if not item:
            logger.error("MemoryItem %s not found in DB.", memory_item_id_str)
            return

        item.status = ItemStatus.processing
        db.commit()

        # Clean content
        cleaned_content = clean_text(item.content)
        item.content = cleaned_content
        word_count = calculate_word_count(cleaned_content)
        item.word_count = word_count
        item.reading_time_seconds = calculate_reading_time(word_count)

        item.status = ItemStatus.ready
        db.commit()
        logger.info(
            "Successfully processed MemoryItem %s (words: %d, reading time: %ds)",
            memory_item_id_str,
            word_count,
            item.reading_time_seconds,
        )
    except Exception as exc:
        db.rollback()
        logger.exception("Error processing MemoryItem %s: %s", memory_item_id_str, exc)
        try:
            item_id = UUID(memory_item_id_str)
            item = db.query(MemoryItem).filter(MemoryItem.id == item_id).first()
            if item:
                item.status = ItemStatus.failed
                db.commit()
        except Exception:
            pass
    finally:
        db.close()
