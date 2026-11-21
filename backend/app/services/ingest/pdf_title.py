"""Readable titles for PDFs saved without a metadata title.

A PDF with no title metadata reaches us titled by its file name ("TCS
NQT.pdf") or, for arXiv, by its ID ("1706.03762"). A file name with real
words is kept without its extension; a title with no words is replaced by the
first heading-like line near the top of the document.
"""

from __future__ import annotations

import re

_EXTENSION_RE = re.compile(r"\.pdf$", re.IGNORECASE)
_WORD_RE = re.compile(r"[A-Za-z]{3,}")
_GENERIC_NAMES = {"document", "download", "file", "view", "pdf", "untitled", "paper"}
# Only the first lines are considered: a title sits near the top.
_MAX_LINES = 20
_MAX_TITLE_CHARS = 150


def _has_words(title: str) -> bool:
    return bool(_WORD_RE.search(title)) and title.strip().lower() not in _GENERIC_NAMES


def _looks_like_title(line: str) -> bool:
    if not 4 <= len(line) <= _MAX_TITLE_CHARS:
        return False
    if line.endswith((".", ",", ";", ":", "?", "!")) or "@" in line or "http" in line:
        return False
    words = [w for w in re.split(r"\s+", line) if w]
    if len(words) < 2:
        return False
    long_words = [w for w in words if len(w) > 3 and w[0].isalpha()]
    if not long_words:
        return False
    capitalised = sum(1 for w in long_words if w[0].isupper())
    return capitalised / len(long_words) >= 0.6


def first_heading(content: str) -> str | None:
    for raw in content.splitlines()[:_MAX_LINES]:
        line = " ".join(raw.split())
        if _looks_like_title(line):
            return line
    return None


def readable_pdf_title(title: str, content: str) -> str:
    """The title to show for a PDF: unchanged unless it is a file name or an ID."""
    stripped = _EXTENSION_RE.sub("", title.strip()).strip()
    if _has_words(stripped):
        return stripped if stripped != title.strip() else title
    return first_heading(content) or title
