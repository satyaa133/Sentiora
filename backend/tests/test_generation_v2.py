"""R5 generation: SSE events, streaming failover, structured metadata request."""

from __future__ import annotations

import json
from types import SimpleNamespace
from typing import Any

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.services import rag_service
from app.services.llm import prompts
from app.services.llm_pool import key_pool

client = TestClient(app)

ARTICLE = (
    "Binary search repeatedly halves the search interval. It compares the target "
    "with the middle element, then continues on one side of the sorted collection. "
) * 3

_SETTINGS = {
    "llm_provider": "openrouter",
    "openai_api_key": None,
    "gemini_api_key": None,
    "openrouter_api_key": "or-key-1",
    "openrouter_api_key_2": "or-key-2",
    "openrouter_chat_model": "anthropic/claude-haiku-4.5",
    "openrouter_fallback_models": "openai/gpt-4o-mini, google/gemini-2.5-flash",
    "llm_key_cooldown_seconds": 300,
    "rag_max_context_chars": 12000,
    "rag_max_output_tokens": 900,
    "rag_top_k": 8,
    "rag_strong_distance": 0.4,
}


class FakeOpenAI:
    """Records every chat.completions.create call; behaviour set per test."""

    calls: list[dict[str, Any]] = []
    stream_pieces: dict[str, list[str]] = {}
    fail_keys: dict[str, int] = {}
    break_after_first: set[str] = set()
    meta_reply = '{"mode":"memory","usedSources":["S1"],"followUps":["What is the time complexity of binary search?"]}'

    def __init__(self, *, api_key: str, **kwargs: Any) -> None:
        self.api_key = api_key
        self.chat = SimpleNamespace(completions=SimpleNamespace(create=self._create))

    def _create(self, **kwargs: Any) -> Any:
        FakeOpenAI.calls.append({"api_key": self.api_key, **kwargs})
        if self.api_key in FakeOpenAI.fail_keys:
            error = RuntimeError("upstream failure")
            error.status_code = FakeOpenAI.fail_keys[self.api_key]  # type: ignore[attr-defined]
            raise error
        if kwargs.get("response_format"):
            message = SimpleNamespace(content=FakeOpenAI.meta_reply)
            return SimpleNamespace(choices=[SimpleNamespace(message=message)])
        if kwargs.get("stream"):
            return self._stream(
                FakeOpenAI.stream_pieces.get(self.api_key, ["Answer [S1]."])
            )
        message = SimpleNamespace(
            content="".join(
                FakeOpenAI.stream_pieces.get(self.api_key, ["Answer [S1]."])
            )
        )
        return SimpleNamespace(choices=[SimpleNamespace(message=message)])

    def _stream(self, pieces: list[str]) -> Any:
        for index, piece in enumerate(pieces):
            if index == 1 and self.api_key in FakeOpenAI.break_after_first:
                raise RuntimeError("connection reset")
            yield SimpleNamespace(
                choices=[SimpleNamespace(delta=SimpleNamespace(content=piece))]
            )


# Captured at import, before the conftest guard replaces it for each test.
_REAL_CALL_STRUCTURED = rag_service.RagService._call_structured
_DEFAULT_META = FakeOpenAI.meta_reply


@pytest.fixture
def fake_llm(monkeypatch: pytest.MonkeyPatch) -> type[FakeOpenAI]:
    monkeypatch.setattr(
        "app.services.retrieval_service.get_embedding_adapter", lambda: None
    )
    monkeypatch.setattr(
        rag_service, "get_settings", lambda: SimpleNamespace(**_SETTINGS)
    )
    monkeypatch.setattr(rag_service, "OpenAI", FakeOpenAI)
    # Undo the conftest guard: this file drives the real request-building code.
    monkeypatch.setattr(
        rag_service.RagService, "_call_structured", _REAL_CALL_STRUCTURED, raising=True
    )
    FakeOpenAI.calls = []
    FakeOpenAI.stream_pieces = {}
    FakeOpenAI.fail_keys = {}
    FakeOpenAI.break_after_first = set()
    FakeOpenAI.meta_reply = _DEFAULT_META
    key_pool.reset()
    return FakeOpenAI


def _headers(email: str) -> dict[str, str]:
    password = "MemoryPassword123!"
    client.post(
        "/api/v1/auth/register",
        json={"email": email, "password": password, "full_name": "Stream Tester"},
    )
    token = client.post(
        "/api/v1/auth/login", json={"email": email, "password": password}
    ).json()["data"]["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _save(headers: dict[str, str]) -> str:
    created = client.post(
        "/api/v1/memory-items",
        json={
            "source_type": "webpage",
            "url": "https://docs.example.com/bs",
            "title": "Binary Search",
            "content": ARTICLE,
        },
        headers=headers,
    )
    return str(created.json()["data"]["id"])


def _events(response: Any) -> list[tuple[str, dict[str, Any]]]:
    events = []
    for block in response.text.strip().split("\n\n"):
        lines = dict(line.split(": ", 1) for line in block.splitlines())
        events.append((lines["event"], json.loads(lines["data"])))
    return events


def _stream(headers: dict[str, str], question: str) -> list[tuple[str, dict[str, Any]]]:
    response = client.post(
        "/api/v1/chat/stream", json={"question": question}, headers=headers
    )
    assert response.status_code == 200, response.text
    assert response.headers["content-type"].startswith("text/event-stream")
    return _events(response)


def test_stream_sends_sources_deltas_then_final(fake_llm: type[FakeOpenAI]) -> None:
    fake_llm.stream_pieces = {
        "or-key-1": ["Binary search halves ", "the interval [S1]", " and [S7]."]
    }
    fake_llm.stream_pieces["or-key-2"] = fake_llm.stream_pieces["or-key-1"]
    headers = _headers("stream_order@example.com")
    memory_id = _save(headers)

    events = _stream(headers, "How does binary search halve the interval?")
    names = [name for name, _ in events]
    assert names[0] == "sources" and names[-1] == "final"
    assert set(names[1:-1]) == {"delta"} and len(names) == 5

    sources = events[0][1]["sources"]
    assert sources[0]["id"] == "S1" and sources[0]["memory_id"] == memory_id
    final = events[-1][1]
    assert (
        final["answer"] == "Binary search halves the interval [S1] and."
    )  # [S7] does not exist
    assert final["usedSources"] == ["S1"]
    assert final["mode"] == "memory"
    assert final["followUps"] == ["What is the time complexity of binary search?"]


def test_structured_call_uses_strict_json_schema_and_require_parameters(
    fake_llm: type[FakeOpenAI],
) -> None:
    headers = _headers("stream_meta@example.com")
    _save(headers)
    _stream(headers, "How does binary search halve the interval?")

    meta_calls = [c for c in fake_llm.calls if c.get("response_format")]
    assert len(meta_calls) == 1
    call = meta_calls[0]
    assert call["response_format"]["type"] == "json_schema"
    assert call["response_format"]["json_schema"]["strict"] is True
    assert call["extra_body"]["provider"] == {"require_parameters": True}
    assert "stream" not in call
    answer_call = next(c for c in fake_llm.calls if c.get("stream"))
    assert answer_call["extra_body"]["models"] == [
        "anthropic/claude-haiku-4.5",
        "openai/gpt-4o-mini",
        "google/gemini-2.5-flash",
    ]
    system = answer_call["messages"][0]["content"]
    assert system == prompts.ANSWER_SYSTEM_PROMPT
    assert "From your saved memory" not in answer_call["messages"][1]["content"]


def test_stream_fails_over_to_the_next_key_before_the_first_token(
    fake_llm: type[FakeOpenAI],
) -> None:
    fake_llm.fail_keys = {"or-key-1": 402}
    fake_llm.stream_pieces = {"or-key-2": ["From key two [S1]."]}
    headers = _headers("stream_failover@example.com")
    _save(headers)
    events = _stream(headers, "How does binary search halve the interval?")
    assert events[-1][0] == "final"
    assert events[-1][1]["answer"] == "From key two [S1]."


def test_stream_break_after_first_token_sends_an_error_event(
    fake_llm: type[FakeOpenAI],
) -> None:
    fake_llm.stream_pieces = {k: ["Partial ", "rest"] for k in ("or-key-1", "or-key-2")}
    fake_llm.break_after_first = {"or-key-1", "or-key-2"}
    headers = _headers("stream_break@example.com")
    _save(headers)
    events = _stream(headers, "How does binary search halve the interval?")
    assert [name for name, _ in events] == ["sources", "delta", "error"]
    assert events[-1][1]["code"] == "ASK_STREAM_INTERRUPTED"


def test_invalid_metadata_degrades_without_followups(
    fake_llm: type[FakeOpenAI],
) -> None:
    fake_llm.meta_reply = '{"mode": "memory"}'
    headers = _headers("stream_bad_meta@example.com")
    _save(headers)
    final = _stream(headers, "How does binary search halve the interval?")[-1][1]
    assert final["mode"] == "memory" and final["usedSources"] == ["S1"]
    assert final["followUps"] == []


def test_all_keys_failing_without_memory_is_an_error_event(
    fake_llm: type[FakeOpenAI],
) -> None:
    fake_llm.fail_keys = {"or-key-1": 402, "or-key-2": 429}
    headers = _headers("stream_all_fail@example.com")
    events = _stream(headers, "What is a binary heap?")
    assert events[-1][0] == "error"
    assert events[-1][1]["code"] == "AI_PROVIDER_UNAVAILABLE"
    assert "upstream" not in events[-1][1]["message"]


def test_personal_question_without_memory_streams_a_fixed_answer(
    fake_llm: type[FakeOpenAI],
) -> None:
    headers = _headers("stream_personal@example.com")
    events = _stream(headers, "What did I save about kubernetes?")
    assert [name for name, _ in events] == ["sources", "delta", "final"]
    assert events[-1][1]["insufficient_context"] is True
    assert fake_llm.calls == []
