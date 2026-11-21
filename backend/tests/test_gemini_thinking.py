"""Gemini thinking settings: the least thinking each model family accepts."""

from types import SimpleNamespace
from typing import Any

import pytest
from google.genai import types

from app.services.llm_pool import LLMBackend
from app.services.rag_service import RagService, gemini_thinking_config


@pytest.mark.parametrize(
    "model",
    [
        "gemini-3.5-flash",
        "gemini-3.5-flash-lite",
        "gemini-3.8-flash",
        "gemini-flash-latest",
    ],
)
def test_gemini_3_and_latest_use_low_thinking_level(model: str) -> None:
    config = gemini_thinking_config(model)
    assert config.thinking_level == types.ThinkingLevel.LOW
    assert config.thinking_budget is None


@pytest.mark.parametrize("model", ["gemini-2.5-flash", "gemini-2.5-flash-lite"])
def test_gemini_2_switches_thinking_off(model: str) -> None:
    config = gemini_thinking_config(model)
    assert config.thinking_budget == 0
    assert config.thinking_level is None


class _RejectedError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.code = 400


def _rag_with_fake_gemini(
    monkeypatch: pytest.MonkeyPatch, first_error: Exception | None
) -> tuple[RagService, list[Any]]:
    seen: list[Any] = []

    class FakeModels:
        def generate_content(self, *, model: str, contents: str, config: Any) -> Any:
            seen.append(config.thinking_config)
            if first_error is not None and len(seen) == 1:
                raise first_error
            return SimpleNamespace(text="answer [S1]")

    class FakeClient:
        def __init__(self, **_: Any) -> None:
            self.models = FakeModels()

    from google import genai

    monkeypatch.setattr(genai, "Client", FakeClient)
    rag = RagService.__new__(RagService)
    rag.settings = SimpleNamespace(rag_max_output_tokens=900)
    return rag, seen


BACKEND = LLMBackend(
    name="gemini", provider="gemini", api_key="test", model="gemini-3.5-flash-lite"
)


def test_invalid_argument_retries_with_default_thinking(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    rag, seen = _rag_with_fake_gemini(
        monkeypatch,
        _RejectedError("400 INVALID_ARGUMENT. Request contains an invalid argument."),
    )
    assert rag._complete_gemini("prompt", "system", BACKEND) == "answer [S1]"
    assert seen[0].thinking_level == types.ThinkingLevel.LOW
    assert seen[1] is None


def test_other_400_is_not_retried(monkeypatch: pytest.MonkeyPatch) -> None:
    rag, seen = _rag_with_fake_gemini(
        monkeypatch,
        _RejectedError("400 API key not valid. Please pass a valid API key."),
    )
    with pytest.raises(_RejectedError):
        rag._complete_gemini("prompt", "system", BACKEND)
    assert len(seen) == 1
