from datetime import datetime, UTC
from typing import Any, Generic, TypeVar

from pydantic import BaseModel, Field

T = TypeVar("T")


def current_utc_timestamp() -> datetime:
    return datetime.now(UTC)


class ResponseMeta(BaseModel):
    timestamp: datetime = Field(default_factory=current_utc_timestamp)
    request_id: str = Field(default="req_default")


class APIResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T
    meta: ResponseMeta = Field(default_factory=ResponseMeta)


class ErrorDetailItem(BaseModel):
    field: str
    issue: str


class ErrorPayload(BaseModel):
    code: str
    message: str
    details: Any | None = None


class APIErrorResponse(BaseModel):
    success: bool = False
    error: ErrorPayload
    meta: ResponseMeta = Field(default_factory=ResponseMeta)
