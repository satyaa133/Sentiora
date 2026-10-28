"""Split captured text into searchable chunks.

Articles and PDFs use a recursive splitter (``recursive.py``); timed YouTube
transcripts use time windows (``transcript.py``). Chunk text is body text only;
titles live on the memory and headings in their own column.
"""

from app.services.chunking.recursive import chunk_content
from app.services.chunking.transcript import chunk_transcript, format_timestamp
from app.services.chunking.types import (
    CHARS_PER_TOKEN,
    MAX_CHUNK_CHARS,
    TARGET_CHUNK_CHARS,
    ChunkDraft,
)

__all__ = [
    "CHARS_PER_TOKEN",
    "MAX_CHUNK_CHARS",
    "TARGET_CHUNK_CHARS",
    "ChunkDraft",
    "chunk_content",
    "chunk_transcript",
    "format_timestamp",
]
