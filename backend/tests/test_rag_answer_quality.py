from datetime import UTC, datetime
from uuid import uuid4

from app.models.memory_item import SourceType
from app.services.rag_service import SYSTEM_PROMPT, _build_context, _local_fallback_answer
from app.services.retrieval_service import RetrievedChunk


def _chunk(title: str, content: str, url: str = "https://docs.example.com/x") -> RetrievedChunk:
    return RetrievedChunk(
        chunk_id=uuid4(),
        memory_id=uuid4(),
        title=title,
        url=url,
        source_type=SourceType.webpage,
        content=content,
        domain="docs.example.com",
        heading=None,
        page_number=None,
        captured_at=datetime.now(UTC),
        distance=0.1,
        lexical=True,
        rank=1.0,
    )


def test_system_prompt_asks_for_adaptive_depth_not_one_liners() -> None:
    assert "Keep the default answer short" not in SYSTEM_PROMPT
    assert "1–3 short paragraphs" not in SYSTEM_PROMPT
    assert "2–5 useful bullets" in SYSTEM_PROMPT
    assert "untrusted" in SYSTEM_PROMPT.lower()
    assert "Do not add outside world knowledge" in SYSTEM_PROMPT


def test_build_context_keeps_leading_chunk_instead_of_equal_split() -> None:
    first = "A" * 1400
    others = [_chunk("Later", "B" * 1400) for _ in range(7)]
    packed = _build_context([_chunk("First", first), *others], max_chars=6000)
    assert packed.count("A") >= 1200
    assert "Title: First" in packed


def test_local_fallback_stays_short_for_tiny_memory() -> None:
    chunk = _chunk("Tiny Note", "Binary search halves the remaining interval.")
    answer = _local_fallback_answer([chunk])
    assert answer.count("\n") <= 2
    assert "halves the remaining interval" in answer.lower()
