"""Record every call to an external AI provider in ``llm_usage``.

Callers time the call and pass what the provider reported (tokens, and cost
when OpenRouter reports it). Recording never breaks the call it describes: a
failed insert is logged and dropped.

Embedding calls happen deep inside adapters that don't know the user, so the
user is carried in a context variable set with ``usage_for(user_id)`` around
retrieval and capture work.
"""

from __future__ import annotations

import logging
import os
import queue
import threading
import time
from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from dataclasses import dataclass
from decimal import Decimal, InvalidOperation
from typing import Any
from uuid import UUID

from app.core.db import SessionLocal
from app.models.llm_usage import LLMUsage

logger = logging.getLogger(__name__)

usage_user_var: ContextVar[UUID | None] = ContextVar("usage_user", default=None)


@dataclass(frozen=True)
class UsageReport:
    tokens_in: int | None = None
    tokens_out: int | None = None
    cost_usd: Decimal | None = None


@contextmanager
def usage_for(user_id: UUID | None) -> Iterator[None]:
    """Attribute AI calls made inside the block to ``user_id``."""
    token = usage_user_var.set(user_id)
    try:
        yield
    finally:
        usage_user_var.reset(token)


def _int(value: Any) -> int | None:
    return value if isinstance(value, int) and not isinstance(value, bool) else None


def _cost(value: Any) -> Decimal | None:
    if value is None or isinstance(value, bool):
        return None
    try:
        return Decimal(str(value))
    except (InvalidOperation, ValueError):
        return None


def report_from_openai(usage: Any) -> UsageReport | None:
    """Usage block of an OpenAI-compatible response (OpenRouter adds ``cost``)."""
    if usage is None:
        return None
    return UsageReport(
        tokens_in=_int(getattr(usage, "prompt_tokens", None)),
        tokens_out=_int(getattr(usage, "completion_tokens", None)),
        cost_usd=_cost(getattr(usage, "cost", None)),
    )


def report_from_gemini(response: Any) -> UsageReport | None:
    metadata = getattr(response, "usage_metadata", None)
    if metadata is None:
        return None
    return UsageReport(
        tokens_in=_int(getattr(metadata, "prompt_token_count", None)),
        tokens_out=_int(getattr(metadata, "candidates_token_count", None)),
    )


def error_code(exc: BaseException) -> str:
    status = getattr(exc, "status_code", None) or getattr(exc, "code", None)
    if isinstance(status, int):
        return str(status)
    return type(exc).__name__[:64]


def record_usage(
    *,
    purpose: str,
    provider: str,
    model: str,
    started: float,
    report: UsageReport | None = None,
    error: BaseException | None = None,
    user_id: UUID | None = None,
) -> None:
    """Queue one ``llm_usage`` row. ``started`` is a ``time.perf_counter()`` value.

    The row is written by a background thread, so a slow or unreachable
    database never delays the answer (or eats its time budget).
    """
    latency_ms = int((time.perf_counter() - started) * 1000)
    report = report or UsageReport()
    row = LLMUsage(
        user_id=user_id if user_id is not None else usage_user_var.get(),
        purpose=purpose,
        provider=provider,
        model=model[:128],
        tokens_in=report.tokens_in,
        tokens_out=report.tokens_out,
        cost_usd=report.cost_usd,
        latency_ms=latency_ms,
        success=error is None,
        error_code=error_code(error) if error is not None else None,
    )
    _writer.submit(row)


def flush_usage(timeout: float = 5.0) -> bool:
    """Wait until queued rows are written (tests, scripts). True if all were."""
    return _writer.flush(timeout)


def _write(row: LLMUsage) -> None:
    db = SessionLocal()
    try:
        db.add(row)
        db.commit()
    except Exception:
        db.rollback()
        logger.warning(
            "Could not record AI usage (%s %s)", row.provider, row.purpose, exc_info=True
        )
    finally:
        db.close()


class _UsageWriter:
    """One daemon thread per process draining a bounded queue of rows."""

    MAX_QUEUED = 1000

    def __init__(self) -> None:
        self._queue: queue.Queue[LLMUsage] = queue.Queue(maxsize=self.MAX_QUEUED)
        self._lock = threading.Lock()
        self._thread: threading.Thread | None = None
        self._pid: int | None = None

    def submit(self, row: LLMUsage) -> None:
        self._ensure_thread()
        try:
            self._queue.put_nowait(row)
        except queue.Full:
            logger.warning("AI usage queue full; dropping a row (%s)", row.purpose)

    def flush(self, timeout: float) -> bool:
        deadline = time.monotonic() + timeout
        while self._queue.unfinished_tasks:
            if time.monotonic() >= deadline:
                return False
            time.sleep(0.01)
        return True

    def _ensure_thread(self) -> None:
        # Restarted after a fork (RQ's forking worker): threads don't survive it.
        with self._lock:
            if self._thread is not None and self._thread.is_alive() and self._pid == os.getpid():
                return
            if self._pid != os.getpid():
                self._queue = queue.Queue(maxsize=self.MAX_QUEUED)
            self._pid = os.getpid()
            self._thread = threading.Thread(
                target=self._run, name="llm-usage-writer", daemon=True
            )
            self._thread.start()

    def _run(self) -> None:
        while True:
            row = self._queue.get()
            try:
                _write(row)
            finally:
                self._queue.task_done()


_writer = _UsageWriter()
