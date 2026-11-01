import uuid
from datetime import datetime
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.memory_item import ItemStatus, SourceType
from app.models.user import User
from app.repositories.memory_repository import MemoryFilters
from app.schemas.envelope import APIResponse, response_meta
from app.schemas.memory_item import (
    MemoryItemCreate,
    MemoryItemListResponse,
    MemoryItemResponse,
)
from app.services.memory_service import MemoryService

router = APIRouter(prefix="/memory-items", tags=["Memory Items"])



@router.post(
    "",
    response_model=APIResponse[MemoryItemResponse],
    status_code=status.HTTP_201_CREATED,
    summary="Ingest a captured memory item",
)
def create_memory_item(
    req: MemoryItemCreate,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> APIResponse[MemoryItemResponse]:
    service = MemoryService(db)
    data = service.create_item(current_user.id, req)
    return APIResponse(data=data, meta=response_meta(request))


@router.get(
    "",
    response_model=APIResponse[MemoryItemListResponse],
    status_code=status.HTTP_200_OK,
    summary="List memory items for the current user",
)
def list_memory_items(
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=20, ge=1, le=100),
    source_type: SourceType | None = Query(default=None),
    item_status: ItemStatus | None = Query(default=None, alias="status"),
    date_from: datetime | None = Query(default=None, description="Inclusive, ISO 8601"),
    date_to: datetime | None = Query(default=None, description="Exclusive, ISO 8601"),
    q: str | None = Query(
        default=None, max_length=200, description="Metadata match on title, domain and URL"
    ),
) -> APIResponse[MemoryItemListResponse]:
    if date_from and date_to and date_from >= date_to:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_CONTENT,
            detail={
                "code": "VALIDATION_ERROR",
                "message": "date_from must be earlier than date_to.",
            },
        )
    filters = MemoryFilters(
        source_type=source_type,
        status=item_status,
        date_from=date_from,
        date_to=date_to,
        q=(q or "").strip() or None,
    )
    service = MemoryService(db)
    data = service.list_items(current_user.id, page=page, per_page=per_page, filters=filters)
    return APIResponse(data=data, meta=response_meta(request))


@router.get(
    "/{item_id}",
    response_model=APIResponse[MemoryItemResponse],
    status_code=status.HTTP_200_OK,
    summary="Get a specific memory item",
)
def get_memory_item(
    item_id: uuid.UUID,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> APIResponse[MemoryItemResponse]:
    service = MemoryService(db)
    data = service.get_item(item_id, current_user.id)
    return APIResponse(data=data, meta=response_meta(request))


@router.delete(
    "/{item_id}",
    status_code=status.HTTP_200_OK,
    summary="Soft delete a memory item",
)
def delete_memory_item(
    item_id: uuid.UUID,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    service = MemoryService(db)
    service.delete_item(item_id, current_user.id)
    return {
        "success": True,
        "data": {"message": "Memory item deleted successfully."},
        "meta": response_meta(request).model_dump(),
    }
