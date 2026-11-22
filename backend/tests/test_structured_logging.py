"""S2: log lines carry the request or job ID, as JSON in production."""

from __future__ import annotations

import io
import json
import logging

from fastapi.testclient import TestClient

from app.api.deps import get_settings
from app.core.config import Settings
from app.core.logging import (
    ContextFilter,
    JsonFormatter,
    TextFormatter,
    request_id_var,
)
from app.main import app
from app.workers.worker import _JobContextMixin

client = TestClient(app)


def _capture(formatter: logging.Formatter) -> tuple[logging.Logger, io.StringIO]:
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(formatter)
    handler.addFilter(ContextFilter())
    logger = logging.getLogger(f"test.structured.{id(stream)}")
    logger.handlers = [handler]
    logger.propagate = False
    logger.setLevel(logging.INFO)
    return logger, stream


def test_json_lines_carry_request_id_extras_and_exceptions() -> None:
    logger, stream = _capture(JsonFormatter())
    token = request_id_var.set("req_abc12345")
    try:
        logger.info("memory ready", extra={"memory_id": "m-1", "chunks": 4})
        try:
            raise ValueError("boom")
        except ValueError:
            logger.exception("failed")
    finally:
        request_id_var.reset(token)

    first, second = (json.loads(line) for line in stream.getvalue().splitlines())
    assert first["message"] == "memory ready"
    assert first["level"] == "INFO"
    assert first["request_id"] == "req_abc12345"
    assert first["memory_id"] == "m-1" and first["chunks"] == 4
    assert "ValueError: boom" in second["exc"]


def test_text_lines_show_the_request_id_only_when_there_is_one() -> None:
    logger, stream = _capture(TextFormatter())
    logger.info("no context")
    token = request_id_var.set("req_00000001")
    try:
        logger.info("in a request")
    finally:
        request_id_var.reset(token)
    no_context, in_request = stream.getvalue().splitlines()
    assert "[" not in no_context
    assert "[req_00000001] in a request" in in_request


def test_request_id_matches_the_response_header() -> None:
    seen: list[str | None] = []
    real = get_settings()

    def settings_spy() -> Settings:
        seen.append(request_id_var.get())
        return real

    app.dependency_overrides[get_settings] = settings_spy
    try:
        response = client.get("/health")
    finally:
        app.dependency_overrides.pop(get_settings, None)
    assert seen == [response.headers["X-Request-ID"]]
    assert request_id_var.get() is None


def test_worker_jobs_log_with_their_job_id() -> None:
    class _Base:
        def perform_job(self, job: object, queue: object) -> bool:
            return request_id_var.get() == "job_abc"

    class _Worker(_JobContextMixin, _Base):  # type: ignore[misc]
        pass

    class _Job:
        id = "abc"

    assert _Worker().perform_job(_Job(), None) is True  # type: ignore[arg-type]
    assert request_id_var.get() is None


def test_log_format_defaults_by_environment() -> None:
    assert Settings(app_environment="development").effective_log_format == "text"
    production = Settings(
        app_environment="production",
        jwt_secret_key="x" * 40,
        cors_origins=["https://app.example.com"],
    )
    assert production.effective_log_format == "json"
    assert Settings(log_format="json").effective_log_format == "json"
