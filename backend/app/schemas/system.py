from typing import Literal

from pydantic import BaseModel, Field

from app.schemas.envelope import ResponseMeta


class HealthData(BaseModel):
    status: Literal["ok"] = "ok"
    service: str = Field(min_length=1)


class HealthResponse(BaseModel):
    success: Literal[True] = True
    data: HealthData
    meta: ResponseMeta
