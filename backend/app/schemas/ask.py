from datetime import datetime
from typing import Literal
from uuid import UUID
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from pydantic import BaseModel, ConfigDict, Field, field_validator

from app.models.memory_item import SourceType

AnswerMode = Literal["memory", "general", "combined"]


class AskTurn(BaseModel):
    """One earlier message, sent by the client so follow-ups keep their context."""

    role: Literal["user", "assistant"]
    content: str = Field(..., min_length=1, max_length=4000)


class AskRequest(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)
    source_type: SourceType | None = None
    memory_id: UUID | None = None
    top_k: int = Field(default=5, ge=1, le=8)
    history: list[AskTurn] = Field(default_factory=list, max_length=4)
    # IANA zone used for "today" / "yesterday" questions. Defaults to UTC.
    tz: str | None = Field(default=None, max_length=64)

    @field_validator("tz")
    @classmethod
    def validate_tz(cls, v: str | None) -> str | None:
        if v is None or not v.strip():
            return None
        try:
            ZoneInfo(v.strip())
        except (ZoneInfoNotFoundError, ValueError):
            raise ValueError("tz must be an IANA time zone such as Europe/Berlin") from None
        return v.strip()


class AskCitation(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    memory_id: UUID
    # None when the citation points at a whole capture (e.g. "what did I save
    # yesterday" lists captures, some of which are not chunked yet).
    chunk_id: UUID | None = None
    title: str
    url: str
    source_type: SourceType
    domain: str | None = None
    heading: str | None = None
    page_number: int | None = None
    # Transcript time range of the cited chunk, in seconds (video only).
    start_sec: float | None = None
    end_sec: float | None = None
    source_available: bool = True
    captured_at: datetime | None = None
    excerpt: str | None = None


class AskResponse(BaseModel):
    answer: str
    citations: list[AskCitation]
    insufficient_context: bool = False
    # True when the answer was derived locally from retrieved memory because
    # the configured LLM provider was missing or failed. Optional for clients.
    used_fallback: bool = False
    # memory: grounded in saved memory only. general: general knowledge, no
    # memory used. combined: general explanation plus a cited memory section.
    mode: AnswerMode = "memory"
    suggested_followups: list[str] = Field(default_factory=list)


class SearchHit(BaseModel):
    memory_id: UUID
    chunk_id: UUID
    title: str
    url: str
    source_type: SourceType
    content: str
    heading: str | None = None
    page_number: int | None = None
    start_sec: float | None = None
    end_sec: float | None = None
    captured_at: datetime
    distance: float | None = None
