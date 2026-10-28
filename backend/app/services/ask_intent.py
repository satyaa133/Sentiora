"""Question intent for Ask: which answer mode a question needs.

Pure functions with no I/O, so routing stays easy to test.

- personal: about the user's own saved memory ("what did I save", "the video")
- combined: a concept explained through a saved source ("explain X based on the
  playlist I saved")
- open: anything else; general knowledge, optionally enriched by memory
"""

from __future__ import annotations

import re
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta, tzinfo
from typing import Literal
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from app.models.memory_item import SourceType

IntentKind = Literal["personal", "combined", "open"]

_PERSONAL_RE = re.compile(
    r"\b("
    r"i (saved|captured|bookmarked|read|watched|added|stored|clipped)|"
    r"i've (saved|captured|read|watched|added)|"
    r"did i|have i|do i have|"
    r"my (memory|memories|vault|notes|saves|captures|sources|library|history)|"
    r"(saved|captured|bookmarked) (by me|earlier|recently)|"
    r"(this|that|these|those) (article|video|playlist|pdf|page|webpage|paper|doc|document|"
    r"post|lecture|tutorial|source|memory|capture)s?|"
    # "the video" points at a save only when the noun ends the phrase
    # ("summarize the video", "what is the article about") — not "the page rank".
    r"the (article|video|playlist|pdf|page|webpage|paper|doc|document|post|lecture|"
    r"tutorial|source|memory|capture)s?(?=\s+(i|about|on|from|you|that|which|say|says|"
    r"cover|covers|mention|mentions|explain|explains)\b|\s*[?.!,]|\s*$)|"
    r"which (sources|memories|articles|videos|pdfs|pages|captures)|"
    r"in my|from my"
    r")\b",
    re.IGNORECASE,
)

_EXPLAIN_RE = re.compile(
    r"\b(what is|what are|what's|explain|how does|how do|how to|why does|why is|"
    r"teach me|help me understand|define|describe)\b",
    re.IGNORECASE,
)

_BASED_ON_RE = re.compile(
    r"\b(based on|according to|using|from|in|with)\b.{0,40}\b(i saved|i captured|"
    r"i watched|i read|my|the (article|video|playlist|pdf|page|paper|lecture|"
    r"tutorial|source))\b",
    re.IGNORECASE,
)

_LISTING_RE = re.compile(
    r"\b(what|which|show|list)\b.{0,30}\b(did i|have i|i)\s+"
    r"(save|saved|capture|captured|read|watch|watched|add|added|bookmark|bookmarked)\b",
    re.IGNORECASE,
)

_MENTION_RE = re.compile(
    r"\b(which|what) (sources|memories|articles|videos|pdfs|pages|captures|notes)\b"
    r".{0,20}\b(mention|mentions|cover|covers|talk about|discuss|discusses|about|on)\b"
    r"\s+(?P<topic>.+)",
    re.IGNORECASE,
)

_SELF_RE = re.compile(
    r"\b(i|i've|me|my|saved|save|captured|capture|bookmarked|watched|added|clipped|stored)\b",
    re.IGNORECASE,
)

_SOURCE_CUES: tuple[tuple[re.Pattern[str], SourceType], ...] = (
    (re.compile(r"\b(video|videos|youtube|playlist|lecture|lectures)\b", re.I), SourceType.youtube),
    (re.compile(r"\b(pdf|pdfs|paper|papers|document|documents)\b", re.I), SourceType.pdf),
    (re.compile(r"\b(article|articles|webpage|webpages|page|pages|blog|post)\b", re.I), SourceType.webpage),
)

_FOLLOWUP_RE = re.compile(
    r"^(and|also|so|then|but|what about|how about|why|more|another|again|"
    r"give me|show me|can you|tell me more)\b|\b(it|its|that|this|they|them|those|"
    r"these|above|previous|example|examples)\b",
    re.IGNORECASE,
)

_LEADING_QUESTION_RE = re.compile(
    r"^(please\s+)?(what is|what are|what's|explain|how does|how do|why does|why is|"
    r"teach me|help me understand|define|describe|tell me about)\s+(a |an |the )?",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class DateWindow:
    start: datetime  # inclusive, UTC
    end: datetime  # exclusive, UTC
    label: str


@dataclass(frozen=True)
class AskIntent:
    kind: IntentKind
    date_window: DateWindow | None = None
    source_type: SourceType | None = None
    listing: bool = False
    mention_topic: str | None = None


def resolve_timezone(name: str | None) -> tzinfo:
    if not name:
        return UTC
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError):
        return UTC


def _day_start(moment: datetime) -> datetime:
    return moment.replace(hour=0, minute=0, second=0, microsecond=0)


def parse_date_window(question: str, tz: tzinfo, now: datetime | None = None) -> DateWindow | None:
    """Map phrases like 'yesterday' or 'last 3 days' to a UTC range in the user's zone."""
    lower = (question or "").lower()
    local_now = (now or datetime.now(UTC)).astimezone(tz)
    today = _day_start(local_now)

    def window(start: datetime, end: datetime, label: str) -> DateWindow:
        return DateWindow(start.astimezone(UTC), end.astimezone(UTC), label)

    days = re.search(r"\b(last|past)\s+(\d{1,2})\s+days?\b", lower)
    if days:
        count = max(1, min(int(days.group(2)), 90))
        return window(today - timedelta(days=count - 1), local_now + timedelta(seconds=1), f"the last {count} days")
    if re.search(r"\byesterday\b", lower):
        return window(today - timedelta(days=1), today, "yesterday")
    if re.search(r"\btoday\b|\bthis morning\b|\bthis afternoon\b|\btonight\b", lower):
        return window(today, today + timedelta(days=1), "today")
    week_start = today - timedelta(days=today.weekday())
    if re.search(r"\blast week\b", lower):
        return window(week_start - timedelta(days=7), week_start, "last week")
    if re.search(r"\bthis week\b", lower):
        return window(week_start, today + timedelta(days=1), "this week")
    if re.search(r"\b(last|past) month\b", lower):
        return window(today - timedelta(days=30), today + timedelta(days=1), "the last 30 days")
    if re.search(r"\b(recently|lately)\b", lower):
        return window(today - timedelta(days=6), today + timedelta(days=1), "the last 7 days")
    return None


def source_cue(question: str) -> SourceType | None:
    for pattern, source in _SOURCE_CUES:
        if pattern.search(question or ""):
            return source
    return None


def classify(question: str, tz: tzinfo = UTC, now: datetime | None = None) -> AskIntent:
    text = " ".join((question or "").split())
    window = parse_date_window(text, tz, now)
    # A date alone does not make a question personal ("popular frameworks
    # recently"); it needs the user or a save verb next to it.
    personal = bool(_PERSONAL_RE.search(text)) or (
        window is not None and bool(_SELF_RE.search(text))
    )
    mention = _MENTION_RE.search(text)
    mention_topic = None
    if mention:
        mention_topic = mention.group("topic").strip(" ?.!\"'") or None
        personal = True

    if personal and _EXPLAIN_RE.search(text) and _BASED_ON_RE.search(text):
        kind: IntentKind = "combined"
    elif personal:
        kind = "personal"
    else:
        kind = "open"

    listing = kind == "personal" and window is not None and bool(_LISTING_RE.search(text))
    # Source cues only narrow retrieval when the user talks about their own saves:
    # "what is a video codec?" must not filter to YouTube memories.
    source = source_cue(text) if kind != "open" and not mention_topic else None
    return AskIntent(
        kind=kind,
        date_window=window,
        source_type=source,
        listing=listing,
        mention_topic=mention_topic,
    )


_CONCEPT_RE = re.compile(
    r"\b(explain|teach me|help me understand|how does|how do|why does|why is|example)\b",
    re.IGNORECASE,
)


def scoped_intent(intent: AskIntent, question: str) -> AskIntent:
    """A question limited to one memory or source type is about that memory.

    "What is this about?" stays grounded in memory; "explain recursion" asked
    about a saved lecture gets the combined explanation-plus-memory answer.
    """
    if intent.kind != "open":
        return intent
    return replace(intent, kind="combined" if _CONCEPT_RE.search(question) else "personal")


def is_followup(question: str) -> bool:
    words = (question or "").split()
    return 0 < len(words) <= 10 and bool(_FOLLOWUP_RE.search(question))


def topic_of(question: str) -> str:
    """Short topic phrase for suggested follow-ups ('What is a heap?' -> 'heap')."""
    text = " ".join((question or "").split()).strip(" ?.!")
    text = _LEADING_QUESTION_RE.sub("", text)
    text = re.split(
        r"\b(based on|according to|from the|in the|using|with (an |a )?examples?|"
        r"in simple terms|step by step)\b",
        text,
        maxsplit=1,
    )[0]
    return text.strip(" ,?.!")[:60]
