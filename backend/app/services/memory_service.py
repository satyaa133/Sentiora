import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from datetime import datetime, UTC
from app.models.memory_item import ItemStatus, MemoryItem
from app.repositories.chunk_repository import ChunkRepository
from app.repositories.memory_repository import MemoryRepository
from app.schemas.memory_item import (
    MemoryItemCreate,
    MemoryItemListResponse,
    MemoryItemResponse,
)
from app.services.content_normalizer import extract_domain, canonicalize_url, compute_content_hash, normalize_content
from app.workers.queue import create_queues

logger = logging.getLogger(__name__)


class MemoryService:
    def __init__(self, db: DBSession) -> None:
        self.db = db
        self.repo = MemoryRepository(db)
        self.chunk_repo = ChunkRepository(db)

    def create_item(
        self, user_id: UUID, payload: MemoryItemCreate
    ) -> MemoryItemResponse:
        # Perform URL normalization & parameter filtering
        canonical_url = canonicalize_url(payload.url)
        
        # Determine extraction metadata values
        ext_method = payload.extraction.method if payload.extraction else None
        ext_status = payload.extraction.status if payload.extraction else None
        ext_score = payload.extraction.quality_score if payload.extraction else None
        ext_reasons = payload.extraction.quality_reasons if payload.extraction else None

        # Build clean plain text content
        raw_text = payload.content or ""
        normalized_content = normalize_content(raw_text, payload.source_type)

        # Basic verification: do not treat fabricated fallback content as a meaningful capture
        if not normalized_content or normalized_content.strip() == "":
            ext_status = "failed"
            ext_score = 0.0
            if ext_reasons is None:
                ext_reasons = []
            if "insufficient_content" not in ext_reasons:
                ext_reasons.append("insufficient_content")
        
        # Calculate fingerprint hash based on the normalized plain text
        c_hash = compute_content_hash(normalized_content)

        # Deduplicate identical captures
        existing = (
            self.db.query(MemoryItem)
            .filter(
                MemoryItem.user_id == user_id,
                MemoryItem.url == canonical_url,
                MemoryItem.status != ItemStatus.failed,
                MemoryItem.deleted_at.is_(None)
            )
            .order_by(MemoryItem.created_at.desc())
            .first()
        )
        if existing:
            return MemoryItemResponse.model_validate(existing)

        # Client vs server timestamps
        client_captured_at = payload.captured_at or datetime.now(UTC)
        server_received_at = datetime.now(UTC)

        item = MemoryItem(
            user_id=user_id,
            source_type=payload.source_type,
            url=canonical_url,
            title=payload.title,
            content=normalized_content,
            author=payload.author,
            favicon_url=payload.favicon_url,
            thumbnail_url=payload.thumbnail_url,
            domain=extract_domain(canonical_url),
            status=ItemStatus.pending,
            
            # Populate Capture v2 fields
            structured_content=[node.model_dump() for node in payload.structured_content] if payload.structured_content else None,
            content_hash=c_hash,
            extraction_method=ext_method,
            extraction_status=ext_status,
            extraction_quality_score=ext_score,
            extraction_quality_reasons=ext_reasons,
            raw_content_length=len(raw_text),
            captured_at=client_captured_at,
            received_at=server_received_at,
        )
        item = self.repo.create(item)

        # Enqueue via RQ (primary path). Inline process only if Redis/RQ is down.
        try:
            queues = create_queues()
            queues[0].enqueue(
                "app.workers.jobs.process_capture.process_capture",
                str(item.id),
                job_timeout=120,
            )
        except Exception:
            logger.warning(
                "Could not enqueue process_capture job for item %s. "
                "Processing inline so the capture can still become READY.",
                item.id,
            )
            from app.workers.jobs.process_capture import process_capture

            process_capture(str(item.id))
            self.db.refresh(item)

        return MemoryItemResponse.model_validate(item)

    def list_items(
        self, user_id: UUID, page: int = 1, per_page: int = 20
    ) -> MemoryItemListResponse:
        items, total = self.repo.list_for_user(user_id, page=page, per_page=per_page)
        return MemoryItemListResponse(
            items=[MemoryItemResponse.model_validate(i) for i in items],
            total=total,
            page=page,
            per_page=per_page,
            has_more=(page * per_page) < total,
        )

    def get_item(self, item_id: UUID, user_id: UUID) -> MemoryItemResponse:
        item = self.repo.get_by_id(item_id, user_id)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "MEMORY_ITEM_NOT_FOUND",
                    "message": "Memory item not found or you do not have access.",
                },
            )
        return MemoryItemResponse.model_validate(item)

    def delete_item(self, item_id: UUID, user_id: UUID) -> None:
        item = self.repo.get_by_id(item_id, user_id)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "MEMORY_ITEM_NOT_FOUND",
                    "message": "Memory item not found or you do not have access.",
                },
            )
        self.chunk_repo.delete_for_memory(item.id, user_id)
        self.repo.soft_delete(item)
