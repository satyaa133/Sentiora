"""Load the local models before an API process takes traffic (S9).

The local embedding model and the reranker load lazily, on a process's first
question: 3–5 s that the first user after every start or deploy would wait
for (seen in the S9 load test as instant-answer outliers of 5–6 s). Running one
tiny query through each at startup moves that cost before the health check
passes. Each step is skipped when its model is turned off, and a failure is
logged, not raised: the request path loads the model again and degrades the
same way it always has.
"""

from __future__ import annotations

import logging
import time

from app.services.embedding_service import get_embedding_adapter, is_local_model
from app.services.retrieval.reranker import get_reranker, reranker_enabled

logger = logging.getLogger(__name__)

_QUERY = "warm up"


def warm_local_models() -> list[str]:
    """Load and exercise every local model in use; returns the names warmed."""
    warmed: list[str] = []
    started = time.perf_counter()
    try:
        adapter = get_embedding_adapter()
        if adapter is not None and is_local_model(getattr(adapter, "model_id", None)):
            adapter.embed_query(_QUERY)
            warmed.append("embedding")
    except Exception:
        logger.warning("Embedding model warm-up failed; it loads on first use", exc_info=True)
    if reranker_enabled():
        reranker = get_reranker()
        if reranker is not None:
            try:
                reranker.score_sentences(_QUERY, [_QUERY])
                warmed.append("reranker")
            except Exception:
                logger.warning("Reranker warm-up failed; it loads on first use", exc_info=True)
    if warmed:
        logger.info(
            "local models warmed (%s) in %.1fs", ", ".join(warmed), time.perf_counter() - started
        )
    return warmed
