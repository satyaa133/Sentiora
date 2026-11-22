"""Enrichment job (queue ``sentiora.enrich``, REBUILD_PLAN S5).

A failed attempt is retried after 1 min, 5 min, 30 min and 6 h; after that the
save is marked ``enrichment_status = failed`` (it stays searchable; the user
can ask again). A provider outage therefore only delays enrichment.
"""

from __future__ import annotations

import logging
from datetime import UTC, datetime, timedelta
from uuid import UUID

from sqlalchemy import select

from app.core.db import SessionLocal
from app.models.memory_item import EnrichmentStatus, ItemStatus, MemoryItem
from app.services.enrichment_service import (
    EnrichmentError,
    EnrichmentService,
    enqueue_enrichment,
    enrichment_job_pending,
)

logger = logging.getLogger(__name__)

RETRY_DELAYS = (
    timedelta(minutes=1),
    timedelta(minutes=5),
    timedelta(minutes=30),
    timedelta(hours=6),
)
# A save still queued this long after its request lost its job (Redis was
# down when it was queued); the worker queues it again on start.
STALE_AFTER = timedelta(minutes=15)


def enrich_memory(memory_item_id_str: str, attempt: int = 0) -> None:
    db = SessionLocal()
    try:
        item = db.get(MemoryItem, UUID(memory_item_id_str))
        if (
            item is None
            or item.deleted_at is not None
            or item.status != ItemStatus.ready
            or item.enrichment_status != EnrichmentStatus.queued
        ):
            return
        service = EnrichmentService(db)
        try:
            service.enrich_now(item)
        except EnrichmentError as exc:
            db.rollback()
            if attempt < len(RETRY_DELAYS):
                delay = RETRY_DELAYS[attempt]
                logger.warning(
                    "memory_id=%s stage=enrich failed attempt=%d retry_in=%ds reason=%s",
                    memory_item_id_str,
                    attempt,
                    int(delay.total_seconds()),
                    exc,
                )
                enqueue_enrichment(item.id, delay=delay, attempt=attempt + 1)
                return
            item.enrichment_status = EnrichmentStatus.failed.value
            db.commit()
            logger.error(
                "memory_id=%s stage=enrich gave_up attempts=%d reason=%s",
                memory_item_id_str,
                attempt + 1,
                exc,
            )
            return
        logger.info("memory_id=%s stage=enrich ready", memory_item_id_str)
    finally:
        db.close()


def recover_stale_enrichments() -> int:
    """Queue again saves left ``queued`` with no job (Redis was down)."""
    db = SessionLocal()
    try:
        cutoff = datetime.now(UTC) - STALE_AFTER
        ids = list(
            db.execute(
                select(MemoryItem.id).where(
                    MemoryItem.enrichment_status == EnrichmentStatus.queued.value,
                    MemoryItem.status == ItemStatus.ready,
                    MemoryItem.deleted_at.is_(None),
                    MemoryItem.enrich_requested_at < cutoff,
                )
            ).scalars()
        )
    finally:
        db.close()
    recovered = 0
    for memory_id in ids:
        if not enrichment_job_pending(memory_id) and enqueue_enrichment(memory_id):
            recovered += 1
    return recovered
