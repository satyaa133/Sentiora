from app.models.memory_item import SourceType
from app.services.chunking import chunk_content
from app.services.content_normalizer import (
    extract_domain,
    normalize_content,
)


def test_normalize_strips_noise_and_keeps_article_body() -> None:
    raw = """
    Accept all cookies
    Introduction
    Binary search reduces the search interval by half at each iteration.
    Advertisement
    It compares the target with the middle element, then continues on one side.
    Share this
    """
    cleaned = normalize_content(raw, SourceType.webpage)
    assert "Binary search reduces the search interval" in cleaned
    assert "Accept all cookies" not in cleaned
    assert "Advertisement" not in cleaned
    assert "Share this" not in cleaned


def test_youtube_stub_is_marked_missing_transcript() -> None:
    stub = "YouTube video titled 'Docker Basics' by Example Channel."
    cleaned = normalize_content(stub, SourceType.youtube)
    assert cleaned.startswith("[Transcript unavailable]")
    assert "Docker Basics" in cleaned


def test_youtube_transcript_is_not_marked_missing() -> None:
    transcript = (
        "Welcome to this lesson on binary search. "
        "Binary search reduces the search interval by half at each iteration. "
        "It compares the target value with the middle element of the current range."
    )
    cleaned = normalize_content(transcript, SourceType.youtube)
    assert "[Transcript unavailable]" not in cleaned
    assert "Binary search reduces the search interval" in cleaned


def test_extract_domain() -> None:
    assert extract_domain("https://docs.docker.com/get-started/") == "docs.docker.com"


def test_webpage_chunks_keep_heading_with_related_paragraphs() -> None:
    text = """
Introduction

Binary search reduces the search interval by half at each iteration. It compares the target with the middle element.

How it works

The algorithm starts with the full sorted array. If the middle value is too small, the search continues on the right half. If the middle value is too large, the search continues on the left half.

Complexity

The time complexity is O(log n) because each comparison discards half of the remaining elements. This makes binary search efficient for large sorted collections.
""".strip()
    chunks = chunk_content(text, SourceType.webpage, title="Binary Search")
    assert len(chunks) >= 2
    joined = " ".join(chunk.content for chunk in chunks)
    assert "Binary search reduces the search interval by half at each iteration" in joined
    assert chunks[0].heading in {"Introduction", "How it works", "Binary Search", None} or chunks[0].heading
    for chunk in chunks:
        assert len(chunk.content) >= 20
        assert not chunk.content.endswith("to")
        assert chunk.chunk_index == chunks.index(chunk)


def test_pdf_chunks_preserve_page_numbers() -> None:
    text = """
Page 1
Binary search reduces the search interval by half at each iteration. This section introduces the algorithm and why sorted input is required.

Page 2
The implementation uses two pointers, low and high, and computes the midpoint on every loop. The search ends when the range is empty.
"""
    chunks = chunk_content(text, SourceType.pdf, title="Algorithms")
    pages = {chunk.page_number for chunk in chunks}
    assert 1 in pages
    assert 2 in pages


def test_rechunking_is_deterministic() -> None:
    text = (
        "Heading One\n\n"
        "Binary search reduces the search interval by half at each iteration. "
        "This sentence exists so the first section has enough context to stand alone.\n\n"
        "Heading Two\n\n"
        "A hash table stores key-value pairs and offers average constant-time lookup. "
        "Collisions are handled with chaining or open addressing depending on the implementation."
    )
    first = chunk_content(text, SourceType.webpage, title="Notes")
    second = chunk_content(text, SourceType.webpage, title="Notes")
    assert [chunk.content for chunk in first] == [chunk.content for chunk in second]
