from collections.abc import Sequence
from uuid import UUID

from sqlalchemy import delete, select
from sqlalchemy.orm import Session as DBSession

from app.models.memory_chunk import MemoryChunk


class ChunkRepository:
    def __init__(self, db: DBSession) -> None:
        self.db = db

    def replace_for_memory(
        self,
        memory_id: UUID,
        user_id: UUID,
        chunks: Sequence[MemoryChunk],
    ) -> list[MemoryChunk]:
        self.db.execute(
            delete(MemoryChunk).where(
                MemoryChunk.memory_id == memory_id,
                MemoryChunk.user_id == user_id,
            )
        )
        for chunk in chunks:
            self.db.add(chunk)
        self.db.flush()
        return list(chunks)

    def list_for_memory(self, memory_id: UUID, user_id: UUID) -> list[MemoryChunk]:
        stmt = (
            select(MemoryChunk)
            .where(
                MemoryChunk.memory_id == memory_id,
                MemoryChunk.user_id == user_id,
            )
            .order_by(MemoryChunk.chunk_index.asc())
        )
        return list(self.db.execute(stmt).scalars())

    def delete_for_memory(self, memory_id: UUID, user_id: UUID) -> None:
        self.db.execute(
            delete(MemoryChunk).where(
                MemoryChunk.memory_id == memory_id,
                MemoryChunk.user_id == user_id,
            )
        )
