"""Clean YouTube transcripts before chunking.

Auto-generated YouTube captions "roll": each cue repeats the tail of the one
before it, so naive concatenation produces text like
"I took off this three I moved L I took off this three I moved L". This module
removes that overlap while keeping each cue's timestamps.
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace

_PUNCT_RE = re.compile(r"[^\w']+", re.UNICODE)
_WS_RE = re.compile(r"\s+")

# How far back into already-merged text a new cue may overlap.
_TAIL_TOKENS = 80
# A suffix/prefix overlap shorter than this is likely coincidence ("the the").
_MIN_OVERLAP = 2
_MAX_NGRAM = 15


@dataclass(frozen=True)
class Cue:
    text: str
    start: float | None = None
    end: float | None = None
    # Position of the cue in its source list, so callers can map back.
    source: int | None = None


def _key(token: str) -> str:
    return _PUNCT_RE.sub("", token.lower())


def _tokens(text: str) -> list[str]:
    return [token for token in _WS_RE.split(text.strip()) if token]


def normalize_whitespace(text: str) -> str:
    return _WS_RE.sub(" ", text).strip()


def collapse_repeated_ngrams(text: str, max_n: int = _MAX_NGRAM) -> str:
    """Collapse back-to-back repeats of any 2..max_n word phrase into one copy.

    Single repeated words are left alone ("had had", "very very" are real
    English); comparison ignores case and punctuation.
    """
    out: list[str] = []
    keys: list[str] = []
    for token in _tokens(text):
        out.append(token)
        keys.append(_key(token))
        collapsed = True
        while collapsed:
            collapsed = False
            for n in range(min(max_n, len(keys) // 2), 1, -1):
                if keys[-n:] == keys[-2 * n : -n]:
                    del out[-n:]
                    del keys[-n:]
                    collapsed = True
                    break
    return " ".join(out)


def _overlap(tail: list[str], head: list[str]) -> int:
    """Length of the longest suffix of ``tail`` equal to a prefix of ``head``."""
    for size in range(min(len(tail), len(head)), 0, -1):
        if tail[-size:] == head[:size]:
            return size
    return 0


def _contains(haystack: list[str], needle: list[str]) -> bool:
    size = len(needle)
    return any(
        haystack[i : i + size] == needle for i in range(len(haystack) - size + 1)
    )


def merge_rolling_cues(cues: list[Cue]) -> list[Cue]:
    """Remove text each cue repeats from the cues before it.

    For every cue, the longest suffix of the merged text that matches the cue's
    prefix is dropped from the cue. A cue whose words already appear in the
    recent merged text is dropped, and the previous cue's end time is extended
    to cover it. Remaining cues keep their own start and end.
    """
    merged: list[Cue] = []
    tail: list[str] = []
    for cue in cues:
        words = _tokens(collapse_repeated_ngrams(cue.text))
        if not words:
            continue
        keys = [_key(word) for word in words]

        if merged and len(keys) >= _MIN_OVERLAP and _contains(tail, keys):
            merged[-1] = _extend(merged[-1], cue)
            continue

        size = _overlap(tail, keys)
        if size < _MIN_OVERLAP and size != len(keys):
            size = 0
        rest = words[size:]
        if not rest:
            if merged:
                merged[-1] = _extend(merged[-1], cue)
            continue

        merged.append(replace(cue, text=" ".join(rest)))
        tail = (tail + keys[size:])[-_TAIL_TOKENS:]
    return merged


def _extend(previous: Cue, cue: Cue) -> Cue:
    if cue.end is None:
        return previous
    end = cue.end if previous.end is None else max(previous.end, cue.end)
    return replace(previous, end=end)


def clean_transcript_text(text: str) -> str:
    """Clean untimed transcript text, treating each paragraph as one cue."""
    paragraphs = [part for part in re.split(r"\n{2,}", text or "") if part.strip()]
    cues = merge_rolling_cues(
        [Cue(text=normalize_whitespace(part)) for part in paragraphs]
    )
    return "\n\n".join(cue.text for cue in cues)


def clean_transcript_nodes(structured_content: object) -> list[dict] | None:
    """Clean timed transcript nodes from a capture's ``structured_content``.

    Returns the nodes in order with overlap removed (empty nodes dropped, the
    previous node's ``end_seconds`` extended over them), or None when the
    content has no timed nodes.
    """
    if not isinstance(structured_content, list):
        return None
    timed: list[tuple[float, int, dict]] = []
    for position, node in enumerate(structured_content):
        if not isinstance(node, dict):
            continue
        meta = node.get("metadata")
        start = meta.get("start_seconds") if isinstance(meta, dict) else None
        if (
            not isinstance(start, int | float)
            or not str(node.get("text") or "").strip()
        ):
            continue
        order = node.get("order")
        timed.append(
            (float(start), order if isinstance(order, int) else position, node)
        )
    if not timed:
        return None
    timed.sort(key=lambda entry: (entry[1], entry[0]))

    nodes = [node for _, _, node in timed]
    cues = []
    for index, node in enumerate(nodes):
        meta = node["metadata"]
        end = meta.get("end_seconds")
        cues.append(
            Cue(
                text=str(node.get("text")),
                start=float(meta["start_seconds"]),
                end=float(end) if isinstance(end, int | float) else None,
                source=index,
            )
        )

    cleaned: list[dict] = []
    for order, cue in enumerate(merge_rolling_cues(cues)):
        source = nodes[cue.source if cue.source is not None else 0]
        metadata = dict(source["metadata"])
        if cue.end is not None:
            metadata["end_seconds"] = cue.end
        cleaned.append(
            {**source, "text": cue.text, "order": order, "metadata": metadata}
        )
    return cleaned
