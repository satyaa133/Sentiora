"""Retrieval service — semantic (vector) and lexical fallback search.

Security: ALL queries are scoped to the authenticated user's user_id.
User A can never retrieve User B's memories.
"""

from __future__ import annotations

import logging
import math
from typing import cast
from dataclasses import dataclass, replace
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
    "these",
    "those",
    "them",
    "they",
    "recent",
    "latest",
    "saves",
    "videos",
    "pdfs",
    "mostly",
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
    start_sec: float | None = None
    end_sec: float | None = None


_RRF_K = 60


@dataclass(frozen=True)
class _Scope:
    source_type: SourceType | None = None
    memory_id: UUID | None = None
    date_from: datetime | None = None
    date_to: datetime | None = None


def _query_tokens(query: str) -> list[str]:
    return [
        token
        for token in "".join(ch.lower() if ch.isalnum() else " " for ch in query).split()
        if len(token) >= 3 and token not in _STOPWORDS
    ]


def keyword_coverage(query: str, *texts: str) -> float:
    """Share of the query's keywords that appear in the given texts (0.0–1.0)."""
    tokens = _query_tokens(query)
    if not tokens:
        return 0.0
    haystack = " ".join(texts).lower()
    return sum(token in haystack for token in tokens) / len(tokens)


def _min_token_matches(token_count: int) -> int:
    """Short queries need one hit; longer ones need real overlap, not one stray word."""
    if token_count <= 2:
        return 1
    return max(2, math.ceil(token_count / 3))


def _lexical_rank(title: str, content: str, tokens: list[str]) -> float:
    title_l = (title or "").lower()
    content_l = (content or "").lower()
    score = 0.0
    matched = 0
    for token in tokens:
        if token in title_l:
            score += 3.0
            matched += 1
        elif token in content_l:
            score += 1.0
            matched += 1
    if matched < _min_token_matches(len(tokens)):
        return 0.0
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
        date_from: datetime | None = None,
        date_to: datetime | None = None,
    ) -> list[RetrievedChunk]:
        limit = top_k or self.settings.rag_top_k
        scope = _Scope(source_type, memory_id, date_from, date_to)
        tokens = _query_tokens(query)
        semantic = self._semantic_search(user_id, query, limit, scope)
        lexical = self._lexical_search(user_id, query, limit, scope)

        if tokens:
            if not lexical and not semantic:
                return []
            merged = self._fuse(semantic, lexical)
        else:
            merged = self._deduplicate_chunks(self._recent_chunks(user_id, limit, scope))

        if needs_document_context(query) and merged:
            merged = self._expand_primary_memory(user_id, merged, limit=max(limit, 8), scope=scope)
        return merged[: max(limit, 8) if needs_document_context(query) else limit]

    def _fuse(
        self, semantic: list[RetrievedChunk], lexical: list[RetrievedChunk]
    ) -> list[RetrievedChunk]:
        """Reciprocal-rank fusion of semantic and keyword hits.

        A semantic-only hit survives next to keyword hits only when it is a
        strong match, so a loosely related vector neighbour cannot outrank the
        memory that actually contains the words.
        """
        if lexical:
            lexical_ids = {chunk.memory_id for chunk in lexical}
            strong = float(getattr(self.settings, "rag_strong_distance", 0.4))
            semantic = [
                chunk
                for chunk in semantic
                if chunk.memory_id in lexical_ids
                or (chunk.distance is not None and chunk.distance <= strong)
            ]
        scores: dict[UUID, float] = {}
        for ranked, weight in ((semantic, 1.0), (lexical, 1.2)):
            for position, chunk in enumerate(ranked):
                scores[chunk.chunk_id] = scores.get(chunk.chunk_id, 0.0) + weight / (
                    _RRF_K + position + 1
                )
        # One entry per chunk: the semantic copy carries the distance, so give it
        # the keyword rank too when both searches found the same chunk.
        by_id = {chunk.chunk_id: chunk for chunk in lexical}
        for chunk in semantic:
            keyword = by_id.get(chunk.chunk_id)
            by_id[chunk.chunk_id] = replace(chunk, rank=keyword.rank) if keyword else chunk
        fused = self._deduplicate_chunks(list(by_id.values()))
        return sorted(fused, key=lambda chunk: -scores.get(chunk.chunk_id, 0.0))

    def _base_query(self, user_id: UUID, scope: _Scope) -> Select[tuple[MemoryChunk, MemoryItem]]:
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
        if scope.source_type is not None:
            stmt = stmt.where(MemoryChunk.source_type == scope.source_type)
        if scope.memory_id is not None:
            stmt = stmt.where(MemoryChunk.memory_id == scope.memory_id)
        if scope.date_from is not None:
            stmt = stmt.where(MemoryItem.captured_at >= scope.date_from)
        if scope.date_to is not None:
            stmt = stmt.where(MemoryItem.captured_at < scope.date_to)
        return cast(Select[tuple[MemoryChunk, MemoryItem]], stmt)

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
            start_sec=chunk.start_sec,
            end_sec=chunk.end_sec,
        )

    def _semantic_search(
        self,
        user_id: UUID,
        query: str,
        top_k: int,
        scope: _Scope,
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
                self._base_query(user_id, scope)
                .add_columns(distance.label("distance"))
                .where(MemoryChunk.embedding.is_not(None))
                .order_by(distance)
                .limit(top_k)
            )
            rows = cast(list[tuple[MemoryChunk, MemoryItem, float]], self.db.execute(stmt).all())
        except Exception:
            logger.exception("Semantic retrieval failed; continuing with lexical search")
            return []
        results: list[RetrievedChunk] = []
        for chunk, item, dist in rows:
            if dist is None or float(dist) > self.settings.rag_max_distance:
                continue
            results.append(self._to_retrieved(chunk, item, float(dist), lexical=False))
        return results

    def _lexical_search(
        self,
        user_id: UUID,
        query: str,
        top_k: int,
        scope: _Scope,
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
            self._base_query(user_id, scope)
            .where(or_(*filters))
            .limit(candidate_limit)
        )
        rows = cast(list[tuple[MemoryChunk, MemoryItem]], self.db.execute(stmt).all())
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
        scope: _Scope,
    ) -> list[RetrievedChunk]:
        stmt = (
            self._base_query(user_id, scope)
            .order_by(MemoryItem.captured_at.desc(), MemoryChunk.chunk_index.asc())
            .limit(top_k)
        )
        rows = cast(list[tuple[MemoryChunk, MemoryItem]], self.db.execute(stmt).all())
        return [self._to_retrieved(chunk, item, None, lexical=True) for chunk, item in rows]

    def _expand_primary_memory(
        self,
        user_id: UUID,
        chunks: list[RetrievedChunk],
        limit: int,
        scope: _Scope,
    ) -> list[RetrievedChunk]:
        """Pull additional chunks from the top-ranked memory for summary-style questions."""
        primary_id = chunks[0].memory_id
        extra = self._chunks_for_memory(user_id, primary_id, scope, limit)
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
        scope: _Scope,
        limit: int,
    ) -> list[RetrievedChunk]:
        stmt = (
            self._base_query(user_id, replace(scope, memory_id=memory_id))
            .order_by(MemoryChunk.chunk_index.asc())
            .limit(limit)
        )
        rows = cast(list[tuple[MemoryChunk, MemoryItem]], self.db.execute(stmt).all())
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
