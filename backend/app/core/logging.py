"""Logging for the API and workers: one line per record, tagged with its request.

Every record carries the current request's ID (the same ``req_…`` value as the
``X-Request-ID`` header and the envelope's ``meta.request_id``), or ``job_<id>``
inside a worker job, so one request or job can be followed through the logs.

``LOG_FORMAT=json`` writes one JSON object per line for log collectors (the
default outside development); ``text`` writes readable lines.
"""

from __future__ import annotations

import json
import logging
import sys
from contextvars import ContextVar
from datetime import UTC, datetime

# Set by the request-ID middleware (app/main.py) for a request, and by the
# worker (app/workers/worker.py) for a job.
request_id_var: ContextVar[str | None] = ContextVar("request_id", default=None)

_STANDARD_ATTRS = frozenset(vars(logging.LogRecord("", 0, "", 0, "", None, None))) | {
    "message",
    "asctime",
    "request_id",
    "context",
}


class ContextFilter(logging.Filter):
    """Attach the current request or job ID to every record."""

    def filter(self, record: logging.LogRecord) -> bool:
        record.request_id = request_id_var.get()
        return True


class JsonFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, object] = {
            "ts": datetime.fromtimestamp(record.created, UTC).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        request_id = getattr(record, "request_id", None)
        if request_id:
            payload["request_id"] = request_id
        # Structured fields passed with logger.info(..., extra={...}).
        for key, value in vars(record).items():
            if key not in _STANDARD_ATTRS and not key.startswith("_"):
                payload[key] = value
        if record.exc_info:
            payload["exc"] = self.formatException(record.exc_info)
        return json.dumps(payload, default=str, ensure_ascii=False)


class TextFormatter(logging.Formatter):
    def __init__(self) -> None:
        super().__init__("%(asctime)s %(levelname)s %(name)s%(context)s %(message)s")

    def format(self, record: logging.LogRecord) -> str:
        context = getattr(record, "request_id", None)
        record.context = f" [{context}]" if context else ""
        return super().format(record)


def configure_logging(log_format: str | None = None, level: int = logging.INFO) -> None:
    """Install one stderr handler on the root logger (idempotent)."""
    if log_format is None:
        from app.core.config import get_settings

        log_format = get_settings().effective_log_format
    handler = logging.StreamHandler(sys.stderr)
    handler.setFormatter(JsonFormatter() if log_format == "json" else TextFormatter())
    handler.addFilter(ContextFilter())
    root = logging.getLogger()
    for existing in list(root.handlers):
        if getattr(existing, "_sentiora", False):
            root.removeHandler(existing)
    handler._sentiora = True  # type: ignore[attr-defined]
    root.addHandler(handler)
    root.setLevel(level)
