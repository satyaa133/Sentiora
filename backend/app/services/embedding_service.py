"""Embedding providers for MemoryChunk vectors. Never writes synthetic vectors.

Exactly one provider is active at a time (``resolve_embedding_provider``).
Remote providers write ``memory_chunks.embedding`` and record the ``model_id``
that embedded each chunk; the local provider (fastembed, on this machine's
CPU) writes ``memory_chunks.embedding_local``. Query embeddings come from the
same adapter and are compared only with that adapter's column (and, for remote
providers, the same ``model_id``), so a query is never compared with vectors
from a different model. There is no cross-provider fallback: when the active
provider fails, callers fall back to full-text search.
"""

from __future__ import annotations

import logging
import threading
import time
from dataclasses import dataclass
from typing import Any

import openai
from openai import OpenAI
from sqlalchemy import ColumnElement, or_
from sqlalchemy.orm import InstrumentedAttribute

from app.core.config import (
    LOCAL_EMBEDDING_DIMENSIONS,
    get_settings,
    openrouter_keys,
)
from app.models.memory_chunk import MemoryChunk
from app.services.embedding_port import EmbeddingPort
from app.services.llm_pool import (
    OPENROUTER_PRIVACY,
    LLMBackend,
    key_pool,
    max_attempts,
    retry_after_seconds,
)
from app.services.usage import UsageReport, record_usage, report_from_openai

logger = logging.getLogger(__name__)

OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
_MAX_INPUT_CHARS = 8000
_OPENROUTER_BATCH = 64


class EmbeddingNotConfiguredError(RuntimeError):
    pass


def _clip(text: str) -> str:
    return text[:_MAX_INPUT_CHARS] if text else " "


def _check_dimensions(vectors: list[list[float]], expected: int, provider: str) -> None:
    for vector in vectors:
        if len(vector) != expected:
            raise RuntimeError(
                f"{provider} embedding dimension {len(vector)} != {expected}."
            )


class OpenRouterEmbeddingAdapter(EmbeddingPort):
    """OpenRouter ``POST /embeddings``, rotating across the OpenRouter keys.

    Every key uses the same model, so failing over between keys never mixes
    embedding spaces. Cooldowns are shared with chat (``llm_pool.key_pool``):
    a key that is out of credit is out of credit for both.
    """

    def __init__(self) -> None:
        settings = get_settings()
        keys = openrouter_keys(settings)
        if not keys:
            raise EmbeddingNotConfiguredError("No OpenRouter API key is configured.")
        self._model = settings.embedding_model or settings.openrouter_embedding_model
        self.model_id = f"openrouter:{self._model}"
        self._backends = [
            LLMBackend(
                name=f"openrouter-embed-{i}",
                provider="openrouter",
                api_key=key,
                model=self._model,
            )
            for i, key in enumerate(keys, start=1)
        ]
        self._cooldown = settings.llm_key_cooldown_seconds
        self._max_cooldown = settings.llm_cooldown_max_seconds
        self._attempts = max_attempts(settings)
        self.dimensions = settings.embedding_dimensions
        self._timeout = settings.embedding_timeout_seconds

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        vectors: list[list[float]] = []
        for start in range(0, len(texts), _OPENROUTER_BATCH):
            vectors.extend(
                self._embed_batch(
                    [_clip(t) for t in texts[start : start + _OPENROUTER_BATCH]]
                )
            )
        return vectors

    def _embed_batch(self, batch: list[str]) -> list[list[float]]:
        if not batch:
            return []
        last_error: Exception | None = None
        for backend in key_pool.order(self._backends)[: self._attempts]:
            client = OpenAI(
                api_key=backend.api_key,
                base_url=OPENROUTER_BASE_URL,
                timeout=self._timeout,
                max_retries=0,
            )
            started = time.perf_counter()
            try:
                response = client.embeddings.create(
                    model=self._model,
                    input=batch,
                    # Usage accounting reports the cost; never route to a provider
                    # that stores or trains on the text (REBUILD_PLAN D13).
                    extra_body={
                        "usage": {"include": True},
                        "provider": dict(OPENROUTER_PRIVACY),
                    },
                )
            except openai.APIStatusError as exc:
                _record_embedding("openrouter", self._model, started, error=exc)
                last_error = exc
                key_pool.mark_failed(
                    backend,
                    exc.status_code,
                    timed_out=False,
                    cooldown_seconds=self._cooldown,
                    max_cooldown_seconds=self._max_cooldown,
                    retry_after=retry_after_seconds(exc),
                )
                logger.warning(
                    "embedding key=%s failed status=%s", backend.name, exc.status_code
                )
                continue
            except (openai.APITimeoutError, openai.APIConnectionError) as exc:
                _record_embedding("openrouter", self._model, started, error=exc)
                last_error = exc
                key_pool.mark_failed(
                    backend,
                    None,
                    timed_out=True,
                    cooldown_seconds=self._cooldown,
                    max_cooldown_seconds=self._max_cooldown,
                )
                logger.warning(
                    "embedding key=%s failed reason=%s",
                    backend.name,
                    type(exc).__name__,
                )
                continue
            _record_embedding(
                "openrouter",
                self._model,
                started,
                report=report_from_openai(getattr(response, "usage", None)),
            )
            key_pool.mark_ok(backend)
            ordered = sorted(response.data or [], key=lambda item: item.index)
            vectors = [list(item.embedding) for item in ordered]
            if len(vectors) != len(batch):
                raise RuntimeError(
                    f"OpenRouter returned {len(vectors)} embeddings for {len(batch)} inputs."
                )
            _check_dimensions(vectors, self.dimensions, "OpenRouter")
            return vectors
        raise RuntimeError(f"Every OpenRouter key failed to embed: {last_error}")


def _record_embedding(
    provider: str,
    model: str,
    started: float,
    *,
    report: UsageReport | None = None,
    error: BaseException | None = None,
) -> None:
    """One llm_usage row per embedding request (the user comes from usage_for)."""
    record_usage(
        purpose="embed",
        provider=provider,
        model=model,
        started=started,
        report=report,
        error=error,
    )


class OpenAIEmbeddingAdapter(EmbeddingPort):
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise EmbeddingNotConfiguredError("OPENAI_API_KEY is not configured.")
        self._client = OpenAI(
            api_key=settings.openai_api_key,
            timeout=settings.embedding_timeout_seconds,
        )
        self._model = settings.embedding_model or settings.openai_embedding_model
        self.model_id = f"openai:{self._model}"
        self.dimensions = settings.embedding_dimensions

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        started = time.perf_counter()
        try:
            response = self._client.embeddings.create(
                model=self._model, input=[_clip(t) for t in texts]
            )
        except Exception as exc:
            _record_embedding("openai", self._model, started, error=exc)
            raise
        _record_embedding(
            "openai",
            self._model,
            started,
            report=report_from_openai(getattr(response, "usage", None)),
        )
        ordered = sorted(response.data, key=lambda item: item.index)
        vectors = [list(item.embedding) for item in ordered]
        _check_dimensions(vectors, self.dimensions, "OpenAI")
        return vectors


class GeminiEmbeddingAdapter(EmbeddingPort):
    def __init__(self) -> None:
        from google import genai
        from google.genai import types

        settings = get_settings()
        if not settings.gemini_api_key:
            raise EmbeddingNotConfiguredError("GEMINI_API_KEY is not configured.")
        self._client = genai.Client(
            api_key=settings.gemini_api_key,
            # Milliseconds; Gemini also sends it as the server-side deadline,
            # which it rejects under 10 s.
            http_options=types.HttpOptions(
                timeout=int(max(settings.embedding_timeout_seconds, 10.0) * 1000)
            ),
        )
        self._model = settings.embedding_model or settings.gemini_embedding_model
        self.model_id = f"gemini:{self._model}"
        self.dimensions = settings.embedding_dimensions

    def embed_query(self, text: str) -> list[float]:
        return self.embed_texts([text])[0]

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        from google.genai import types

        dim = get_settings().embedding_dimensions
        vectors: list[list[float]] = []
        for text in texts:
            started = time.perf_counter()
            try:
                response = self._client.models.embed_content(
                    model=self._model,
                    contents=_clip(text),
                    config=types.EmbedContentConfig(output_dimensionality=dim),
                )
            except Exception as exc:
                _record_embedding("gemini", self._model, started, error=exc)
                raise
            _record_embedding("gemini", self._model, started)
            embeddings = response.embeddings or []
            if not embeddings or embeddings[0].values is None:
                raise RuntimeError("Gemini returned no embedding values.")
            vectors.append([float(value) for value in embeddings[0].values])
        _check_dimensions(vectors, dim, "Gemini")
        return vectors


@dataclass(frozen=True)
class LocalModelSpec:
    # Text the model was trained to see before a question / a saved passage.
    query_prefix: str
    passage_prefix: str


_NOMIC = LocalModelSpec(query_prefix="search_query: ", passage_prefix="search_document: ")
LOCAL_MODEL_SPECS: dict[str, LocalModelSpec] = {
    "nomic-ai/nomic-embed-text-v1.5-Q": _NOMIC,
    "nomic-ai/nomic-embed-text-v1.5": _NOMIC,
    "BAAI/bge-small-en-v1.5": LocalModelSpec(
        query_prefix="Represent this sentence for searching relevant passages: ",
        passage_prefix="",
    ),
}
# nomic reads up to 8192 tokens, so a batch is padded to its longest chunk;
# small batches keep long transcript chunks from slowing the rest.
_LOCAL_BATCH = 8
_local_models: dict[tuple[str, str], Any] = {}
_local_models_lock = threading.Lock()


def load_local_model(model: str, cache_dir: str) -> Any:
    """The fastembed model, loaded once per process (downloaded on first use)."""
    key = (model, cache_dir)
    with _local_models_lock:
        loaded = _local_models.get(key)
        if loaded is None:
            from fastembed import TextEmbedding

            started = time.perf_counter()
            loaded = TextEmbedding(model_name=model, cache_dir=cache_dir)
            logger.info(
                "local embedding model=%s loaded in %.1fs",
                model,
                time.perf_counter() - started,
            )
            _local_models[key] = loaded
        return loaded


class LocalEmbeddingAdapter(EmbeddingPort):
    """Embeds on this machine's CPU with fastembed (ONNX Runtime).

    Nothing leaves the server and no key is needed; the model files live in
    MODEL_CACHE_DIR (baked into the Docker image). Local calls are not AI
    provider calls, so they write no llm_usage rows.
    """

    def __init__(self) -> None:
        settings = get_settings()
        self._model_name = settings.local_embedding_model
        spec = LOCAL_MODEL_SPECS.get(self._model_name)
        dimensions = LOCAL_EMBEDDING_DIMENSIONS.get(self._model_name)
        if spec is None or dimensions is None:
            raise EmbeddingNotConfiguredError(
                f"Unknown LOCAL_EMBEDDING_MODEL={self._model_name!r}."
            )
        self._spec = spec
        self.model_id = f"local:{self._model_name}"
        self.dimensions = dimensions
        self._model = load_local_model(self._model_name, str(settings.model_cache_path))

    def _embed(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        vectors = [
            [float(value) for value in vector]
            for vector in self._model.embed(texts, batch_size=_LOCAL_BATCH)
        ]
        if len(vectors) != len(texts):
            raise RuntimeError(
                f"Local model returned {len(vectors)} embeddings for {len(texts)} inputs."
            )
        _check_dimensions(vectors, self.dimensions, "Local")
        return vectors

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        prefix = self._spec.passage_prefix
        return self._embed([prefix + _clip(text) for text in texts])

    def embed_query(self, text: str) -> list[float]:
        return self._embed([self._spec.query_prefix + _clip(text)])[0]


def download_local_model() -> str:
    """Fetch LOCAL_EMBEDDING_MODEL into MODEL_CACHE_DIR (Docker build, setup)."""
    settings = get_settings()
    load_local_model(settings.local_embedding_model, str(settings.model_cache_path))
    return settings.local_embedding_model


EMBEDDING_PROVIDERS = ("auto", "openrouter", "openai", "gemini", "local", "none")


def resolve_embedding_provider() -> str | None:
    """Return "openrouter", "openai", "gemini", "local", or None (full-text only)."""
    settings = get_settings()
    choice = (settings.embedding_provider or "auto").strip().lower()
    if choice not in EMBEDDING_PROVIDERS:
        logger.error(
            "Unknown EMBEDDING_PROVIDER=%r; expected one of %s. Semantic search disabled.",
            choice,
            ", ".join(EMBEDDING_PROVIDERS),
        )
        return None
    has_openrouter = bool(openrouter_keys(settings))
    if choice == "none":
        return None
    if choice == "local":
        return "local"
    if choice == "openrouter":
        return "openrouter" if has_openrouter else None
    if choice == "openai":
        return "openai" if settings.openai_api_key else None
    if choice == "gemini":
        return "gemini" if settings.gemini_api_key else None
    # auto
    if has_openrouter:
        return "openrouter"
    if settings.llm_provider == "gemini":
        return "gemini" if settings.gemini_api_key else None
    if settings.llm_provider == "openai":
        return "openai" if settings.openai_api_key else None
    if settings.openai_api_key:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return None


_ADAPTERS: dict[str, type[EmbeddingPort]] = {
    "openrouter": OpenRouterEmbeddingAdapter,
    "openai": OpenAIEmbeddingAdapter,
    "gemini": GeminiEmbeddingAdapter,
    "local": LocalEmbeddingAdapter,
}


def get_embedding_adapter() -> EmbeddingPort | None:
    try:
        provider = resolve_embedding_provider()
        return _ADAPTERS[provider]() if provider else None
    except Exception:
        logger.exception("Failed to initialize embedding adapter")
        return None


def current_embedding_model() -> str | None:
    """``model_id`` of the active provider without creating a client, or None."""
    settings = get_settings()
    provider = resolve_embedding_provider()
    if provider == "openrouter":
        return f"openrouter:{settings.embedding_model or settings.openrouter_embedding_model}"
    if provider == "openai":
        return f"openai:{settings.embedding_model or settings.openai_embedding_model}"
    if provider == "gemini":
        return f"gemini:{settings.embedding_model or settings.gemini_embedding_model}"
    if provider == "local":
        return f"local:{settings.local_embedding_model}"
    return None


# Which memory_chunks column holds a model's vectors.


def is_local_model(model_id: str | None) -> bool:
    return bool(model_id) and str(model_id).startswith("local:")


def vector_column(model_id: str | None) -> InstrumentedAttribute[Any]:
    if is_local_model(model_id):
        return MemoryChunk.embedding_local
    return MemoryChunk.embedding


def has_vector_for(model_id: str | None) -> ColumnElement[bool]:
    """SQL condition: the chunk has a vector this model's queries can use."""
    if is_local_model(model_id):
        return MemoryChunk.embedding_local.is_not(None)
    return MemoryChunk.embedding.is_not(None) & MemoryChunk.embedding_model.is_not_distinct_from(
        model_id
    )


def needs_vector_for(model_id: str | None) -> ColumnElement[bool]:
    """SQL condition: the chunk still needs embedding with this model."""
    if is_local_model(model_id):
        return MemoryChunk.embedding_local.is_(None)
    return or_(
        MemoryChunk.embedding.is_(None),
        MemoryChunk.embedding_model.is_distinct_from(model_id),
    )


def chunk_vector(chunk: MemoryChunk, model_id: str | None) -> Any:
    return chunk.embedding_local if is_local_model(model_id) else chunk.embedding


def set_chunk_vector(
    chunk: MemoryChunk, model_id: str | None, vector: list[float] | None
) -> None:
    """Store (or, with None, clear) the model's vector on the chunk.

    The other column is left alone, so switching providers back and forth
    keeps both sets of vectors.
    """
    if is_local_model(model_id):
        chunk.embedding_local = vector
        return
    chunk.embedding = vector
    chunk.embedding_model = model_id if vector is not None else None


def chunk_embedding_text(chunk: MemoryChunk) -> str:
    """Text a chunk is embedded from: its enrichment context line (S5), then its content.

    The context line places the chunk in its document ("From the YOLO tutorial:
    anchor boxes ..."), so a question can match a passage whose own words don't
    say what it is about (contextual retrieval).
    """
    if chunk.context:
        return f"{chunk.context}\n\n{chunk.content}"
    return chunk.content
