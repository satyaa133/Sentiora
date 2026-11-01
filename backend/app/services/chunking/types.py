from __future__ import annotations

from dataclasses import dataclass

# Sizes are in tokens, estimated at ~4 characters each (no tokenizer dependency).
CHARS_PER_TOKEN = 4
MIN_CHUNK_TOKENS = 400
TARGET_CHUNK_TOKENS = 500
MAX_CHUNK_TOKENS = 600
OVERLAP_RATIO = 0.15

TARGET_CHUNK_CHARS = TARGET_CHUNK_TOKENS * CHARS_PER_TOKEN
MAX_CHUNK_CHARS = MAX_CHUNK_TOKENS * CHARS_PER_TOKEN
MIN_CHUNK_CHARS = MIN_CHUNK_TOKENS * CHARS_PER_TOKEN
OVERLAP_CHARS = int(TARGET_CHUNK_CHARS * OVERLAP_RATIO)
# A section shorter than this is merged with the next one instead of becoming
# its own chunk, so short headed sections don't produce tiny chunks.
MIN_SECTION_CHARS = 200


@dataclass(frozen=True)
class ChunkDraft:
    chunk_index: int
    content: str
    heading: str | None = None
    page_number: int | None = None
    start_sec: float | None = None
    end_sec: float | None = None
