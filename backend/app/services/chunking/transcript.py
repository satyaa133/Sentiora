"""Time-window chunks for timed YouTube transcripts.

Segments are packed into windows of about 60–90 seconds. Each chunk records
its ``start_sec``/``end_sec`` and a ``[mm:ss–mm:ss]`` heading so citations can
open the video at the right moment. Consecutive windows overlap by roughly 15%
of the previous window's words.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.services.chunking.types import MAX_CHUNK_CHARS, OVERLAP_RATIO, ChunkDraft

MIN_WINDOW_SECONDS = 60.0
MAX_WINDOW_SECONDS = 90.0


@dataclass
class _Segment:
    text: str
    start: float
    end: float


def format_timestamp(seconds: float) -> str:
    total = max(0, int(seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def _segments(structured_content: object) -> list[_Segment]:
    """Ordered transcript segments; empty if untimed or malformed."""
    if not isinstance(structured_content, list):
        return []
    found: list[tuple[int, _Segment]] = []
    for node in structured_content:
        if not isinstance(node, dict):
            continue
        text = " ".join(str(node.get("text") or "").split())
        meta = node.get("metadata")
        start = meta.get("start_seconds") if isinstance(meta, dict) else None
        if not text or not isinstance(start, int | float):
            continue
        end = meta.get("end_seconds") if isinstance(meta, dict) else None
        end_value = float(end) if isinstance(end, int | float) else float(start)
        order = node.get("order")
        found.append(
            (
                order if isinstance(order, int) else len(found),
                _Segment(text, float(start), max(end_value, float(start))),
            )
        )
    found.sort(key=lambda entry: (entry[0], entry[1].start))
    return [piece for _, segment in found for piece in _split_long(segment)]


def _split_long(segment: _Segment) -> list[_Segment]:
    """Split a segment longer than a window (by time or text) evenly in time."""
    duration = segment.end - segment.start
    words = segment.text.split()
    parts = max(
        1,
        int(duration // MAX_WINDOW_SECONDS)
        + (1 if duration % MAX_WINDOW_SECONDS else 0),
        -(-len(segment.text) // MAX_CHUNK_CHARS),
    )
    if parts == 1 or len(words) < parts:
        return [segment]
    per_part = -(-len(words) // parts)
    step = duration / parts
    return [
        _Segment(
            " ".join(words[i * per_part : (i + 1) * per_part]),
            segment.start + i * step,
            segment.start + (i + 1) * step,
        )
        for i in range(parts)
        if words[i * per_part : (i + 1) * per_part]
    ]


def chunk_transcript(
    structured_content: object,
    *,
    title: str | None = None,
) -> list[ChunkDraft]:
    """Pack timed transcript segments into 60–90 second chunks.

    Returns [] when the content has no timed segments, so callers can fall back
    to plain-text chunking. ``title`` is accepted for compatibility and not used.
    """
    segments = _segments(structured_content)
    if not segments:
        return []

    drafts: list[ChunkDraft] = []
    window: list[_Segment] = []
    # True while the window holds only overlap carried from the previous chunk.
    carried = False

    def flush() -> None:
        nonlocal window, carried
        start, end = window[0].start, max(segment.end for segment in window)
        drafts.append(
            ChunkDraft(
                chunk_index=len(drafts),
                content=" ".join(segment.text for segment in window),
                heading=f"[{format_timestamp(start)}–{format_timestamp(end)}]",
                start_sec=start,
                end_sec=end,
            )
        )
        window = [_overlap(window)]
        carried = True

    for segment in segments:
        if window:
            span = max(segment.end, window[-1].end) - window[0].start
            chars = sum(len(s.text) + 1 for s in window) + len(segment.text)
            if span > MAX_WINDOW_SECONDS or chars > MAX_CHUNK_CHARS:
                if not carried:
                    flush()
                # Keep the carried overlap only if the new segment still fits.
                span = max(segment.end, window[-1].end) - window[0].start
                chars = len(window[0].text) + 1 + len(segment.text)
                if span > MAX_WINDOW_SECONDS or chars > MAX_CHUNK_CHARS:
                    window = []
        window.append(segment)
        carried = False
        if window[-1].end - window[0].start >= MIN_WINDOW_SECONDS:
            flush()
    if window and not carried:
        flush()
    return drafts


def _overlap(window: list[_Segment]) -> _Segment:
    """The trailing ~15% of a window's words, with a start time interpolated
    from where those words fall inside their segment."""
    words = [
        (word, segment, index, len(segment.text.split()))
        for segment in window
        for index, word in enumerate(segment.text.split())
    ]
    keep = max(1, int(len(words) * OVERLAP_RATIO))
    tail = words[-keep:]
    _, segment, index, count = tail[0]
    start = segment.start + (segment.end - segment.start) * index / max(count, 1)
    return _Segment(" ".join(word for word, *_ in tail), start, window[-1].end)
