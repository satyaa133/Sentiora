import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, Query, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.envelope import APIResponse, ResponseMeta
from app.schemas.memory_item import (
    MemoryItemCreate,
    MemoryItemListResponse,
    MemoryItemResponse,
)
from app.services.memory_service import MemoryService

router = APIRouter(prefix="/memory-items", tags=["Memory Items"])


def _meta(request: Request) -> ResponseMeta:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex[:8]}")
    return ResponseMeta(request_id=request_id)


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
    return APIResponse(data=data, meta=_meta(request))


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
) -> APIResponse[MemoryItemListResponse]:
    service = MemoryService(db)
    data = service.list_items(current_user.id, page=page, per_page=per_page)
    return APIResponse(data=data, meta=_meta(request))


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
    return APIResponse(data=data, meta=_meta(request))


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
        "meta": _meta(request).model_dump(),
    }
