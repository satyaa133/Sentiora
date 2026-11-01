from dataclasses import dataclass
from datetime import date, datetime, UTC
from typing import Any, cast
from uuid import UUID

from sqlalchemy import ColumnElement, Select, func, or_, select
from sqlalchemy.orm import Session as DBSession

from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem, SourceType


@dataclass(frozen=True)
class MemoryFilters:
    """Optional list filters; every query is still scoped to one user."""

    source_type: SourceType | None = None
    status: ItemStatus | None = None
    date_from: datetime | None = None  # inclusive
    date_to: datetime | None = None  # exclusive
    q: str | None = None  # metadata only: title, domain, url


def _escape_like(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


# Generic over the statement so the annotation holds on SQLAlchemy 2.0 and 2.1,
# which type select(MemoryItem) differently.
def apply_memory_filters[S: Select[Any]](stmt: S, filters: MemoryFilters | None) -> S:
    if filters is None:
        return stmt
    if filters.source_type is not None:
        stmt = stmt.where(MemoryItem.source_type == filters.source_type)
    if filters.status is not None:
        stmt = stmt.where(MemoryItem.status == filters.status)
    if filters.date_from is not None:
        stmt = stmt.where(MemoryItem.captured_at >= filters.date_from)
    if filters.date_to is not None:
        stmt = stmt.where(MemoryItem.captured_at < filters.date_to)
    if filters.q:
        pattern = f"%{_escape_like(filters.q)}%"
        stmt = stmt.where(
            or_(
                MemoryItem.title.ilike(pattern, escape="\\"),
                MemoryItem.domain.ilike(pattern, escape="\\"),
                MemoryItem.url.ilike(pattern, escape="\\"),
            )
        )
    return stmt


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
        filters: MemoryFilters | None = None,
    ) -> tuple[list[MemoryItem], int]:
        base_stmt = apply_memory_filters(
            select(MemoryItem).where(
                MemoryItem.user_id == user_id,
                MemoryItem.deleted_at.is_(None),
            ),
            filters,
        )
        total: int = self.db.execute(
            select(func.count()).select_from(base_stmt.subquery())
        ).scalar_one()

        items: list[MemoryItem] = list(
            self.db.execute(
                base_stmt.order_by(MemoryItem.captured_at.desc(), MemoryItem.id.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            ).scalars()
        )
        return items, total

    def _live(self, user_id: UUID) -> list[ColumnElement[bool]]:
        return [MemoryItem.user_id == user_id, MemoryItem.deleted_at.is_(None)]

    def count_since(self, user_id: UUID, since: datetime) -> int:
        return int(
            self.db.execute(
                select(func.count(MemoryItem.id)).where(
                    *self._live(user_id), MemoryItem.captured_at >= since
                )
            ).scalar_one()
        )

    def counts_by_source_type(self, user_id: UUID) -> dict[SourceType, int]:
        rows = self.db.execute(
            select(MemoryItem.source_type, func.count(MemoryItem.id))
            .where(*self._live(user_id))
            .group_by(MemoryItem.source_type)
        ).all()
        return {source: int(count) for source, count in rows}

    def counts_by_status(self, user_id: UUID) -> dict[ItemStatus, int]:
        rows = self.db.execute(
            select(MemoryItem.status, func.count(MemoryItem.id))
            .where(*self._live(user_id))
            .group_by(MemoryItem.status)
        ).all()
        return {item_status: int(count) for item_status, count in rows}

    def count_ready_for_ai(self, user_id: UUID) -> int:
        """Ready items that have at least one chunk, so retrieval can use them."""
        has_chunk = (
            select(MemoryChunk.id)
            .where(MemoryChunk.memory_id == MemoryItem.id, MemoryChunk.user_id == user_id)
            .exists()
        )
        return int(
            self.db.execute(
                select(func.count(MemoryItem.id)).where(
                    *self._live(user_id), MemoryItem.status == ItemStatus.ready, has_chunk
                )
            ).scalar_one()
        )

    def daily_counts(self, user_id: UUID, since: datetime, tz_name: str) -> dict[date, int]:
        # tz_name is validated against the IANA database by the caller and is
        # sent as a bound parameter.
        local_day = func.date(func.timezone(tz_name, MemoryItem.captured_at))
        rows = self.db.execute(
            select(local_day, func.count(MemoryItem.id))
            .where(*self._live(user_id), MemoryItem.captured_at >= since)
            .group_by(local_day)
        ).all()
        return {day: int(count) for day, count in cast(list[tuple[date, int]], rows)}

    def latest_captured_at(self, user_id: UUID) -> datetime | None:
        return self.db.execute(
            select(func.max(MemoryItem.captured_at)).where(
                MemoryItem.user_id == user_id,
                MemoryItem.deleted_at.is_(None),
            )
        ).scalar_one_or_none()

    def soft_delete(self, item: MemoryItem) -> None:
        item.deleted_at = datetime.now(UTC)
        self.db.commit()
