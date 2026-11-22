"""S2: every external AI call leaves one llm_usage row."""

from __future__ import annotations

import threading
import time
from decimal import Decimal
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest
from fastapi.testclient import TestClient

from app.core.db import SessionLocal
from app.main import app
from app.models.llm_usage import LLMUsage
from app.models.user import User
from app.schemas.ask import AskTurn
from app.services import embedding_service, rag_service, usage
from app.services.llm_pool import LLMBackend, key_pool
from app.services.rag_service import RagService
from app.services.retrieval_service import RetrievalService
from app.services.usage import UsageReport, flush_usage, report_from_openai, usage_for

client = TestClient(app)


def _user(email: str) -> UUID:
    client.post(
        "/api/v1/auth/register",
        json={"privacy_consent_version": "2026-11-20", "email": email, "password": "MemoryPassword123!", "full_name": "Usage"},
    )
    db = SessionLocal()
    try:
        user = db.query(User).filter(User.email == email).one()
        return user.id
    finally:
        db.close()


def _rows(user_id: UUID) -> list[LLMUsage]:
    assert flush_usage(), "usage rows were not written in time"
    db = SessionLocal()
    try:
        return (
            db.query(LLMUsage)
            .filter(LLMUsage.user_id == user_id)
            .order_by(LLMUsage.created_at)
            .all()
        )
    finally:
        db.close()


def _settings() -> SimpleNamespace:
    return SimpleNamespace(
        llm_provider="openrouter",
        openai_api_key=None,
        gemini_api_key=None,
        openrouter_api_key="or-1",
        openrouter_api_key_2=None,
        openrouter_chat_model="anthropic/claude-haiku-4.5",
        llm_key_cooldown_seconds=300,
        llm_chat_timeout_seconds=10,
        rag_max_context_chars=6000,
        rag_top_k=8,
    )


@pytest.fixture
def rag(monkeypatch: pytest.MonkeyPatch) -> RagService:
    monkeypatch.setattr(rag_service, "get_settings", _settings)
    key_pool.reset()
    return RagService(retrieval=None)  # type: ignore[arg-type]


def test_a_successful_answer_records_tokens_cost_and_user(
    monkeypatch: pytest.MonkeyPatch, rag: RagService
) -> None:
    user_id = _user("usage_ok@example.com")
    rag._usage_user_id = user_id

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        self._last_usage = UsageReport(tokens_in=1200, tokens_out=300, cost_usd=Decimal("0.0021"))
        return "answer"

    monkeypatch.setattr(RagService, "_call_backend", call)
    assert rag._complete_raw("prompt", "system") == "answer"

    (row,) = _rows(user_id)
    assert (row.purpose, row.provider, row.model) == (
        "answer",
        "openrouter",
        "anthropic/claude-haiku-4.5",
    )
    assert (row.tokens_in, row.tokens_out, row.cost_usd) == (1200, 300, Decimal("0.0021"))
    assert row.success is True and row.error_code is None and row.latency_ms >= 0


def test_a_failed_call_is_recorded_with_its_error(
    monkeypatch: pytest.MonkeyPatch, rag: RagService
) -> None:
    user_id = _user("usage_fail@example.com")
    rag._usage_user_id = user_id

    class _OutOfCreditsError(Exception):
        status_code = 402

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        raise _OutOfCreditsError("no credits")

    monkeypatch.setattr(RagService, "_call_backend", call)
    with pytest.raises(_OutOfCreditsError):
        rag._complete_raw("prompt", "system")

    (row,) = _rows(user_id)
    assert row.success is False and row.error_code == "402"
    assert row.tokens_in is None and row.cost_usd is None


def test_follow_ups_are_rewritten_without_a_model_call(
    monkeypatch: pytest.MonkeyPatch, rag: RagService
) -> None:
    user_id = _user("usage_rewrite@example.com")

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        return "optimal approach to rotate an array"

    monkeypatch.setattr(RagService, "_call_backend", call)
    monkeypatch.setattr(
        RetrievalService, "retrieve_relevant_memories", lambda self, **kwargs: []
    )
    db = SessionLocal()
    try:
        rag.retrieval = RetrievalService(db)
        rag.prepare(
            user_id,
            "what about the optimal one?",
            history=[
                AskTurn(role="user", content="What does the Rotate Array video cover?"),
                AskTurn(role="assistant", content="Brute force, better and optimal."),
            ],
        )
    finally:
        db.close()

    # S6: the heuristic rewrite runs locally; the AI answer call reads the
    # conversation itself, so a follow-up costs no extra call.
    assert [row.purpose for row in _rows(user_id)] == []
    assert rag._usage_purpose == "answer"


def test_embeddings_are_recorded_for_the_user_in_usage_for(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    user_id = _user("usage_embed@example.com")

    class FakeOpenAI:
        def __init__(self, **kwargs: Any) -> None:
            self.embeddings = SimpleNamespace(create=self.create)

        def create(self, model: str, input: list[str], **kwargs: Any) -> Any:
            # Cost reporting, and never a provider that keeps or trains on text (D13).
            assert kwargs["extra_body"] == {
                "usage": {"include": True},
                "provider": {"data_collection": "deny", "zdr": True},
            }
            return SimpleNamespace(
                data=[SimpleNamespace(index=i, embedding=[0.0] * 1536) for i in range(len(input))],
                usage=SimpleNamespace(prompt_tokens=42, completion_tokens=None, cost=0.00001),
            )

    settings = embedding_service.get_settings().model_copy(
        update={"openrouter_api_key": "or-1"}
    )
    settings.openrouter_numbered_keys = {}
    monkeypatch.setattr(embedding_service, "get_settings", lambda: settings)
    monkeypatch.setattr(embedding_service, "OpenAI", FakeOpenAI)
    key_pool.reset()

    with usage_for(user_id):
        embedding_service.OpenRouterEmbeddingAdapter().embed_texts(["a", "b"])

    (row,) = _rows(user_id)
    assert (row.purpose, row.provider, row.tokens_in) == ("embed", "openrouter", 42)
    assert row.cost_usd == Decimal("0.00001")


def test_a_database_failure_never_breaks_the_ai_call(
    monkeypatch: pytest.MonkeyPatch, rag: RagService
) -> None:
    class _Session:
        def add(self, row: object) -> None:
            raise RuntimeError("database down")

        def rollback(self) -> None:
            pass

        def close(self) -> None:
            pass

    monkeypatch.setattr(usage, "SessionLocal", lambda: _Session())
    monkeypatch.setattr(
        RagService,
        "_call_backend",
        lambda self, backend, prompt, system_prompt: "still answered",
    )
    assert rag._complete_raw("prompt", "system") == "still answered"
    assert flush_usage()


def test_a_slow_database_never_delays_failover(
    monkeypatch: pytest.MonkeyPatch, rag: RagService
) -> None:
    """Regression: writing the failed attempt's row used to happen inline; with
    the database down it took the whole answer budget and the backup provider
    was never tried."""
    release = threading.Event()
    monkeypatch.setattr(usage, "_write", lambda row: release.wait(5))
    settings = _settings()
    settings.gemini_api_key = "gm-1"
    settings.gemini_chat_model = "gemini-2.5-flash"
    monkeypatch.setattr(rag_service, "get_settings", lambda: settings)
    rag = RagService(retrieval=None)  # type: ignore[arg-type]

    class _OutOfCreditsError(Exception):
        status_code = 402

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        if backend.provider == "openrouter":
            raise _OutOfCreditsError("no credits")
        return "from the backup"

    monkeypatch.setattr(RagService, "_call_backend", call)
    started = time.perf_counter()
    try:
        assert rag._complete_raw("prompt", "system") == "from the backup"
        assert time.perf_counter() - started < 1.0
    finally:
        release.set()
        flush_usage()


def test_openai_usage_reports_parse_tokens_and_optional_cost() -> None:
    report = report_from_openai(SimpleNamespace(prompt_tokens=10, completion_tokens=3))
    assert report == UsageReport(tokens_in=10, tokens_out=3, cost_usd=None)
    assert report_from_openai(None) is None
    with_cost = report_from_openai(
        SimpleNamespace(prompt_tokens=1, completion_tokens=1, cost="0.5")
    )
    assert with_cost is not None and with_cost.cost_usd == Decimal("0.5")
