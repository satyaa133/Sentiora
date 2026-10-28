from fastapi import APIRouter, Depends, Request

from app.api.deps import get_settings
from app.core.config import Settings
from app.schemas.envelope import response_meta
from app.schemas.system import HealthData, HealthResponse

router = APIRouter(tags=["health"])


@router.get("/health", response_model=HealthResponse)
async def health(request: Request, settings: Settings = Depends(get_settings)) -> HealthResponse:
    return HealthResponse(
        success=True,
        data=HealthData(status="ok", service=settings.app_name),
        meta=response_meta(request),
    )
