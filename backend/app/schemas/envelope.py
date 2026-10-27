from datetime import datetime, UTC
from typing import Generic, TypeVar
from uuid import uuid4

from fastapi import Request
from pydantic import BaseModel, Field

T = TypeVar("T")


def current_utc_timestamp() -> datetime:
    return datetime.now(UTC)


class ResponseMeta(BaseModel):
    timestamp: datetime = Field(default_factory=current_utc_timestamp)
    request_id: str = Field(default="req_default")


def response_meta(request: Request) -> ResponseMeta:
    """Envelope meta carrying the id assigned by the request-id middleware."""
    request_id = getattr(request.state, "request_id", f"req_{uuid4().hex[:8]}")
    return ResponseMeta(request_id=request_id)


class APIResponse(BaseModel, Generic[T]):
    success: bool = True
    data: T
    meta: ResponseMeta = Field(default_factory=ResponseMeta)
