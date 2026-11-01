"""Embedding providers for MemoryChunk vectors. Never writes synthetic vectors.

Exactly one provider is active at a time (``resolve_embedding_provider``).
Chunks record the ``model_id`` that embedded them, and query embeddings come
from the same adapter, so a query is never compared with vectors from a
different model. There is no cross-provider fallback: when the active provider
fails, callers fall back to full-text search.
"""

from __future__ import annotations

import logging

import openai
from openai import OpenAI

from app.core.config import get_settings, openrouter_keys
from app.services.embedding_port import EmbeddingPort
from app.services.llm_pool import (
    LLMBackend,
    key_pool,
    max_attempts,
    retry_after_seconds,
)

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
        self._dimensions = settings.embedding_dimensions

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
                timeout=30.0,
                max_retries=0,
            )
            try:
                response = client.embeddings.create(model=self._model, input=batch)
            except openai.APIStatusError as exc:
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
            key_pool.mark_ok(backend)
            ordered = sorted(response.data or [], key=lambda item: item.index)
            vectors = [list(item.embedding) for item in ordered]
            if len(vectors) != len(batch):
                raise RuntimeError(
                    f"OpenRouter returned {len(vectors)} embeddings for {len(batch)} inputs."
                )
            _check_dimensions(vectors, self._dimensions, "OpenRouter")
            return vectors
        raise RuntimeError(f"Every OpenRouter key failed to embed: {last_error}")


class OpenAIEmbeddingAdapter(EmbeddingPort):
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise EmbeddingNotConfiguredError("OPENAI_API_KEY is not configured.")
        self._client = OpenAI(api_key=settings.openai_api_key, timeout=30.0)
        self._model = settings.embedding_model or settings.openai_embedding_model
        self.model_id = f"openai:{self._model}"
        self._dimensions = settings.embedding_dimensions

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        response = self._client.embeddings.create(
            model=self._model, input=[_clip(t) for t in texts]
        )
        ordered = sorted(response.data, key=lambda item: item.index)
        vectors = [list(item.embedding) for item in ordered]
        _check_dimensions(vectors, self._dimensions, "OpenAI")
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
            http_options=types.HttpOptions(timeout=30_000),  # ms; matches OpenAI
        )
        self._model = settings.embedding_model or settings.gemini_embedding_model
        self.model_id = f"gemini:{self._model}"

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        from google.genai import types

        dim = get_settings().embedding_dimensions
        vectors: list[list[float]] = []
        for text in texts:
            response = self._client.models.embed_content(
                model=self._model,
                contents=_clip(text),
                config=types.EmbedContentConfig(output_dimensionality=dim),
            )
            embeddings = response.embeddings or []
            if not embeddings or embeddings[0].values is None:
                raise RuntimeError("Gemini returned no embedding values.")
            vectors.append([float(value) for value in embeddings[0].values])
        _check_dimensions(vectors, dim, "Gemini")
        return vectors


EMBEDDING_PROVIDERS = ("auto", "openrouter", "openai", "gemini", "none")


def resolve_embedding_provider() -> str | None:
    """Return "openrouter", "openai", "gemini", or None (full-text-only search)."""
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
    return None
