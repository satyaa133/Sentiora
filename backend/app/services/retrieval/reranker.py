"""Cross-encoder reranking of retrieval candidates, on the server's CPU.

A cross-encoder reads the question and a passage together, so it judges
"does this passage answer this question" far better than the vector or
full-text scores that picked the candidates. It is also much slower, so only
the top ``RAG_RERANK_CANDIDATES`` fused candidates are scored, each passage is
cut to ``_MAX_PASSAGE_CHARS``, and passages are scored one at a time (a batch
is padded to its longest passage, which made batches slower on CPU).

The model (``RERANKER_MODEL``, fastembed / ONNX Runtime) loads once per
process from ``MODEL_CACHE_DIR``. ``RERANKER_MODEL=none`` turns reranking off.
Any failure leaves the candidates in their fused order: reranking improves an
answer but is never required for one.
"""

from __future__ import annotations

import logging
import threading
import time
from collections.abc import Sequence
from typing import Any

from app.core.config import get_settings

logger = logging.getLogger(__name__)

# Characters of each passage the cross-encoder reads (title and heading first).
_MAX_PASSAGE_CHARS = 1200
_DISABLED = {"", "none", "off"}
# Sentences scored per batch for instant answers.
_SENTENCE_BATCH = 16

_models: dict[tuple[str, str], Any] = {}
_models_lock = threading.Lock()


def reranker_enabled() -> bool:
    return get_settings().reranker_model.strip().lower() not in _DISABLED


def load_reranker(model: str, cache_dir: str) -> Any:
    """The fastembed cross-encoder, loaded once per process."""
    key = (model, cache_dir)
    with _models_lock:
        loaded = _models.get(key)
        if loaded is None:
            from fastembed.rerank.cross_encoder import TextCrossEncoder

            started = time.perf_counter()
            loaded = TextCrossEncoder(model_name=model, cache_dir=cache_dir)
            logger.info(
                "reranker model=%s loaded in %.1fs", model, time.perf_counter() - started
            )
            _models[key] = loaded
        return loaded


def download_reranker() -> str | None:
    """Fetch RERANKER_MODEL into MODEL_CACHE_DIR (Docker build, setup)."""
    if not reranker_enabled():
        return None
    settings = get_settings()
    load_reranker(settings.reranker_model, str(settings.model_cache_path))
    return settings.reranker_model


def passage_text(title: str, heading: str | None, content: str) -> str:
    parts = [title.strip()]
    if heading and heading.strip():
        parts.append(heading.strip())
    parts.append(" ".join(content.split()))
    return "\n".join(parts)[:_MAX_PASSAGE_CHARS]


class RerankerService:
    def __init__(self) -> None:
        settings = get_settings()
        self._model = load_reranker(settings.reranker_model, str(settings.model_cache_path))

    def score(self, query: str, passages: Sequence[str]) -> list[float]:
        """One relevance score per passage (higher is better), in input order."""
        if not passages:
            return []
        scores = [float(s) for s in self._model.rerank(query, list(passages), batch_size=1)]
        if len(scores) != len(passages):
            raise RuntimeError(
                f"Reranker returned {len(scores)} scores for {len(passages)} passages."
            )
        return scores

    def score_sentences(self, query: str, sentences: Sequence[str]) -> list[float]:
        """Scores for short texts of similar length (instant answers), batched.

        Passages are scored one at a time because a batch is padded to its
        longest member; sentences are short and alike, so batching is cheaper.
        """
        if not sentences:
            return []
        scores = [
            float(s)
            for s in self._model.rerank(query, list(sentences), batch_size=_SENTENCE_BATCH)
        ]
        if len(scores) != len(sentences):
            raise RuntimeError(
                f"Reranker returned {len(scores)} scores for {len(sentences)} sentences."
            )
        return scores


def get_reranker() -> RerankerService | None:
    """The reranker, or None when it is turned off or fails to load."""
    if not reranker_enabled():
        return None
    try:
        return RerankerService()
    except Exception:
        logger.exception("Failed to load the reranker; using fused order")
        return None
