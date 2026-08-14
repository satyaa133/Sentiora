"""Retrieval service — semantic (vector) and lexical fallback search.

Security: ALL queries are scoped to the authenticated user's user_id.
User A can never retrieve User B's memories.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from uuid import UUID

from sqlalchemy import Select, or_, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.services.embedding_service import get_embedding_adapter

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
        semantic = self._semantic_search(user_id, query, limit, source_type, memory_id)
        if semantic:
            return self._deduplicate_chunks(semantic)
        lexical = self._lexical_search(user_id, query, limit, source_type, memory_id)
        return self._deduplicate_chunks(lexical)

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
        distance = MemoryChunk.embedding.cosine_distance(query_vector)
        stmt = (
            self._base_query(user_id, source_type, memory_id)
            .add_columns(distance.label("distance"))
            .where(MemoryChunk.embedding.is_not(None))
            .order_by(distance)
            .limit(top_k)
        )
        rows = self.db.execute(stmt).all()
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
        tokens = [
            token
            for token in "".join(ch.lower() if ch.isalnum() else " " for ch in query).split()
            if len(token) >= 4 and token not in _STOPWORDS
        ]
        if not tokens:
            return []

        filters = [
            or_(
                MemoryChunk.content.ilike(f"%{token}%"),
                MemoryItem.title.ilike(f"%{token}%"),
            )
            for token in tokens[:6]
        ]
        stmt = self._base_query(user_id, source_type, memory_id).where(or_(*filters)).limit(top_k)
        rows = self.db.execute(stmt).all()
        return [self._to_retrieved(chunk, item, None, lexical=True) for chunk, item in rows]

    @staticmethod
    def _deduplicate_chunks(chunks: list[RetrievedChunk]) -> list[RetrievedChunk]:
        """Remove chunks with nearly identical content from the same memory.

        When the same memory is captured multiple times, multiple chunks may
        have very similar text. Keep the one with the lowest distance (most
        relevant) per (memory_id, content_prefix) pair.
        """
        seen: dict[tuple[UUID, str], RetrievedChunk] = {}
        for chunk in chunks:
            # Use first 120 chars as content fingerprint
            key = (chunk.memory_id, chunk.content[:120].strip().lower())
            existing = seen.get(key)
            if existing is None:
                seen[key] = chunk
            else:
                # Prefer the chunk with lower distance (better relevance)
                existing_dist = existing.distance if existing.distance is not None else 1.0
                chunk_dist = chunk.distance if chunk.distance is not None else 1.0
                if chunk_dist < existing_dist:
                    seen[key] = chunk
        # Re-sort by distance ascending (lexical chunks have None distance — keep at end)
        return sorted(
            seen.values(),
            key=lambda c: (c.distance is None, c.distance or 0.0),
        )
