"""Ask routes — POST /chat and GET /search.

Error hierarchy:
  LLMNotConfiguredError  → HTTP 503  AI_NOT_CONFIGURED
    (only when no retrieved memory can be used for a local fallback)
  Any other exception    → HTTP 502  ASK_SYSTEM_FAILED
"""

from __future__ import annotations

import logging
import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.memory_item import SourceType
from app.models.user import User
from app.schemas.ask import AskRequest, AskResponse, SearchHit
from app.schemas.envelope import APIResponse, ResponseMeta
from app.core.rate_limit import limit_chat
from app.services.rag_service import LLMNotConfiguredError, LLMProviderError, RagService
from app.services.retrieval_service import RetrievalService

router = APIRouter(tags=["Ask Sentiora"])
logger = logging.getLogger(__name__)


def _meta(request: Request) -> ResponseMeta:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex[:8]}")
    return ResponseMeta(request_id=request_id)


@router.post(
    "/chat",
    response_model=APIResponse[AskResponse],
    status_code=status.HTTP_200_OK,
    summary="Ask a question against the current user's memories",
)
def ask_memories(
    req: AskRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> APIResponse[AskResponse]:
    service = RagService(RetrievalService(db))
    limit_chat(request, str(current_user.id))
    try:
        data = service.ask(
            user_id=current_user.id,
            question=req.question,
            source_type=req.source_type,
            top_k=req.top_k,
            memory_id=req.memory_id,
        )
    except LLMNotConfiguredError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "AI_NOT_CONFIGURED",
                "message": (
                    "Sentiora AI is not configured and no saved memory could be "
                    "used to answer. Set LLM_PROVIDER and the corresponding API "
                    "key (OPENAI_API_KEY or GEMINI_API_KEY), then retry."
                ),
            },
        ) from None
    except LLMProviderError as exc:
        logger.exception("Ask LLM provider failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "ASK_LLM_FAILED",
                "message": (
                    "Sentiora could not generate an AI answer because the language "
                    f"model failed ({exc}). Your memories were retrieved; try again "
                    "in a moment."
                ),
            },
        ) from None
    except Exception:
        logger.exception("Ask retrieval/system failed")
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "ASK_SYSTEM_FAILED",
                "message": (
                    "Sentiora could not complete this question because of a "
                    "server error during retrieval. This is not an AI-key "
                    "configuration problem."
                ),
            },
        ) from None
    return APIResponse(data=data, meta=_meta(request))


@router.get(
    "/search",
    response_model=APIResponse[list[SearchHit]],
    status_code=status.HTTP_200_OK,
    summary="Semantic search over the current user's memory chunks",
)
def search_memories(
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
    q: str = Query(..., min_length=2, max_length=500),
    source_type: SourceType | None = Query(default=None),
    top_k: int = Query(default=8, ge=1, le=20),
) -> APIResponse[list[SearchHit]]:
    retrieval = RetrievalService(db)
    chunks = retrieval.retrieve_relevant_memories(
        user_id=current_user.id,
        query=q,
        top_k=top_k,
        source_type=source_type,
    )
    hits = [
        SearchHit(
            memory_id=chunk.memory_id,
            chunk_id=chunk.chunk_id,
            title=chunk.title,
            url=chunk.url,
            source_type=chunk.source_type,
            content=chunk.content,
            heading=chunk.heading,
            page_number=chunk.page_number,
            captured_at=chunk.captured_at,
            distance=chunk.distance,
        )
        for chunk in chunks
    ]
    return APIResponse(data=hits, meta=_meta(request))
