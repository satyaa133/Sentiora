import pytest
from typing import Any
from uuid import UUID
from datetime import datetime, UTC
from app.services.rag_service import RagService, LLMProviderError
from app.services.retrieval_service import RetrievedChunk
from app.models.memory_item import SourceType

def test_openrouter_routing(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openrouter",
                "openai_api_key": None,
                "gemini_api_key": None,
                "openrouter_api_key": "ok-test",
                "openrouter_chat_model": "anthropic/claude-3-haiku",
                "rag_max_context_chars": 6000,
                "rag_top_k": 8,
            },
        )(),
    )

    def mock_complete(self: Any, question: str, context: str) -> str:
        return "OpenRouter mock response"

    monkeypatch.setattr("app.services.rag_service.RagService._complete_openrouter", mock_complete)

    class MockRetrieval:
        def retrieve_relevant_memories(self, *args: Any, **kwargs: Any) -> list[RetrievedChunk]:
            return [
                RetrievedChunk(
                    memory_id=UUID("00000000-0000-0000-0000-000000000000"),
                    chunk_id=UUID("11111111-1111-1111-1111-111111111111"),
                    content="Hello world",
                    title="Mock",
                    url="http://mock",
                    source_type=SourceType.webpage,
                    domain="mock",
                    heading="Test",
                    page_number=None,
                    captured_at=datetime.now(UTC),
                    distance=0.1,
                )
            ]

    rag = RagService(retrieval=MockRetrieval())  # type: ignore[arg-type]
    resp = rag.ask(user_id=UUID("00000000-0000-0000-0000-000000000000"), question="Test?")
    assert resp.answer == "OpenRouter mock response"


def test_openrouter_fallback_when_missing_key(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openrouter",
                "openai_api_key": None,
                "gemini_api_key": None,
                "openrouter_api_key": None,
                "openrouter_chat_model": "anthropic/claude-3-haiku",
                "rag_max_context_chars": 6000,
                "rag_top_k": 8,
            },
        )(),
    )

    class MockRetrieval:
        def retrieve_relevant_memories(self, *args: Any, **kwargs: Any) -> list[RetrievedChunk]:
            return [
                RetrievedChunk(
                    memory_id=UUID("00000000-0000-0000-0000-000000000000"),
                    chunk_id=UUID("11111111-1111-1111-1111-111111111111"),
                    content="Fallback data",
                    title="Mock",
                    url="http://mock",
                    source_type=SourceType.webpage,
                    domain="mock",
                    heading="Test",
                    page_number=None,
                    captured_at=datetime.now(UTC),
                    distance=0.1,
                )
            ]

    rag = RagService(retrieval=MockRetrieval())  # type: ignore[arg-type]
    resp = rag.ask(user_id=UUID("00000000-0000-0000-0000-000000000000"), question="Test?")
    assert resp.used_fallback is True
    assert "Fallback data" in resp.answer


def test_openrouter_provider_error(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(
        "app.services.rag_service.get_settings",
        lambda: type(
            "S",
            (),
            {
                "llm_provider": "openrouter",
                "openai_api_key": None,
                "gemini_api_key": None,
                "openrouter_api_key": "ok-test",
                "openrouter_chat_model": "anthropic/claude-3-haiku",
                "rag_max_context_chars": 6000,
                "rag_top_k": 8,
            },
        )(),
    )

    def mock_complete(self: Any, question: str, context: str) -> str:
        raise LLMProviderError("Provider is down")

    monkeypatch.setattr("app.services.rag_service.RagService._complete_openrouter", mock_complete)

    class MockRetrieval:
        def retrieve_relevant_memories(self, *args: Any, **kwargs: Any) -> list[RetrievedChunk]:
            return [
                RetrievedChunk(
                    memory_id=UUID("00000000-0000-0000-0000-000000000000"),
                    chunk_id=UUID("11111111-1111-1111-1111-111111111111"),
                    content="Fallback data",
                    title="Mock",
                    url="http://mock",
                    source_type=SourceType.webpage,
                    domain="mock",
                    heading="Test",
                    page_number=None,
                    captured_at=datetime.now(UTC),
                    distance=0.1,
                )
            ]

    rag = RagService(retrieval=MockRetrieval())  # type: ignore[arg-type]
    with pytest.raises(LLMProviderError, match="Provider is down"):
        rag.ask(user_id=UUID("00000000-0000-0000-0000-000000000000"), question="Test?")
