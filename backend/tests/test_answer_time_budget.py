"""S1: AI calls share one time budget per answer and read their limits from settings."""

from __future__ import annotations

from types import SimpleNamespace
from typing import Any

import pytest

from app.core.config import Settings
from app.services import embedding_service, rag_service
from app.services.llm_pool import LLMBackend, key_pool
from app.services.rag_service import LLMProviderError, PreparedAnswer, RagService


class _Clock:
    def __init__(self) -> None:
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now

    def perf_counter(self) -> float:  # stage timings (app/core/metrics.py)
        return self.now


class _TimeoutError(Exception):
    """Name contains "timeout", which the key pool treats as a timeout."""


def _settings(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "llm_provider": "openrouter",
        "openai_api_key": None,
        "gemini_api_key": "gm-1",
        "gemini_chat_model": "gemini-2.5-flash",
        "openrouter_api_key": "or-1",
        "openrouter_api_key_2": None,
        "openrouter_chat_model": "anthropic/claude-haiku-4.5",
        "llm_key_cooldown_seconds": 300,
        "llm_chat_timeout_seconds": 10,
        "rag_max_context_chars": 6000,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> _Clock:
    fake = _Clock()
    monkeypatch.setattr(rag_service, "time", fake)
    key_pool.reset()
    return fake


def _rag(monkeypatch: pytest.MonkeyPatch, settings: SimpleNamespace) -> RagService:
    monkeypatch.setattr(rag_service, "get_settings", lambda: settings)
    return RagService(retrieval=None)  # type: ignore[arg-type]


def test_hung_provider_uses_the_budget_once(
    monkeypatch: pytest.MonkeyPatch, clock: _Clock
) -> None:
    rag = _rag(monkeypatch, _settings())
    tried: list[tuple[str, float]] = []

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        tried.append((backend.name, self._attempt_timeout))
        clock.now += self._attempt_timeout  # hangs until its limit
        raise _TimeoutError("read timeout")

    monkeypatch.setattr(RagService, "_call_backend", call)

    with pytest.raises(_TimeoutError):
        rag._complete_raw("prompt", "system")
    # The first key got the whole 10 s budget; nothing was left for the second.
    assert tried == [("openrouter", 10.0)]


def test_fast_failure_leaves_time_for_the_next_key(
    monkeypatch: pytest.MonkeyPatch, clock: _Clock
) -> None:
    rag = _rag(monkeypatch, _settings())
    tried: list[tuple[str, float]] = []

    def call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        tried.append((backend.name, self._attempt_timeout))
        if backend.name == "openrouter":
            clock.now += 0.5
            raise LLMProviderError("connection refused")
        return "answer"

    monkeypatch.setattr(RagService, "_call_backend", call)

    assert rag._complete_raw("prompt", "system") == "answer"
    assert tried == [("openrouter", 10.0), ("gemini", 9.5)]


def test_stream_failover_shares_the_budget(
    monkeypatch: pytest.MonkeyPatch, clock: _Clock
) -> None:
    rag = _rag(monkeypatch, _settings(openrouter_api_key_2="or-2"))
    tried: list[tuple[str, float]] = []

    def stream(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> Any:
        tried.append((backend.name, self._attempt_timeout))
        clock.now += 6.0
        raise _TimeoutError("read timeout")
        yield ""  # pragma: no cover - makes this a generator

    monkeypatch.setattr(RagService, "_stream_backend", stream)
    monkeypatch.setattr(RagService, "_system_prompt", lambda self, prepared: "system")
    prepared = PreparedAnswer(question="q", history=(), sources=[])

    with pytest.raises(LLMProviderError):
        list(rag._stream_answer(prepared))
    # 6 s gone after the first key, 4 s left for the second, then nothing.
    assert [name for name, _ in tried] == ["openrouter", "openrouter-2"]
    assert tried[1][1] == pytest.approx(4.0)


def test_timeout_settings_have_the_planned_defaults() -> None:
    fields = Settings.model_fields
    assert fields["llm_chat_timeout_seconds"].default == 10
    assert fields["llm_meta_timeout_seconds"].default == 8
    assert fields["embedding_timeout_seconds"].default == 10


def test_openrouter_embeddings_use_the_embedding_timeout(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    captured: dict[str, Any] = {}

    class FakeOpenAI:
        def __init__(self, **kwargs: Any) -> None:
            captured.update(kwargs)
            self.embeddings = SimpleNamespace(create=self.create)

        def create(self, model: str, input: list[str]) -> Any:
            return SimpleNamespace(
                data=[SimpleNamespace(index=0, embedding=[0.0] * 1536)]
            )

    settings = Settings(openrouter_api_key="or-1", embedding_timeout_seconds=7)
    settings.openrouter_numbered_keys = {}
    monkeypatch.setattr(embedding_service, "get_settings", lambda: settings)
    monkeypatch.setattr(embedding_service, "OpenAI", FakeOpenAI)
    key_pool.reset()

    adapter = embedding_service.OpenRouterEmbeddingAdapter()
    adapter.embed_texts(["hello"])
    assert captured["timeout"] == 7
