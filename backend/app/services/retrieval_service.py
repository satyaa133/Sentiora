"""Retrieval service — semantic (vector) and lexical fallback search.

Security: ALL queries are scoped to the authenticated user's user_id.
User A can never retrieve User B's memories.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.services.embedding_service import get_embedding_adapter

_DOCUMENT_CONTEXT_HINTS = (
    "summarize",
    "summary",
    "key details",
    "key points",
    "explain",
    "walk through",
    "walk me through",
)


def needs_document_context(query: str) -> bool:
    """True when the question needs more of a single source, not just a snippet."""
    lower = (query or "").lower()
    return any(hint in lower for hint in _DOCUMENT_CONTEXT_HINTS)


logger = logging.getLogger(__name__)

_STOPWORDS = {
    "about",
    "what",
    "which",
    "when",
    "where",
    "this",
    "that",
    "with",
    "from",
    "have",
    "does",
    "did",
    "the",
    "and",
    "for",
    "how",
    "can",
    "could",
    "would",
    "should",
    "will",
    "your",
    "saved",
    "please",
    "tell",
    "give",
    "some",
    "into",
    "article",
    "articles",
    "page",
    "pages",
    "video",
    "paper",
    "content",
    "memory",
    "memories",
    "note",
    "notes",
    "thing",
    "stuff",
    "information",
    "summary",
    "summarize",
    "explain",
    "describe",
    "details",
    "anything",
    "something",
    "someone",
    "compare",
    "versus",
    "between",
    "across",
    "also",
    "just",
    "really",
}


@dataclass(frozen=True)
class RetrievedChunk:
    chunk_id: UUID
    memory_id: UUID
    title: str
    url: str
    source_type: SourceType
    content: str
    domain: str | None
    heading: str | None
    page_number: int | None
    captured_at: datetime
    distance: float | None
    lexical: bool = False
    rank: float = 0.0


def _query_tokens(query: str) -> list[str]:
    return [
        token
        for token in "".join(ch.lower() if ch.isalnum() else " " for ch in query).split()
        if len(token) >= 3 and token not in _STOPWORDS
    ]


def _lexical_rank(title: str, content: str, tokens: list[str]) -> float:
    title_l = (title or "").lower()
    content_l = (content or "").lower()
    score = 0.0
    for token in tokens:
        if token in title_l:
            score += 3.0
        elif token in content_l:
            score += 1.0
    return score


class RetrievalService:
    def __init__(self, db: DBSession) -> None:
        self.db = db
        self.settings = get_settings()

    def retrieve_relevant_memories(
        self,
        user_id: UUID,
        query: str,
        top_k: int | None = None,
        source_type: SourceType | None = None,
        memory_id: UUID | None = None,
    ) -> list[RetrievedChunk]:
        limit = top_k or self.settings.rag_top_k
        tokens = _query_tokens(query)
        semantic = self._semantic_search(user_id, query, limit, source_type, memory_id)
        lexical = self._lexical_search(user_id, query, limit, source_type, memory_id)

        if tokens:
            if lexical:
                lexical_ids = {chunk.memory_id for chunk in lexical}
                semantic_keep = [chunk for chunk in semantic if chunk.memory_id in lexical_ids]
                merged = self._deduplicate_chunks(semantic_keep + lexical)
            elif semantic:
                merged = self._deduplicate_chunks(semantic)
            else:
                return []
        else:
            merged = self._deduplicate_chunks(
                self._recent_chunks(user_id, limit, source_type, memory_id)
            )

        if needs_document_context(query) and merged:
            merged = self._expand_primary_memory(
                user_id, merged, limit=max(limit, 8), source_type=source_type
            )
        return merged[: max(limit, 8) if needs_document_context(query) else limit]

    def _base_query(
        self,
        user_id: UUID,
        source_type: SourceType | None,
        memory_id: UUID | None,
    ) -> Select[tuple[MemoryChunk, MemoryItem]]:
        stmt = (
            select(MemoryChunk, MemoryItem)
            .join(MemoryItem, MemoryChunk.memory_id == MemoryItem.id)
            .where(
                MemoryChunk.user_id == user_id,
                MemoryItem.user_id == user_id,  # double-guard for security
                MemoryItem.deleted_at.is_(None),
                MemoryItem.status == ItemStatus.ready,
            )
        )
        if source_type is not None:
            stmt = stmt.where(MemoryChunk.source_type == source_type)
        if memory_id is not None:
            stmt = stmt.where(MemoryChunk.memory_id == memory_id)
        return stmt

    def _to_retrieved(
        self,
        chunk: MemoryChunk,
        item: MemoryItem,
        distance: float | None,
        lexical: bool,
        rank: float = 0.0,
    ) -> RetrievedChunk:
        return RetrievedChunk(
            chunk_id=chunk.id,
            memory_id=item.id,
            title=item.title,
            url=item.url,
            source_type=chunk.source_type,
            content=chunk.content,
            domain=item.domain,
            heading=chunk.heading,
            page_number=chunk.page_number,
            captured_at=item.captured_at,
            distance=distance,
            lexical=lexical,
            rank=rank,
        )

    def _semantic_search(
        self,
        user_id: UUID,
        query: str,
        top_k: int,
        source_type: SourceType | None,
        memory_id: UUID | None,
    ) -> list[RetrievedChunk]:
        adapter = get_embedding_adapter()
        if adapter is None:
            return []

        try:
            vectors = adapter.embed_texts([query])
        except Exception:
            return []
        if not vectors:
            return []

        query_vector = vectors[0]
        if not query_vector:
            return []
        try:
            distance = MemoryChunk.embedding.cosine_distance(query_vector)
            stmt = (
                self._base_query(user_id, source_type, memory_id)
                .add_columns(distance.label("distance"))
                .where(MemoryChunk.embedding.is_not(None))
                .order_by(distance)
                .limit(top_k)
            )
            rows = self.db.execute(stmt).all()
        except Exception:
            logger.exception("Semantic retrieval failed; continuing with lexical search")
            return []
        results: list[RetrievedChunk] = []
        for chunk, item, dist in rows:
            if dist is not None and float(dist) > self.settings.rag_max_distance:
                continue
            results.append(self._to_retrieved(chunk, item, float(dist), lexical=False))
        return results

    def _lexical_search(
        self,
        user_id: UUID,
        query: str,
        top_k: int,
        source_type: SourceType | None,
        memory_id: UUID | None,
    ) -> list[RetrievedChunk]:
        tokens = _query_tokens(query)
        if not tokens:
            return []

        filters = [
            or_(
                MemoryChunk.content.ilike(f"%{token}%"),
                MemoryItem.title.ilike(f"%{token}%"),
            )
            for token in tokens[:6]
        ]
        candidate_limit = max(top_k * 4, 16)
        stmt = (
            self._base_query(user_id, source_type, memory_id)
            .where(or_(*filters))
            .limit(candidate_limit)
        )
        rows = self.db.execute(stmt).all()
        scored: list[RetrievedChunk] = []
        for chunk, item in rows:
            rank = _lexical_rank(item.title, chunk.content, tokens)
            if rank <= 0:
                continue
            scored.append(self._to_retrieved(chunk, item, None, lexical=True, rank=rank))
        scored.sort(key=lambda item: (-item.rank, -item.captured_at.timestamp()))
        return scored[:top_k]

    def _recent_chunks(
        self,
        user_id: UUID,
        top_k: int,
        source_type: SourceType | None,
        memory_id: UUID | None,
    ) -> list[RetrievedChunk]:
        stmt = (
            self._base_query(user_id, source_type, memory_id)
            .order_by(MemoryItem.captured_at.desc(), MemoryChunk.chunk_index.asc())
            .limit(top_k)
        )
        rows = self.db.execute(stmt).all()
        return [self._to_retrieved(chunk, item, None, lexical=True) for chunk, item in rows]

    def _expand_primary_memory(
        self,
        user_id: UUID,
        chunks: list[RetrievedChunk],
        limit: int,
        source_type: SourceType | None,
    ) -> list[RetrievedChunk]:
        """Pull additional chunks from the top-ranked memory for summary-style questions."""
        primary_id = chunks[0].memory_id
        extra = self._chunks_for_memory(user_id, primary_id, source_type, limit)
        seen = {chunk.chunk_id for chunk in chunks}
        expanded = list(chunks)
        for chunk in extra:
            if chunk.chunk_id in seen:
                continue
            expanded.append(chunk)
            seen.add(chunk.chunk_id)
            if len(expanded) >= limit:
                break
        return self._deduplicate_chunks(expanded)

    def _chunks_for_memory(
        self,
        user_id: UUID,
        memory_id: UUID,
        source_type: SourceType | None,
        limit: int,
    ) -> list[RetrievedChunk]:
        stmt = (
            self._base_query(user_id, source_type, memory_id)
            .order_by(MemoryChunk.chunk_index.asc())
            .limit(limit)
        )
        rows = self.db.execute(stmt).all()
        return [self._to_retrieved(chunk, item, None, lexical=True) for chunk, item in rows]

    @staticmethod
    def _deduplicate_chunks(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        """Remove chunks with nearly identical content from the same memory."""
        seen: dict[tuple[UUID, str], RetrievedChunk] = {}
        for chunk in chunks:
            key = (chunk.memory_id, chunk.content[:120].strip().lower())
            existing = seen.get(key)
            if existing is None:
                seen[key] = chunk
            else:
                existing_dist = existing.distance if existing.distance is not None else 1.0
                chunk_dist = chunk.distance if chunk.distance is not None else 1.0
                if chunk_dist < existing_dist:
                    seen[key] = chunk
        return sorted(
            seen.values(),
            key=lambda c: (
                c.distance is None,
                c.distance if c.distance is not None else 0.0,
                -c.rank,
            ),
        )
