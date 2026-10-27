"""OpenAI/Gemini embeddings for MemoryChunk vectors. Never writes synthetic vectors."""

from __future__ import annotations

import logging

from openai import OpenAI

from app.core.config import get_settings
from app.services.embedding_port import EmbeddingPort

logger = logging.getLogger(__name__)

class EmbeddingNotConfiguredError(RuntimeError):
    pass


class OpenAIEmbeddingAdapter(EmbeddingPort):
    def __init__(self) -> None:
        settings = get_settings()
        if not settings.openai_api_key:
            raise EmbeddingNotConfiguredError("OPENAI_API_KEY is not configured.")
        self._client = OpenAI(api_key=settings.openai_api_key, timeout=30.0)
        self._model = settings.openai_embedding_model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []
        payload = [text[:8000] if text else " " for text in texts]
        response = self._client.embeddings.create(model=self._model, input=payload)
        ordered = sorted(response.data, key=lambda item: item.index)
        return [list(item.embedding) for item in ordered]


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
        self._model = settings.gemini_embedding_model

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        if not texts:
            return []

        from google.genai import types

        settings = get_settings()
        dim = settings.embedding_dimensions
        vectors: list[list[float]] = []
        for text in texts:
            response = self._client.models.embed_content(
                model=self._model,
                contents=text[:8000] if text else " ",
                config=types.EmbedContentConfig(output_dimensionality=dim),
            )
            embeddings = response.embeddings or []
            if not embeddings or embeddings[0].values is None:
                raise RuntimeError("Gemini returned no embedding values.")
            values = [float(value) for value in embeddings[0].values]
            if len(values) != dim:
                raise RuntimeError(
                    f"Gemini embedding dimension {len(values)} != {dim}."
                )
            vectors.append(values)
        return vectors


EMBEDDING_PROVIDERS = ("auto", "openai", "gemini", "none")


def resolve_embedding_provider() -> str | None:
    """Return "openai", "gemini", or None (lexical-only search)."""
    settings = get_settings()
    choice = (settings.embedding_provider or "auto").strip().lower()
    if choice not in EMBEDDING_PROVIDERS:
        logger.error(
            "Unknown EMBEDDING_PROVIDER=%r; expected one of %s. Semantic search disabled.",
            choice,
            ", ".join(EMBEDDING_PROVIDERS),
        )
        return None
    if choice == "none":
        return None
    if choice == "openai":
        return "openai" if settings.openai_api_key else None
    if choice == "gemini":
        return "gemini" if settings.gemini_api_key else None
    # auto
    if settings.llm_provider == "gemini":
        return "gemini" if settings.gemini_api_key else None
    if settings.llm_provider == "openai":
        return "openai" if settings.openai_api_key else None
    if settings.openai_api_key:
        return "openai"
    if settings.gemini_api_key:
        return "gemini"
    return None


def get_embedding_adapter() -> EmbeddingPort | None:
    try:
        provider = resolve_embedding_provider()
        if provider == "gemini":
            return GeminiEmbeddingAdapter()
        if provider == "openai":
            return OpenAIEmbeddingAdapter()
        return None
    except Exception:
        logger.exception("Failed to initialize embedding adapter")
        return None
