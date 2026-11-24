"""Load-test support (REBUILD_PLAN S9, D17): pool settings and the fake AI provider."""

from __future__ import annotations

from typing import Any

import pytest
from pydantic import ValidationError

from app.core import db
from app.core.config import Settings, get_settings
from app.services.llm import fake
from app.services.llm.clients import openai_compatible_client
from app.services.llm_pool import build_backends

from .test_ask_v3 import _register, _save, _stream


@pytest.fixture
def no_wait(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(fake, "FIRST_TOKEN_SECONDS", 0.0)
    monkeypatch.setattr(fake, "STREAM_SECONDS", 0.0)


def _settings(**overrides: Any) -> Settings:
    return Settings(_env_file=None, **overrides)  # type: ignore[call-arg]


def test_fake_provider_is_refused_in_production() -> None:
    with pytest.raises(ValidationError, match="LLM_PROVIDER=fake"):
        _settings(
            llm_provider="fake",
            app_environment="production",
            jwt_secret_key="x" * 40,
            cors_origins=["https://app.example.com"],
        )


def test_fake_provider_is_allowed_for_a_load_test_environment() -> None:
    settings = _settings(
        llm_provider="fake",
        app_environment="loadtest",
        jwt_secret_key="x" * 40,
        cors_origins=["https://app.example.com"],
    )
    assert settings.llm_provider == "fake"


def test_fake_provider_ignores_every_real_key() -> None:
    settings = _settings(
        llm_provider="fake", openai_api_key="sk-real", groq_api_key="gsk-real"
    )
    backends = build_backends(settings)
    assert [b.provider for b in backends] == ["fake"]


def test_fake_client_streams_a_cited_answer_with_usage(no_wait: None) -> None:
    backend = build_backends(_settings(llm_provider="fake"))[0]
    client, extra = openai_compatible_client(backend, 5.0, get_settings())
    chunks = list(client.chat.completions.create(model="fake", messages=[], stream=True))
    text = "".join(c.choices[0].delta.content for c in chunks if c.choices)
    assert "[S1]" in text and "<<<META>>>" in text
    assert chunks[-1].usage.completion_tokens > 0
    assert extra.headers is None and extra.body is None


def test_explain_with_ai_runs_end_to_end_on_the_fake_provider(
    monkeypatch: pytest.MonkeyPatch, no_wait: None
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "llm_provider", "fake")
    headers, _ = _register("load_fake_ai@example.com")
    _save(headers, "fake-ai")
    final = _stream(
        headers, {"question": "Why do beekeepers use cool smoke?", "answer_mode": "ai"}
    )
    assert final["mode"] == "memory"
    assert final["answer"].startswith("This is a load-test answer")
    assert "<<<META>>>" not in final["answer"]
    assert final["followUps"] == ["What else did I save about this?"]


def test_pool_settings_reach_the_engine(monkeypatch: pytest.MonkeyPatch) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "db_pool_size", 7)
    monkeypatch.setattr(settings, "db_max_overflow", 3)
    seen: dict[str, Any] = {}

    def fake_create_engine(url: str, **kwargs: Any) -> Any:
        seen.update(kwargs)
        raise RuntimeError("stop")

    monkeypatch.setattr(db, "create_engine", fake_create_engine)
    with pytest.raises(RuntimeError, match="stop"):
        db._get_engine.__wrapped__()
    assert seen["pool_size"] == 7 and seen["max_overflow"] == 3


def test_pool_settings_have_sqlalchemy_defaults() -> None:
    settings = _settings()
    assert (settings.db_pool_size, settings.db_max_overflow) == (5, 10)


def test_warm_up_runs_each_local_model_once(monkeypatch: pytest.MonkeyPatch) -> None:
    from app.services import warmup

    calls: list[str] = []

    class Adapter:
        model_id = "local:nomic-ai/nomic-embed-text-v1.5-Q"

        def embed_query(self, text: str) -> list[float]:
            calls.append("embed")
            return [0.0]

    class Reranker:
        def score_sentences(self, query: str, sentences: list[str]) -> list[float]:
            calls.append("rerank")
            return [0.0]

    monkeypatch.setattr(warmup, "get_embedding_adapter", lambda: Adapter())
    monkeypatch.setattr(warmup, "reranker_enabled", lambda: True)
    monkeypatch.setattr(warmup, "get_reranker", lambda: Reranker())
    assert warmup.warm_local_models() == ["embedding", "reranker"]
    assert calls == ["embed", "rerank"]


def test_warm_up_skips_models_that_are_off_and_never_raises(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    from app.services import warmup

    def broken() -> None:
        raise RuntimeError("no model")

    monkeypatch.setattr(warmup, "get_embedding_adapter", broken)
    monkeypatch.setattr(warmup, "reranker_enabled", lambda: False)
    assert warmup.warm_local_models() == []
