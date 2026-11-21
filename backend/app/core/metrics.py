"""Prometheus metrics, served at /metrics when METRICS_ENABLED.

/metrics sits outside /api/, and nginx forwards only /api/ and /health, so it
isn't reachable from the internet in production; scrape it on the internal
network. With several uvicorn workers, set PROMETHEUS_MULTIPROC_DIR to an
empty directory so one scrape covers every process.
"""

from __future__ import annotations

import os
import time
from collections.abc import Iterator
from contextlib import contextmanager

from prometheus_client import (
    CONTENT_TYPE_LATEST,
    CollectorRegistry,
    Counter,
    Histogram,
    generate_latest,
    multiprocess,
)
from prometheus_client.core import GaugeMetricFamily
from prometheus_client.registry import Collector, REGISTRY
from redis import Redis

from app.core.redis_client import RedisUnavailableError, shared_redis

HTTP_REQUEST_SECONDS = Histogram(
    "sentiora_http_request_duration_seconds",
    "Time to produce a response (until the first byte for streams), by route.",
    ["method", "route", "status"],
    buckets=(0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40),
)

ASK_STAGE_SECONDS = Histogram(
    "sentiora_ask_stage_seconds",
    "Time spent in each Ask stage: rewrite, embed, vector_search, "
    "fulltext_search, answer (until the first token when streaming), answer_total.",
    ["stage"],
    buckets=(0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 20, 40),
)

AI_PROVIDER_ERRORS = Counter(
    "sentiora_ai_provider_errors_total",
    "Failed calls to an AI provider, by provider and reason.",
    ["provider", "reason"],
)

QUEUE_NAMES = ("sentiora.default",)


@contextmanager
def observe_stage(stage: str) -> Iterator[None]:
    """Time a block as one Ask stage (recorded even if it raises)."""
    started = time.perf_counter()
    try:
        yield
    finally:
        ASK_STAGE_SECONDS.labels(stage=stage).observe(time.perf_counter() - started)


def provider_error_reason(status: int | None, *, timed_out: bool) -> str:
    if timed_out:
        return "timeout"
    if status is None:
        return "error"
    if status >= 500:
        return "5xx"
    return str(status)


class QueueCollector(Collector):
    """Capture queue lengths, read from Redis at scrape time."""

    def collect(self) -> Iterator[GaugeMetricFamily]:
        from rq import Queue
        from rq.registry import FailedJobRegistry, ScheduledJobRegistry

        gauge = GaugeMetricFamily(
            "sentiora_queue_jobs",
            "Jobs per capture queue and state (queued, scheduled, failed).",
            labels=["queue", "state"],
        )

        def read(client: Redis) -> list[tuple[str, str, int]]:
            rows: list[tuple[str, str, int]] = []
            for name in QUEUE_NAMES:
                queue = Queue(name, connection=client)
                rows.append((name, "queued", queue.count))
                rows.append(
                    (name, "scheduled", ScheduledJobRegistry(queue=queue).count)
                )
                rows.append((name, "failed", FailedJobRegistry(queue=queue).count))
            return rows

        try:
            for name, state, count in shared_redis.run(read):
                gauge.add_metric([name, state], count)
        except RedisUnavailableError:
            return
        yield gauge


def _registry() -> CollectorRegistry:
    if os.environ.get("PROMETHEUS_MULTIPROC_DIR"):
        registry = CollectorRegistry()
        multiprocess.MultiProcessCollector(registry)  # type: ignore[no-untyped-call]
        registry.register(QueueCollector())
        return registry
    return REGISTRY


_queue_collector_registered = False


def render_metrics() -> tuple[bytes, str]:
    """Current metrics in the Prometheus text format, and its content type."""
    global _queue_collector_registered
    registry = _registry()
    if registry is REGISTRY and not _queue_collector_registered:
        REGISTRY.register(QueueCollector())
        _queue_collector_registered = True
    return generate_latest(registry), CONTENT_TYPE_LATEST
