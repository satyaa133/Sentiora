"""OpenAI embeddings for MemoryChunk vectors. Never writes synthetic vectors."""

from __future__ import annotations

import logging

from openai import OpenAI

from app.core.config import get_settings
from app.services.embedding_port import EmbeddingPort

logger = logging.getLogger(__name__)

EMBEDDING_DIMENSIONS = 1536


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


def get_embedding_adapter() -> OpenAIEmbeddingAdapter | None:
    settings = get_settings()
    if not settings.openai_api_key:
        return None
    return OpenAIEmbeddingAdapter()
