from datetime import datetime
from uuid import UUID

from pydantic import BaseModel, ConfigDict, Field

from app.models.memory_item import SourceType


class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)
    source_type: SourceType | None = None
    memory_id: UUID | None = None
    top_k: int = Field(default=5, ge=1, le=8)


class AskCitation(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    memory_id: UUID
    chunk_id: UUID
    title: str
    url: str
    source_type: SourceType
    domain: str | None = None
    heading: str | None = None
    page_number: int | None = None
    source_available: bool = True


class AskResponse(BaseModel):
    answer: str
    citations: list[AskCitation]
    insufficient_context: bool = False
    # True when the answer was derived locally from retrieved memory because
    # the configured LLM provider was missing or failed. Optional for clients.
    used_fallback: bool = False


class SearchHit(BaseModel):
    memory_id: UUID
    chunk_id: UUID
    title: str
    url: str
    source_type: SourceType
    content: str
    heading: str | None = None
    page_number: int | None = None
    captured_at: datetime
    distance: float | None = None
