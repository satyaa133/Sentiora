"""Chat key rotation and failover (app/services/llm_pool.py, RagService._complete)."""

from __future__ import annotations

from datetime import UTC, datetime
from types import SimpleNamespace
from typing import Any
from uuid import UUID

import pytest

from app.models.memory_item import SourceType
from app.services.llm_pool import LLMBackend, build_backends, key_pool
from app.services.rag_service import RagService
from app.services.retrieval_service import RetrievedChunk

USER = UUID("00000000-0000-0000-0000-000000000000")


def _settings(**overrides: Any) -> SimpleNamespace:
    base: dict[str, Any] = {
        "llm_provider": "openrouter",
        "openai_api_key": None,
        "openai_chat_model": "gpt-4o-mini",
        "gemini_api_key": None,
        "gemini_chat_model": "gemini-2.5-flash",
        "openrouter_api_key": None,
        "openrouter_api_key_2": None,
        "openrouter_chat_model": "anthropic/claude-haiku-4.5",
        "llm_key_cooldown_seconds": 300,
        "rag_max_context_chars": 6000,
        "rag_top_k": 8,
    }
    base.update(overrides)
    return SimpleNamespace(**base)


class _ProviderError(Exception):
    def __init__(self, status_code: int) -> None:
        super().__init__(f"HTTP {status_code}")
        self.status_code = status_code


class _Retrieval:
    def retrieve_relevant_memories(self, *args: Any, **kwargs: Any) -> list[RetrievedChunk]:
        return [
            RetrievedChunk(
                memory_id=USER,
                chunk_id=UUID("11111111-1111-1111-1111-111111111111"),
                content="Containers share the host kernel.",
                title="Docker notes",
                url="http://mock",
                source_type=SourceType.webpage,
                domain="mock",
                heading=None,
                page_number=None,
                captured_at=datetime.now(UTC),
                distance=0.1,
            )
        ]


def _rag(monkeypatch: pytest.MonkeyPatch, settings: SimpleNamespace) -> RagService:
    monkeypatch.setattr("app.services.rag_service.get_settings", lambda: settings)
    return RagService(retrieval=_Retrieval())  # type: ignore[arg-type]


def test_backends_follow_provider_order_and_skip_duplicates() -> None:
    settings = _settings(
        openrouter_api_key="or-1",
        openrouter_api_key_2="or-2",
        gemini_api_key="gm-1",
        openai_api_key="or-1",  # same key twice is used once
    )
    assert [b.name for b in build_backends(settings)] == ["openrouter", "openrouter-2", "gemini"]

    gemini_first = _settings(llm_provider="gemini", gemini_api_key="gm-1", openrouter_api_key="or-1")
    assert [b.name for b in build_backends(gemini_first)] == ["gemini", "openrouter"]
    assert build_backends(_settings()) == []


def test_pool_rotates_the_starting_key() -> None:
    backends = build_backends(_settings(openrouter_api_key="or-1", openrouter_api_key_2="or-2"))
    firsts = [key_pool.order(backends)[0].name for _ in range(4)]
    assert firsts == ["openrouter", "openrouter-2", "openrouter", "openrouter-2"]


def test_out_of_credits_key_fails_over_and_cools_down(monkeypatch: pytest.MonkeyPatch) -> None:
    rag = _rag(monkeypatch, _settings(openrouter_api_key="or-1", gemini_api_key="gm-1"))
    calls: list[str] = []

    def fake_call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        calls.append(backend.name)
        if backend.name == "openrouter":
            raise _ProviderError(402)
        return "Answer from Gemini [1]."

    monkeypatch.setattr(RagService, "_call_backend", fake_call)

    first = rag.ask(user_id=USER, question="How do containers work?")
    assert first.used_fallback is False
    assert "Answer from Gemini" in first.answer
    assert calls == ["openrouter", "gemini"]

    # The exhausted key is now cooling down: the next question skips it, even
    # though rotation would have started with it.
    calls.clear()
    rag.ask(user_id=USER, question="And virtual machines?")
    rag.ask(user_id=USER, question="And images?")
    assert calls == ["gemini", "gemini"]


def test_gemini_bad_key_400_cools_the_key(monkeypatch: pytest.MonkeyPatch) -> None:
    rag = _rag(monkeypatch, _settings(gemini_api_key="gm-1", openrouter_api_key="or-1"))
    calls: list[str] = []

    class _BadKeyError(Exception):
        code = 400

    def fake_call(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        calls.append(backend.name)
        if backend.name == "gemini":
            raise _BadKeyError("400 INVALID_ARGUMENT. API key not valid. Please pass a valid API key.")
        return "Answer [1]."

    monkeypatch.setattr(RagService, "_call_backend", fake_call)
    for _ in range(3):
        rag.ask(user_id=USER, question="How do containers work?")
    # Tried once, then skipped while cooling, even when rotation starts on it.
    assert calls.count("gemini") == 1


def test_non_key_errors_do_not_cool_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    backends = build_backends(_settings(openrouter_api_key="or-1"))
    assert not key_pool.mark_failed(backends[0], 400, timed_out=False, cooldown_seconds=300)
    assert key_pool.mark_failed(backends[0], 429, timed_out=False, cooldown_seconds=300)
    assert key_pool.mark_failed(backends[0], None, timed_out=True, cooldown_seconds=300)


def test_overload_cools_briefly_and_credits_cool_long(monkeypatch: pytest.MonkeyPatch) -> None:
    clock = [1000.0]
    monkeypatch.setattr("app.services.llm_pool.time.monotonic", lambda: clock[0])
    first, second = build_backends(_settings(openrouter_api_key="or-1", gemini_api_key="gm-1"))
    key_pool.mark_failed(first, 402, timed_out=False, cooldown_seconds=300)
    key_pool.mark_failed(second, 503, timed_out=False, cooldown_seconds=300)

    clock[0] += 31  # the overloaded key is back, the out-of-credits one is not
    assert [b.name for b in key_pool.order([first, second])] == ["gemini", "openrouter"]


def test_every_key_failing_still_answers_from_memory(monkeypatch: pytest.MonkeyPatch) -> None:
    rag = _rag(monkeypatch, _settings(openrouter_api_key="or-1", openrouter_api_key_2="or-2"))
    calls: list[str] = []

    def always_fail(self: RagService, backend: LLMBackend, prompt: str, system_prompt: str) -> str:
        calls.append(backend.name)
        raise _ProviderError(402)

    monkeypatch.setattr(RagService, "_call_backend", always_fail)

    resp = rag.ask(user_id=USER, question="Do containers share the host kernel?")
    assert sorted(calls) == ["openrouter", "openrouter-2"]
    assert resp.used_fallback is True
    assert "host kernel" in resp.answer
