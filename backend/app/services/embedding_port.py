"""Phase 5 embedding hook.

Chunk storage is complete in Phase 4. Vector generation must not run yet
and must not write fake embeddings.
"""

from typing import Protocol


class EmbeddingPort(Protocol):
    def embed_texts(self, texts: list[str]) -> list[list[float]]:
        """Return one embedding vector per input text."""
        ...
