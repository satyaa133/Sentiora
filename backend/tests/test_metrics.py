"""S2: /metrics exposes request, Ask-stage, provider-error and queue metrics."""

from __future__ import annotations

from datetime import timedelta

import fakeredis
from fastapi.testclient import TestClient
from prometheus_client.parser import text_string_to_metric_families
from rq import Queue

from app.core.metrics import AI_PROVIDER_ERRORS, observe_stage
from app.core.redis_client import shared_redis
from app.main import app
from app.services.llm_pool import LLMBackend, KeyPool

client = TestClient(app)


def _samples(name: str) -> list[tuple[dict[str, str], float]]:
    text = client.get("/metrics").text
    return [
        (sample.labels, sample.value)
        for family in text_string_to_metric_families(text)
        for sample in family.samples
        if sample.name == name
    ]


def test_request_latency_uses_the_route_template_not_the_path() -> None:
    client.get("/api/v1/memory-items/00000000-0000-0000-0000-000000000000")
    routes = {labels["route"] for labels, _ in _samples("sentiora_http_request_duration_seconds_count")}
    assert "/api/v1/memory-items/{item_id}" in routes
    assert not any("00000000" in route for route in routes)


def test_ask_stages_are_timed() -> None:
    with observe_stage("vector_search"):
        pass
    stages = {
        labels["stage"]: value
        for labels, value in _samples("sentiora_ask_stage_seconds_count")
    }
    assert stages.get("vector_search", 0) >= 1


def test_provider_failures_are_counted_by_reason() -> None:
    before = AI_PROVIDER_ERRORS.labels(provider="openrouter", reason="timeout")._value.get()
    backend = LLMBackend(name="openrouter", provider="openrouter", api_key="k", model="m")
    KeyPool().mark_failed(backend, None, timed_out=True, cooldown_seconds=300)
    after = AI_PROVIDER_ERRORS.labels(provider="openrouter", reason="timeout")._value.get()
    assert after == before + 1


def test_queue_lengths_are_read_from_redis() -> None:
    connection = fakeredis.FakeStrictRedis()
    shared_redis.use(connection)
    queue = Queue("sentiora.default", connection=connection)
    queue.enqueue(print, "now")
    queue.enqueue_in(timedelta(minutes=5), print, "later")

    states = {
        labels["state"]: value
        for labels, value in _samples("sentiora_queue_jobs")
        if labels["queue"] == "sentiora.default"
    }
    assert states == {"queued": 1.0, "scheduled": 1.0, "failed": 0.0}


def test_queue_metrics_are_skipped_when_redis_is_down() -> None:
    shared_redis.use(None)  # what conftest does; Redis is "unavailable"
    response = client.get("/metrics")
    assert response.status_code == 200
    assert "sentiora_queue_jobs{" not in response.text


def test_metrics_are_not_part_of_the_public_api() -> None:
    assert "/metrics" not in app.openapi()["paths"]
