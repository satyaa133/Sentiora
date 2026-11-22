import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from datetime import datetime, UTC
from app.models.memory_item import ItemStatus, MemoryItem
from app.repositories.chunk_repository import ChunkRepository
from app.repositories.memory_repository import MemoryFilters, MemoryRepository
from app.schemas.memory_item import (
    MemoryItemCreate,
    MemoryItemListResponse,
    MemoryItemResponse,
)
from app.core.sensitive_domains import is_sensitive_url
from app.services.content_normalizer import extract_domain, canonicalize_url, compute_content_hash, normalize_content
from app.services.privacy_service import CONSENT_REQUIRED_DETAIL
from app.services.enrichment_service import (
    EnrichmentService,
    RequestResult,
    forget_enrichment,
)
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
        if is_sensitive_url(canonical_url, payload.source_type):
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "CAPTURE_SENSITIVE_BLOCKED",
                    "message": "This URL is protected and cannot be saved as a memory.",
                },
            )
        
        # Determine extraction metadata values
        ext_method = payload.extraction.method if payload.extraction else None
        ext_status = payload.extraction.status if payload.extraction else None
        ext_score = payload.extraction.quality_score if payload.extraction else None
        ext_reasons = payload.extraction.quality_reasons if payload.extraction else None

        # Build clean plain text content
        raw_text = payload.content or ""
        if not raw_text and payload.structured_content:
            raw_text = "\n\n".join(node.text for node in payload.structured_content if node.text)

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
            if payload.enrich:
                EnrichmentService(self.db).request(existing, force=True)
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
        if payload.enrich:
            # Marked queued now; the capture job starts it once the save is ready.
            EnrichmentService(self.db).request(item, force=True)

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
        self,
        user_id: UUID,
        page: int = 1,
        per_page: int = 20,
        filters: MemoryFilters | None = None,
    ) -> MemoryItemListResponse:
        items, total = self.repo.list_for_user(
            user_id, page=page, per_page=per_page, filters=filters
        )
        return MemoryItemListResponse(
            items=[MemoryItemResponse.model_validate(i) for i in items],
            total=total,
            page=page,
            per_page=per_page,
            has_more=(page * per_page) < total,
        )

    def _owned(self, item_id: UUID, user_id: UUID) -> MemoryItem:
        item = self.repo.get_by_id(item_id, user_id)
        if not item:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail={
                    "code": "MEMORY_ITEM_NOT_FOUND",
                    "message": "Memory item not found or you do not have access.",
                },
            )
        return item

    def get_item(self, item_id: UUID, user_id: UUID) -> MemoryItemResponse:
        item = self._owned(item_id, user_id)
        # Opening a save in the app is a sign it matters: enrich it (lazily,
        # within the daily cap; never blocks or fails the request).
        EnrichmentService(self.db).request_for_memories(user_id, [item.id])
        return MemoryItemResponse.model_validate(item)

    def rename_item(self, item_id: UUID, user_id: UUID, title: str) -> MemoryItemResponse:
        """New title for one of the user's saves (searchable at once: title_tsv)."""
        item = self._owned(item_id, user_id)
        item.title = title
        self.db.commit()
        self.db.refresh(item)
        return MemoryItemResponse.model_validate(item)

    def enrich_item(self, item_id: UUID, user_id: UUID) -> MemoryItemResponse:
        """Queue enrichment the user asked for (Summarise button, Save now)."""
        item = self._owned(item_id, user_id)
        result = EnrichmentService(self.db).request(item, force=True)
        if result == RequestResult.already_queued:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail={
                    "code": "ENRICHMENT_ALREADY_QUEUED",
                    "message": "This save is already being summarised.",
                },
            )
        if result == RequestResult.over_daily_limit:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail={
                    "code": "RATE_LIMITED",
                    "message": "Daily summary limit reached. Try again tomorrow.",
                },
            )
        if result == RequestResult.consent_required:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN, detail=CONSENT_REQUIRED_DETAIL
            )
        if result == RequestResult.not_available:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
                detail={
                    "code": "VALIDATION_ERROR",
                    "message": "This save has no content to summarise.",
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
        forget_enrichment(self.db, item)
        self.chunk_repo.delete_for_memory(item.id, user_id)
        self.repo.soft_delete(item)
