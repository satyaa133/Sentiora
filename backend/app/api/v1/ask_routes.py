"""Ask routes — POST /chat, POST /chat/stream (SSE) and GET /search.

Error hierarchy:
  LLMNotConfiguredError  → HTTP 503  AI_NOT_CONFIGURED
    (only when no retrieved memory can be used for a local fallback)
  LLMProviderError       → HTTP 503  AI_PROVIDER_UNAVAILABLE (credits, key, quota, overload)
                         → HTTP 502  ASK_LLM_FAILED (anything else)
    (raised only when no matching memory could answer locally)
  Any other exception    → HTTP 502  ASK_SYSTEM_FAILED
"""

from __future__ import annotations

import json
import logging
from collections.abc import Iterator
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import StreamingResponse
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


_PROVIDER_UNAVAILABLE = {
    "code": "AI_PROVIDER_UNAVAILABLE",
    "message": (
        "The AI provider is unavailable right now (for example it is "
        "out of credits or rate-limited). Questions about your saved "
        "memories still work; general questions need the provider."
    ),
}
_LLM_FAILED = {
    "code": "ASK_LLM_FAILED",
    "message": (
        "Sentiora could not generate an AI answer because the language "
        "model failed. Your memories were retrieved; try again "
        "in a moment."
    ),
}
_SYSTEM_FAILED = {
    "code": "ASK_SYSTEM_FAILED",
    "message": (
        "Sentiora could not complete this question because of a "
        "server error during retrieval. This is not an AI-key "
        "configuration problem."
    ),
}


def _ask_error(exc: Exception) -> HTTPException:
    """Map an Ask failure to the documented HTTP error (details stay in the log)."""
    if isinstance(exc, LLMNotConfiguredError):
        return HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={
                "code": "AI_NOT_CONFIGURED",
                "message": (
                    "Sentiora AI is not configured and no saved memory could be "
                    "used to answer. Set LLM_PROVIDER and the corresponding API "
                    "key (OPENAI_API_KEY or GEMINI_API_KEY), then retry."
                ),
            },
        )
    if isinstance(exc, LLMProviderError):
        # Provider error text can include upstream details; it stays in the log.
        logger.exception("Ask LLM provider failed", exc_info=exc)
        if exc.provider_unavailable:
            # Out of credits, bad key, quota or overload: retrying won't help soon.
            return HTTPException(
                status.HTTP_503_SERVICE_UNAVAILABLE, detail=_PROVIDER_UNAVAILABLE
            )
        return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=_LLM_FAILED)
    logger.exception("Ask retrieval/system failed", exc_info=exc)
    return HTTPException(status.HTTP_502_BAD_GATEWAY, detail=_SYSTEM_FAILED)


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
    except Exception as exc:
        raise _ask_error(exc) from None
    return APIResponse(data=data, meta=response_meta(request))


def _sse(name: str, data: dict[str, object]) -> str:
    return f"event: {name}\ndata: {json.dumps(data, separators=(',', ':'))}\n\n"


@router.post(
    "/chat/stream",
    status_code=status.HTTP_200_OK,
    summary="Ask a question and stream the answer as server-sent events",
    response_class=StreamingResponse,
)
def ask_memories_stream(
    req: AskRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> StreamingResponse:
    """Events: ``sources``, ``delta`` (text pieces), then ``final`` or ``error``.

    Retrieval runs before the response starts, so database and validation
    errors are normal HTTP errors; only model failures arrive as ``error``.
    """
    service = RagService(RetrievalService(db))
    limit_chat(request, str(current_user.id))
    try:
        prepared = service.prepare(
            user_id=current_user.id,
            question=req.question,
            source_type=req.source_type,
            top_k=req.top_k,
            memory_id=req.memory_id,
            history=req.history,
            tz=req.tz,
        )
    except Exception as exc:
        raise _ask_error(exc) from None

    def events() -> Iterator[str]:
        try:
            for event in service.run(prepared, stream=True):
                yield _sse(event.name, event.data)
        except Exception as exc:
            error = _ask_error(exc)
            detail: dict[str, object] = (
                error.detail if isinstance(error.detail, dict) else {}
            )
            yield _sse("error", {**detail, "status": error.status_code})

    return StreamingResponse(
        events(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


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
