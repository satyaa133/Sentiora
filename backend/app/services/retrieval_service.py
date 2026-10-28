"""Retrieval service — semantic (vector) and lexical fallback search.

Security: ALL queries are scoped to the authenticated user's user_id.
User A can never retrieve User B's memories.
"""

from __future__ import annotations

import logging
import math
import re
from typing import cast
from dataclasses import dataclass, field, replace
from datetime import datetime
from uuid import UUID


from sqlalchemy import Select, case, func, literal, select
from sqlalchemy.orm import Session as DBSession

from app.core.config import get_settings
from app.models.memory_chunk import MemoryChunk
from app.models.memory_item import ItemStatus, MemoryItem, SourceType
from app.services.embedding_service import get_embedding_adapter
from app.services.retrieval import selection

_TSQUERY_SAFE = re.compile(r"[^a-z0-9]")

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
    # Stored embedding, used for MMR diversity; never compared or printed.
    vector: tuple[float, ...] | None = field(default=None, compare=False, repr=False)



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
        """Hybrid retrieval: vector + full-text, fused with RRF, then MMR.

        Returns [] when nothing clears the relevance bar (the question is not
        covered by the user's memory).
        """
        scope = _Scope(source_type, memory_id, date_from, date_to)
        document = needs_document_context(query)
        limit = top_k or int(self._setting("rag_final_k", 6))
        if document:
            limit = max(limit, 8)
        tokens = _query_tokens(query)

        if not tokens:
            # "What did I save?" has no keywords: most recent saves instead.
            recent = self._deduplicate_chunks(self._recent_chunks(user_id, limit, scope))
            return recent[:limit]

        pool = int(self._setting("rag_candidates", 30))
        semantic = self._semantic_search(user_id, query, pool, scope)
        fulltext = self._fulltext_search(user_id, tokens, pool, scope)
        per_memory = (
            limit
            if memory_id is not None or document
            else int(self._setting("rag_max_chunks_per_memory", 2))
        )
        chosen = self._select(semantic, fulltext, limit=limit, per_memory=per_memory)
        if document and chosen:
            chosen = self._expand_primary_memory(user_id, chosen, limit=limit, scope=scope)[:limit]
        self._log_retrieval(query, semantic, fulltext, chosen)
        return chosen

    def _setting(self, name: str, default: float | int | str) -> float | int | str:
        value = getattr(self.settings, name, None)
        return default if value is None else value

    def _select(
        self,
        semantic: list[RetrievedChunk],
        fulltext: list[RetrievedChunk],
        *,
        limit: int,
        per_memory: int,
    ) -> list[RetrievedChunk]:
        """RRF-fuse both legs, drop near-duplicates, then pick with MMR."""
        if not semantic and not fulltext:
            return []
        scores = selection.rrf([[c.chunk_id for c in semantic], [c.chunk_id for c in fulltext]])
        # One entry per chunk: keep the vector distance and the full-text rank.
        by_id: dict[UUID, RetrievedChunk] = {c.chunk_id: c for c in fulltext}
        for chunk in semantic:
            text_hit = by_id.get(chunk.chunk_id)
            by_id[chunk.chunk_id] = (
                replace(chunk, rank=text_hit.rank, lexical=True) if text_hit else chunk
            )
        ranked = sorted(by_id.values(), key=lambda c: -scores[c.chunk_id])
        ranked = selection.drop_near_duplicates(ranked, lambda c: c.content)
        top = max(scores.values())
        shingle_cache: dict[UUID, frozenset[str]] = {}

        def shingles(chunk: RetrievedChunk) -> frozenset[str]:
            if chunk.chunk_id not in shingle_cache:
                shingle_cache[chunk.chunk_id] = selection.shingles(chunk.content)
            return shingle_cache[chunk.chunk_id]

        def similarity(a: RetrievedChunk, b: RetrievedChunk) -> float:
            cos = selection.cosine(a.vector, b.vector)
            return cos if cos is not None else selection.jaccard(shingles(a), shingles(b))

        return selection.mmr(
            ranked,
            relevance=lambda c: scores[c.chunk_id] / top,
            similarity=similarity,
            limit=limit,
            lambda_=float(self._setting("rag_mmr_lambda", 0.7)),
            group=lambda c: c.memory_id,
            per_group=per_memory,
        )

    def _log_retrieval(
        self,
        query: str,
        semantic: list[RetrievedChunk],
        fulltext: list[RetrievedChunk],
        chosen: list[RetrievedChunk],
    ) -> None:
        """Development-only trace of what retrieval saw and picked."""
        if str(self._setting("app_environment", "")).lower() != "development":
            return
        logger.info(
            "retrieval query=%r semantic=%s fulltext=%s chosen=%s",
            query[:200],
            [(c.title[:40], round(1 - (c.distance or 0), 3)) for c in semantic[:8]],
            [(c.title[:40], round(c.rank, 3)) for c in fulltext[:8]],
            [
                (
                    c.title[:40],
                    c.chunk_id.hex[:8],
                    None if c.distance is None else round(1 - c.distance, 3),
                    round(c.rank, 3),
                )
                for c in chosen
            ],
        )

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
            vector=tuple(chunk.embedding) if chunk.embedding is not None else None,
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
        # Only compare against vectors from the model that embedded the query.
        model_id = getattr(adapter, "model_id", None)
        try:
            distance = MemoryChunk.embedding.cosine_distance(query_vector)
            stmt = (
                self._base_query(user_id, scope)
                .add_columns(distance.label("distance"))
                .where(MemoryChunk.embedding.is_not(None))
                .where(MemoryChunk.embedding_model.is_not_distinct_from(model_id))
                .order_by(distance)
                .limit(top_k)
            )
            rows = cast(list[tuple[MemoryChunk, MemoryItem, float]], self.db.execute(stmt).all())
        except Exception:
            logger.exception("Semantic retrieval failed; continuing with lexical search")
            return []
        # Below this cosine similarity a vector neighbour is not relevant.
        max_distance = 1.0 - float(self._setting("rag_min_similarity", 0.25))
        results: list[RetrievedChunk] = []
        for chunk, item, dist in rows:
            if dist is None or float(dist) > max_distance:
                continue
            results.append(self._to_retrieved(chunk, item, float(dist), lexical=False))
        return results

    def _fulltext_search(
        self,
        user_id: UUID,
        tokens: list[str],
        top_k: int,
        scope: _Scope,
    ) -> list[RetrievedChunk]:
        """Postgres full-text search over chunk text and memory titles.

        Terms are OR-ed (natural-language questions rarely contain every word
        of the answer) and ranked with ``ts_rank_cd``. A hit must match enough
        distinct query terms (``_min_token_matches``), so one stray shared word
        is not a match.
        """
        cleaned = (_TSQUERY_SAFE.sub("", token) for token in tokens)
        terms = list(dict.fromkeys(term for term in cleaned if term))[:12]
        if not terms:
            return []
        query = func.to_tsquery("english", " | ".join(terms))
        document = MemoryChunk.content_tsv.op("||")(MemoryItem.title_tsv)
        rank = func.ts_rank_cd(MemoryChunk.content_tsv, query) + func.ts_rank_cd(
            MemoryItem.title_tsv, query
        )
        matched = sum(
            (
                case((document.op("@@")(func.to_tsquery("english", term)), 1), else_=0)
                for term in terms
            ),
            start=literal(0),
        )
        stmt = (
            self._base_query(user_id, scope)
            .add_columns(rank.label("rank"), matched.label("matched"))
            .where(document.op("@@")(query))
            .order_by(rank.desc(), MemoryItem.captured_at.desc())
            .limit(top_k)
        )
        try:
            rows = cast(
                list[tuple[MemoryChunk, MemoryItem, float, int]], self.db.execute(stmt).all()
            )
        except Exception:
            logger.exception("Full-text retrieval failed")
            self.db.rollback()
            return []
        needed = _min_token_matches(len(terms))
        return [
            self._to_retrieved(chunk, item, None, lexical=True, rank=float(score))
            for chunk, item, score, hits in rows
            if int(hits) >= needed and float(score) > 0
        ]

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
