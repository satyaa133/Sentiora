"""Interface every embedding provider implements."""

from typing import Protocol


class EmbeddingPort(Protocol):
    # Stable "provider:model" id stored on each chunk (memory_chunks.embedding_model).
    # Vectors are only compared with vectors that have the same id.
    model_id: str

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text."""
        ...
