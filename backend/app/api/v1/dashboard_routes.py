"""Dashboard routes: GET /dashboard/statistics (API spec §19)."""

from typing import Annotated
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.dashboard import DashboardStatistics
from app.schemas.envelope import APIResponse, response_meta
from app.services.dashboard_service import DashboardService

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get(
    "/statistics",
    response_model=APIResponse[DashboardStatistics],
    status_code=status.HTTP_200_OK,
    summary="Aggregate memory statistics for the current user",
)
def get_statistics(
    request: Request,
    response: Response,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    tz: str = Query(default="UTC", max_length=64, description="IANA time zone for day buckets"),
) -> APIResponse[DashboardStatistics]:
    try:
        ZoneInfo(tz)
    except (ZoneInfoNotFoundError, ValueError):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "tz must be an IANA time zone such as Europe/Berlin.",
            },
        ) from None
    data = DashboardService(db).statistics(current_user.id, tz)
    # Per-user data: only the browser may cache it, and only briefly.
    response.headers["Cache-Control"] = "private, max-age=30"
    return APIResponse(data=data, meta=response_meta(request))
