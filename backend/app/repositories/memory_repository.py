from datetime import datetime, UTC
from uuid import UUID

from sqlalchemy import func, select
from sqlalchemy.orm import Session as DBSession

from app.models.memory_item import MemoryItem


class MemoryRepository:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def create(self, item: MemoryItem) -> MemoryItem:
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return item

    def get_by_id(self, item_id: UUID, user_id: UUID) -> MemoryItem | None:
        stmt = select(MemoryItem).where(
            MemoryItem.id == item_id,
            MemoryItem.user_id == user_id,
            MemoryItem.deleted_at.is_(None),
        )
        return self.db.execute(stmt).scalar_one_or_none()

    def list_for_user(
        self,
        user_id: UUID,
        page: int = 1,
        per_page: int = 20,
    ) -> tuple[list[MemoryItem], int]:
        base_stmt = select(MemoryItem).where(
            MemoryItem.user_id == user_id,
            MemoryItem.deleted_at.is_(None),
        )
        total: int = self.db.execute(
            select(func.count()).select_from(base_stmt.subquery())
        ).scalar_one()

        items = list(
            self.db.execute(
                base_stmt.order_by(MemoryItem.captured_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            ).scalars()
        )
        return items, total

    def soft_delete(self, item: MemoryItem) -> None:
        item.deleted_at = datetime.now(UTC)
        self.db.commit()

    def update(self, item: MemoryItem) -> MemoryItem:
        self.db.add(item)
        self.db.commit()
        self.db.refresh(item)
        return item
