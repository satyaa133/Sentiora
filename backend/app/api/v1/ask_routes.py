"""Ask routes — POST /chat and GET /search.

Error hierarchy:
  LLMNotConfiguredError  → HTTP 503  AI_NOT_CONFIGURED
    (only when no retrieved memory can be used for a local fallback)
  LLMProviderError       → HTTP 503  AI_PROVIDER_UNAVAILABLE (credits, key, quota, overload)
                         → HTTP 502  ASK_LLM_FAILED (anything else)
    (raised only when no matching memory could answer locally)
  Any other exception    → HTTP 502  ASK_SYSTEM_FAILED
"""

from __future__ import annotations

import logging
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.memory_item import SourceType
from app.models.user import User
from app.schemas.ask import AskRequest, AskResponse, SearchHit
from app.schemas.envelope import APIResponse, response_meta
from app.core.rate_limit import limit_chat, limit_search
from app.services.rag_service import LLMNotConfiguredError, LLMProviderError, RagService
from app.services.retrieval_service import RetrievalService

router = APIRouter(tags=["Ask Sentiora"])
logger = logging.getLogger(__name__)



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
            history=req.history,
            tz=req.tz,
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
        # Provider error text can include upstream details; it stays in the log.
        logger.exception("Ask LLM provider failed")
        if exc.provider_unavailable:
            # Out of credits, bad key, quota or overload: retrying won't help soon.
            raise HTTPException(
                status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
                detail={
                    "code": "AI_PROVIDER_UNAVAILABLE",
                    "message": (
                        "The AI provider is unavailable right now (for example it is "
                        "out of credits or rate-limited). Questions about your saved "
                        "memories still work; general questions need the provider."
                    ),
                },
            ) from None
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail={
                "code": "ASK_LLM_FAILED",
                "message": (
                    "Sentiora could not generate an AI answer because the language "
                    "model failed. Your memories were retrieved; try again "
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
    return APIResponse(data=data, meta=response_meta(request))


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
    limit_search(request, str(current_user.id))
    retrieval = RetrievalService(db)
    chunks = retrieval.retrieve_relevant_memories(
        user_id=current_user.id,
        query=q,
        top_k=top_k,
        source_type=source_type,
    )
    # Retrieval already drops vector hits below RAG_MIN_SIMILARITY and
    # full-text hits that match too few query terms.
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
            start_sec=chunk.start_sec,
            end_sec=chunk.end_sec,
            captured_at=chunk.captured_at,
            distance=chunk.distance,
        )
        for chunk in chunks
    ]
    return APIResponse(data=hits, meta=response_meta(request))
