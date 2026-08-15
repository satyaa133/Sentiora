"""Content normalisation utilities for captured memory content.

Handles HTML stripping, whitespace normalisation, noise-line removal, and
YouTube-specific transcript annotation.

Noise patterns are kept conservative: only remove lines that are clearly
navigation/UI artefacts with zero informational value.
"""

from __future__ import annotations

import re
import hashlib
from urllib.parse import urlparse, parse_qsl, urlencode, urlunparse

from app.models.memory_item import SourceType

_HTML_TAG_RE = re.compile(r"<[^>]+>")
_WHITESPACE_RE = re.compile(r"[ \t]+")
_MULTI_NEWLINE_RE = re.compile(r"\n{3,}")
_METRIC_RE = re.compile(r"^\d+(,\d{3})*(\.\d+)?[kmKMbBtT]?$", re.IGNORECASE)
_DUPLICATE_LINE_RE = re.compile(r"^(?P<line>.+)(?:\n(?P=line)){2,}", re.MULTILINE)

# Core cookie / navigation noise — exact phrase matches
_NOISE_LINE_RE = re.compile(
    r"^("
    # Cookie / consent banners
    r"accept all cookies|reject all|cookie settings|we use cookies|"
    r"manage preferences|privacy policy|terms of service|"
    # Auth / subscription CTAs
    r"subscribe to (our )?newsletter|sign in|log in|sign up|create account|"
    r"already have an account|"
    # Social / sharing
    r"share this|share on|tweet this|follow us|"
    # Ad labels
    r"advertisement|sponsored content|sponsored|"
    # Navigation chrome
    r"related articles|trending now|you might (also )?like|"
    r"skip to (main )?content|enable javascript|"
    # Footer / legal
    r"all rights reserved|copyright ©|"
    # Coding-tutorial site chrome (GeeksforGeeks, TUF+, LeetCode, etc.)
    r"check out tuf\+?|tuf\+|practice now|try it yourself|try it now|"
    r"run on ide|run code|open in ide|"
    r"next article|previous article|next →|← previous|"
    r"similar reads?|also read|recommended for you|"
    r"read more|\.\.\.more|load more|show more|view more|"
    r"improve this article|"
    # Generic UI chrome
    r"menu|close|open|search\.\.\.|"
    r"article tags"
    r")$",
    re.IGNORECASE,
)

# Lines that are purely numeric stats (view counts, like counts, etc.)
_PURE_NUMERIC_RE = re.compile(
    r"^[\d,\s]+(views?|likes?|shares?|comments?|followers?|subscribers?)?$",
    re.IGNORECASE,
)

_YOUTUBE_STUB_RE = re.compile(
    r"^youtube video titled ['\"].+['\"] by .+\.?$",
    re.IGNORECASE,
)


def canonicalize_url(url: str) -> str:
    if not url:
        return ""
    try:
        parsed = urlparse(url)
        scheme = parsed.scheme.lower()
        netloc = parsed.netloc.lower()
        path = parsed.path
        # Normalize trailing slash in path if present (except for root path)
        if len(path) > 1 and path.endswith("/"):
            path = path[:-1]
        
        # Remove known tracking parameters
        query_params = parse_qsl(parsed.query, keep_blank_values=True)
        cleaned_params = []
        for key, val in query_params:
            lower_key = key.lower()
            if (
                lower_key.startswith("utm_")
                or lower_key in ("fbclid", "gclid", "ref", "source", "campaign")
            ):
                continue
            cleaned_params.append((key, val))
        
        new_query = urlencode(cleaned_params)
        canonical = urlunparse((scheme, netloc, path, parsed.params, new_query, parsed.fragment))
        return canonical
    except Exception:
        return url


def compute_content_hash(text: str) -> str:
    if not text:
        return ""
    normalized = text.strip()
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()


def extract_domain(url: str) -> str | None:
    if not url:
        return None
    try:
        host = urlparse(url).hostname
    except ValueError:
        return None
    if not host:
        return None
    return host.lower()


def detect_language(text: str) -> str | None:
    if not text or len(text) < 40:
        return None
    sample = text[:1000]
    letters = [ch for ch in sample if ch.isalpha()]
    if not letters:
        return None
    ascii_letters = sum(1 for ch in letters if ch.isascii())
    if ascii_letters / len(letters) >= 0.9:
        return "en"
    return None


def _strip_metric_streaks(text: str) -> str:
    """Remove long runs of bare numeric metrics (e.g., view counts in a row)."""
    words = text.split(" ")
    cleaned: list[str] = []
    stat_streak = 0
    for word in words:
        if _METRIC_RE.match(word.replace(",", "")):
            stat_streak += 1
            if stat_streak <= 2:
                cleaned.append(word)
            continue
        stat_streak = 0
        cleaned.append(word)
    return " ".join(cleaned)


def _is_noise_line(line: str) -> bool:
    compact = re.sub(r"\s+", " ", line).strip()
    if not compact:
        return True
    # Very short lines are almost certainly UI artefacts, not content.
    if len(compact) < 4:
        return True
    if _NOISE_LINE_RE.match(compact):
        return True
    return bool(_PURE_NUMERIC_RE.match(compact))


def normalize_content(text: str | None, source_type: SourceType) -> str:
    if not text:
        return ""

    cleaned = _HTML_TAG_RE.sub(" ", text)
    cleaned = cleaned.replace("\r\n", "\n").replace("\r", "\n").replace("\f", "\n")
    cleaned = _WHITESPACE_RE.sub(" ", cleaned)
    cleaned = _MULTI_NEWLINE_RE.sub("\n\n", cleaned)

    cleaned_lines: list[str] = []
    previous = None
    for raw_line in cleaned.split("\n"):
        line = _strip_metric_streaks(raw_line.strip())
        if source_type == SourceType.youtube:
            if not line or line == previous:
                continue
        elif _is_noise_line(line) or line == previous:
            continue
        cleaned_lines.append(line)
        previous = line

    cleaned = "\n".join(cleaned_lines)
    cleaned = _DUPLICATE_LINE_RE.sub(r"\g<line>", cleaned)
    cleaned = _MULTI_NEWLINE_RE.sub("\n\n", cleaned).strip()

    if source_type == SourceType.youtube:
        cleaned = _mark_missing_youtube_transcript(cleaned)

    return cleaned


def _mark_missing_youtube_transcript(content: str) -> str:
    if "[Transcript unavailable]" in content:
        return content
    compact = re.sub(r"\s+", " ", content).strip()
    if _YOUTUBE_STUB_RE.match(compact):
        return f"[Transcript unavailable]\n\n{content}".strip()
    return content


def calculate_word_count(text: str) -> int:
    if not text:
        return 0
    return len(text.split())


def calculate_reading_time(word_count: int) -> int:
    if word_count <= 0:
        return 0
    minutes = word_count / 200
    return max(1, int(minutes * 60))
