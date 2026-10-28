from app.models.memory_item import SourceType
from app.services.chunking import (
    MAX_CHUNK_CHARS,
    TARGET_CHUNK_CHARS,
    chunk_content,
    chunk_transcript,
)
from app.services.chunking.types import MIN_CHUNK_CHARS

SENTENCE = "Dijkstra's algorithm relaxes edges in order of their tentative distance."


def _article(paragraphs: int) -> str:
    return "\n\n".join(" ".join([SENTENCE] * 6) for _ in range(paragraphs))


def _timed(count: int, seconds: float, words: int = 30) -> list[dict]:
    return [
        {
            "id": f"n{i}",
            "type": "paragraph",
            "text": f"part{i} " + " ".join(["word"] * words),
            "order": i,
            "metadata": {
                "start_seconds": i * seconds,
                "end_seconds": (i + 1) * seconds,
            },
        }
        for i in range(count)
    ]


def test_long_article_chunks_are_400_to_600_tokens() -> None:
    chunks = chunk_content(_article(30), SourceType.webpage)
    assert len(chunks) > 3
    for chunk in chunks[:-1]:
        assert MIN_CHUNK_CHARS <= len(chunk.content) <= MAX_CHUNK_CHARS
    assert all(len(c.content) <= MAX_CHUNK_CHARS for c in chunks)


def test_consecutive_chunks_overlap() -> None:
    chunks = chunk_content(_article(30), SourceType.webpage)
    for previous, current in zip(chunks, chunks[1:], strict=False):
        tail = previous.content[-120:]
        assert tail.split(". ")[-1] in current.content[: TARGET_CHUNK_CHARS // 3]


def test_chunks_end_on_sentence_boundaries() -> None:
    for chunk in chunk_content(_article(30), SourceType.webpage):
        assert chunk.content.endswith(".")


def test_headings_are_chunk_boundaries() -> None:
    text = f"Shortest paths\n\n{_article(3)}\n\nMinimum spanning trees\n\n{_article(3)}"
    chunks = chunk_content(text, SourceType.webpage)
    headings = [c.heading for c in chunks]
    assert headings[0] == "Shortest paths"
    assert headings[-1] == "Minimum spanning trees"
    assert all("Minimum spanning trees" not in c.content for c in chunks)


def test_pdf_pages_never_share_a_chunk() -> None:
    text = f"Page 1\n{_article(2)}\n\nPage 2\n{_article(2)}"
    chunks = chunk_content(text, SourceType.pdf)
    assert {c.page_number for c in chunks} == {1, 2}


def test_transcript_windows_are_60_to_90_seconds_with_times() -> None:
    drafts = chunk_transcript(_timed(40, 10.0))
    assert len(drafts) >= 5
    for draft in drafts:
        assert draft.start_sec is not None and draft.end_sec is not None
        assert draft.end_sec - draft.start_sec <= 90.0
        assert draft.heading == draft.heading and draft.heading.startswith("[")
    for draft in drafts[:-1]:
        assert draft.end_sec - draft.start_sec >= 60.0
    starts = [d.start_sec for d in drafts]
    assert starts == sorted(starts)


def test_transcript_windows_overlap_without_rewinding() -> None:
    drafts = chunk_transcript(_timed(40, 10.0))
    for previous, current in zip(drafts, drafts[1:], strict=False):
        assert previous.start_sec < current.start_sec < previous.end_sec
        assert previous.content.split()[-1] in current.content


def test_transcript_segment_longer_than_a_window_is_split() -> None:
    drafts = chunk_transcript(_timed(1, 300.0, words=600))
    assert len(drafts) >= 3
    assert all(d.end_sec - d.start_sec <= 90.0 for d in drafts)
    assert drafts[-1].end_sec == 300.0


def test_heading_only_text_is_kept_as_body() -> None:
    text = "JioHotstar - Watch TV Shows, Movies, Specials, Live Cricket & Football"
    chunks = chunk_content(text, SourceType.webpage)
    assert [c.content for c in chunks] == [text]
