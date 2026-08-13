import logging
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session as DBSession

from app.models.memory_item import ItemStatus, MemoryItem
from app.repositories.chunk_repository import ChunkRepository
from app.repositories.memory_repository import MemoryRepository
from app.schemas.memory_item import (
    MemoryItemCreate,
    MemoryItemListResponse,
    MemoryItemResponse,
)
from app.services.content_normalizer import extract_domain
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
        item = MemoryItem(
            user_id=user_id,
            source_type=payload.source_type,
            url=payload.url,
            title=payload.title,
            content=payload.content,
            author=payload.author,
            favicon_url=payload.favicon_url,
            thumbnail_url=payload.thumbnail_url,
            domain=extract_domain(payload.url),
            status=ItemStatus.pending,
        )
        item = self.repo.create(item)

        # Enqueue async processing job. Non-fatal if worker is not running.
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
                "Item will remain in 'pending' state until worker runs.",
                item.id,
            )

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
