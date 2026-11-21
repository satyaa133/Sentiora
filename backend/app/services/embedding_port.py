"""Interface every embedding provider implements."""

from typing import Protocol


class EmbeddingPort(Protocol):
    # Stable "provider:model" id. Remote providers store it on each chunk
    # (memory_chunks.embedding_model) and vectors are only compared with
    # vectors that have the same id; "local:<model>" vectors live in
    # memory_chunks.embedding_local.
    model_id: str
    # Length of every vector this adapter returns.
    dimensions: int

    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per saved passage."""
        ...

    def embed_query(self, text: str) -> list[float]:
        """Return the embedding of a search question."""
        ...
