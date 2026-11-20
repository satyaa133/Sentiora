from datetime import datetime
from typing import Literal
from uuid import UUID

from pydantic import BaseModel, Field

# Today's answer modes (memory/general/mixed, and "combined" from POST /chat),
# plus the instant/ai modes that arrive in REBUILD_PLAN S6.
FeedbackAnswerMode = Literal["memory", "general", "mixed", "combined", "instant", "ai"]


class AnswerFeedbackCreate(BaseModel):
    question: str = Field(..., min_length=2, max_length=2000)
    answer_mode: FeedbackAnswerMode
    rating: Literal[1, -1]
    comment: str | None = Field(default=None, max_length=1000)
    source_chunk_ids: list[UUID] = Field(default_factory=list, max_length=20)


class AnswerFeedbackResponse(BaseModel):
    id: UUID
    rating: int
    created_at: datetime
