"""Pure ranking helpers for hybrid retrieval (no database access).

Pipeline: reciprocal-rank fusion of the vector and full-text legs →
near-duplicate removal → MMR re-ranking with a per-memory cap.
"""

from __future__ import annotations

import math
import re
from collections.abc import Callable, Hashable, Sequence

RRF_K = 60
_WORD_RE = re.compile(r"[a-z0-9']+")


def rrf[K: Hashable](rankings: Sequence[Sequence[K]], k: int = RRF_K) -> dict[K, float]:
    """Reciprocal Rank Fusion: score(d) = Σ 1 / (k + rank_i(d)), ranks from 1."""
    scores: dict[K, float] = {}
    for ranking in rankings:
        for position, key in enumerate(ranking, start=1):
            scores[key] = scores.get(key, 0.0) + 1.0 / (k + position)
    return scores


def shingles(text: str, size: int = 3) -> frozenset[str]:
    words = _WORD_RE.findall(text.lower())
    if len(words) < size:
        return frozenset([" ".join(words)]) if words else frozenset()
    return frozenset(
        " ".join(words[i : i + size]) for i in range(len(words) - size + 1)
    )


def jaccard(a: frozenset[str], b: frozenset[str]) -> float:
    if not a or not b:
        return 0.0
    return len(a & b) / len(a | b)


def cosine(a: Sequence[float] | None, b: Sequence[float] | None) -> float | None:
    if a is None or b is None or len(a) != len(b) or not len(a):
        return None
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm = math.sqrt(sum(x * x for x in a)) * math.sqrt(sum(y * y for y in b))
    return dot / norm if norm else None


def drop_near_duplicates[T](
    items: Sequence[T], text: Callable[[T], str], threshold: float = 0.8
) -> list[T]:
    """Keep items in order, skipping any whose 3-word shingles overlap an
    already-kept item by more than ``threshold`` (Jaccard)."""
    kept: list[tuple[T, frozenset[str]]] = []
    for item in items:
        grams = shingles(text(item))
        if any(jaccard(grams, other) > threshold for _, other in kept):
            continue
        kept.append((item, grams))
    return [item for item, _ in kept]


def mmr[T](
    items: Sequence[T],
    relevance: Callable[[T], float],
    similarity: Callable[[T, T], float],
    *,
    limit: int,
    lambda_: float = 0.7,
    group: Callable[[T], Hashable] | None = None,
    per_group: int | None = None,
) -> list[T]:
    """Maximal Marginal Relevance selection.

    Each step picks the item maximising
    ``λ · relevance − (1 − λ) · max similarity to already-picked items``.
    ``relevance`` should be roughly 0–1. With ``group``/``per_group`` no group
    (memory) contributes more than ``per_group`` items.
    """
    remaining = list(items)
    picked: list[T] = []
    counts: dict[Hashable, int] = {}
    while remaining and len(picked) < limit:
        best: T | None = None
        best_score = -math.inf
        for item in remaining:
            if (
                group
                and per_group is not None
                and counts.get(group(item), 0) >= per_group
            ):
                continue
            redundancy = max((similarity(item, other) for other in picked), default=0.0)
            score = lambda_ * relevance(item) - (1 - lambda_) * redundancy
            if score > best_score:
                best, best_score = item, score
        if best is None:
            break
        picked.append(best)
        remaining.remove(best)
        if group:
            counts[group(best)] = counts.get(group(best), 0) + 1
    return picked
