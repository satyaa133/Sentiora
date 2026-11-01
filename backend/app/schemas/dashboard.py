from datetime import date, datetime

from pydantic import BaseModel

from app.models.memory_item import ItemStatus, SourceType


class DailyCount(BaseModel):
    date: date
    count: int


class DashboardStatistics(BaseModel):
    """Real counts of the user's own memories; nothing estimated or invented."""

    total: int
    today: int
    this_week: int
    by_source_type: dict[SourceType, int]
    by_status: dict[ItemStatus, int]
    # Ready items that have searchable chunks, i.e. what Ask can actually use.
    ready_for_ai: int
    # Oldest first, one entry per day (zeros included) in the requested zone.
    daily: list[DailyCount]
    last_captured_at: datetime | None
    timezone: str
