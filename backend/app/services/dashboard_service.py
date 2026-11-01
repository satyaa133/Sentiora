"""Dashboard statistics: real aggregates over the user's own memories."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from uuid import UUID
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session as DBSession

from app.models.memory_item import ItemStatus, SourceType
from app.repositories.memory_repository import MemoryRepository
from app.schemas.dashboard import DailyCount, DashboardStatistics

DAILY_WINDOW_DAYS = 14


class DashboardService:
    def __init__(self, db: DBSession) -> None:
        self.repo = MemoryRepository(db)

    def statistics(
        self, user_id: UUID, tz_name: str = "UTC", now: datetime | None = None
    ) -> DashboardStatistics:
        zone = ZoneInfo(tz_name)
        local_now = (now or datetime.now(UTC)).astimezone(zone)
        today = local_now.replace(hour=0, minute=0, second=0, microsecond=0)
        week_start = today - timedelta(days=today.weekday())
        window_start = today - timedelta(days=DAILY_WINDOW_DAYS - 1)

        by_source = self.repo.counts_by_source_type(user_id)
        by_status = self.repo.counts_by_status(user_id)
        daily = self.repo.daily_counts(user_id, window_start.astimezone(UTC), tz_name)
        days = [(window_start + timedelta(days=offset)).date() for offset in range(DAILY_WINDOW_DAYS)]

        return DashboardStatistics(
            total=sum(by_status.values()),
            today=self.repo.count_since(user_id, today.astimezone(UTC)),
            this_week=self.repo.count_since(user_id, week_start.astimezone(UTC)),
            by_source_type={source: by_source.get(source, 0) for source in SourceType},
            by_status={item_status: by_status.get(item_status, 0) for item_status in ItemStatus},
            ready_for_ai=self.repo.count_ready_for_ai(user_id),
            daily=[DailyCount(date=day, count=daily.get(day, 0)) for day in days],
            last_captured_at=self.repo.latest_captured_at(user_id),
            timezone=tz_name,
        )
