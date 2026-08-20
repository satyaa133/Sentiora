"""Centralized sensitive-domain and URL safety checks for capture ingest.

Keep the list small and explicit so it stays easy to extend for MVP.
"""

from __future__ import annotations

from urllib.parse import urlparse

from app.models.memory_item import SourceType

DEFAULT_BLOCKED_DOMAINS: tuple[str, ...] = (
    "chase.com",
    "bankofamerica.com",
    "wellsfargo.com",
    "citi.com",
    "capitalone.com",
    "americanexpress.com",
    "paypal.com",
    "stripe.com",
    "fidelity.com",
    "vanguard.com",
    "schwab.com",
    "robinhood.com",
    "coinbase.com",
    "mychart.org",
    "epic.com",
    "kp.org",
    "turbotax.com",
    "intuit.com",
    "irs.gov",
)

BLOCKED_URL_PREFIXES: tuple[str, ...] = (
    "chrome://",
    "chrome-extension://",
    "moz-extension://",
    "edge://",
    "about:",
    "view-source:",
    "devtools://",
)

_MANUAL_VAULT_PATHS = ("/manual/", "/notes", "/notes/", "/welcome")


def _is_pdf_url(url: str) -> bool:
    lower = url.lower()
    return lower.endswith(".pdf") or ".pdf?" in lower


def _is_synthetic_manual_url(path: str) -> bool:
    lower = path.lower()
    return any(lower == prefix or lower.startswith(prefix) for prefix in _MANUAL_VAULT_PATHS)


def is_sensitive_url(url: str, source_type: SourceType | str | None = None) -> bool:
    """Return True when a capture URL must not be persisted."""
    if not url or not url.strip():
        return True

    raw = url.strip()
    lower = raw.lower()

    if lower.startswith("file://"):
        source = source_type.value if isinstance(source_type, SourceType) else source_type
        return not (source == "pdf" and _is_pdf_url(raw))

    if any(lower.startswith(prefix) for prefix in BLOCKED_URL_PREFIXES):
        return True

    parsed = urlparse(raw)
    host = (parsed.hostname or "").lower()
    path = parsed.path or "/"
    port = parsed.port

    if _is_synthetic_manual_url(path):
        return False

    if "sentiora" in host:
        return True

    if host in {"localhost", "127.0.0.1"} and port in {5173, 8000, 5050}:
        return True

    for domain in DEFAULT_BLOCKED_DOMAINS:
        if host == domain or host.endswith("." + domain):
            return True

    return False
