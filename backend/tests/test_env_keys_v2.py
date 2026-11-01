"""R6: numbered OpenRouter keys, exponential cooldown, bounded attempts, env validation."""

from __future__ import annotations

from pathlib import Path
from types import SimpleNamespace
from typing import Any

import pytest
from pydantic import ValidationError

from app.core import config
from app.core.config import Settings, _numbered_env_keys, openrouter_keys
from app.services.llm_pool import (
    KeyPool,
    LLMBackend,
    build_backends,
    retry_after_seconds,
)
from app.services.rag_service import LLMProviderError, RagService

# --- key discovery ---------------------------------------------------------------


def test_numbered_keys_come_from_env_files_and_the_environment(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    env_file = tmp_path / ".env"
    env_file.write_text(
        "OPENROUTER_API_KEY_1=file-one\nOPENROUTER_API_KEY_3=file-three\n"
        "OPENROUTER_API_KEY_10=file-ten\nOPENROUTER_API_KEY_X=ignored\nOPENROUTER_API_KEY_4=\n",
        encoding="utf-8",
    )
    monkeypatch.setenv("OPENROUTER_API_KEY_3", "env-three")  # the environment wins
    monkeypatch.setenv("OPENROUTER_API_KEY_7", "env-seven")
    keys = _numbered_env_keys(
        "OPENROUTER_API_KEY_", (str(env_file), str(tmp_path / "missing.env"))
    )
    assert keys == {1: "file-one", 3: "env-three", 7: "env-seven", 10: "file-ten"}


def test_openrouter_keys_are_ordered_and_deduplicated() -> None:
    settings = SimpleNamespace(
        openrouter_api_key="base",
        openrouter_api_key_2=None,
        openrouter_numbered_keys={10: "ten", 1: "one", 2: "two", 3: "base"},
    )
    assert openrouter_keys(settings) == ["base", "one", "two", "ten"]
    # The legacy _2 field overrides a scanned OPENROUTER_API_KEY_2; blank means unset.
    settings.openrouter_api_key_2 = "legacy-two"
    assert openrouter_keys(settings) == ["base", "one", "legacy-two", "ten"]
    settings.openrouter_api_key_2 = ""
    assert openrouter_keys(settings) == ["base", "one", "ten"]


def test_every_numbered_key_becomes_a_chat_backend() -> None:
    settings = SimpleNamespace(
        llm_provider="openrouter",
        openrouter_api_key=None,
        openrouter_api_key_2=None,
        openrouter_numbered_keys={1: "k1", 2: "k2", 3: "k3", 4: "k4"},
        gemini_api_key="gm",
    )
    names = [b.name for b in build_backends(settings)]
    assert names == [
        "openrouter",
        "openrouter-2",
        "openrouter-3",
        "openrouter-4",
        "gemini",
    ]


# --- cooldown ----------------------------------------------------------------------


def _backend(key: str = "k") -> LLMBackend:
    return LLMBackend(name=key, provider="openrouter", api_key=key, model="m")


@pytest.fixture
def clock(monkeypatch: pytest.MonkeyPatch) -> list[float]:
    now = [1000.0]
    monkeypatch.setattr("app.services.llm_pool.time.monotonic", lambda: now[0])
    return now


def test_cooldown_doubles_per_consecutive_failure_up_to_the_cap(
    clock: list[float],
) -> None:
    pool, backend = KeyPool(), _backend()
    waits = []
    for _ in range(5):
        pool.mark_failed(
            backend,
            402,
            timed_out=False,
            cooldown_seconds=300,
            max_cooldown_seconds=1500,
        )
        waits.append(pool.cooldown_remaining(backend))
    assert waits == [300, 600, 1200, 1500, 1500]
    pool.mark_ok(backend)
    pool.mark_failed(backend, 429, timed_out=False, cooldown_seconds=300)
    assert pool.cooldown_remaining(backend) == 300  # success resets the backoff


def test_transient_failures_back_off_from_thirty_seconds(clock: list[float]) -> None:
    pool, backend = KeyPool(), _backend()
    pool.mark_failed(backend, 503, timed_out=False, cooldown_seconds=300)
    assert pool.cooldown_remaining(backend) == 30
    pool.mark_failed(backend, None, timed_out=True, cooldown_seconds=300)
    assert pool.cooldown_remaining(backend) == 60
    assert not pool.mark_failed(backend, 400, timed_out=False, cooldown_seconds=300)


def test_retry_after_is_respected_when_longer(clock: list[float]) -> None:
    pool, backend = KeyPool(), _backend()
    pool.mark_failed(
        backend, 429, timed_out=False, cooldown_seconds=60, retry_after=900
    )
    assert pool.cooldown_remaining(backend) == 900
    error = SimpleNamespace(response=SimpleNamespace(headers={"retry-after": "120"}))
    assert retry_after_seconds(error) == 120.0  # type: ignore[arg-type]
    assert retry_after_seconds(RuntimeError("no response")) is None


# --- bounded attempts --------------------------------------------------------------


def test_a_call_tries_at_most_llm_max_attempts_keys(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = SimpleNamespace(
        llm_provider="openrouter",
        openrouter_api_key=None,
        openrouter_api_key_2=None,
        openrouter_numbered_keys={n: f"k{n}" for n in range(1, 7)},
        openrouter_chat_model="vendor/model",
        llm_key_cooldown_seconds=300,
        llm_cooldown_max_seconds=3600,
        llm_max_attempts=3,
        rag_max_context_chars=6000,
    )
    monkeypatch.setattr("app.services.rag_service.get_settings", lambda: settings)
    calls: list[str] = []

    def failing(
        self: RagService, backend: LLMBackend, prompt: str, system_prompt: str
    ) -> str:
        calls.append(backend.name)
        error: Any = RuntimeError("rate limited")
        error.status_code = 429
        raise error

    monkeypatch.setattr(RagService, "_call_backend", failing)
    rag = RagService.__new__(RagService)
    rag.settings = settings  # type: ignore[assignment]
    with pytest.raises(LLMProviderError):
        rag._generate("q", [], "system", ())
    assert len(calls) == 3


# --- startup validation ------------------------------------------------------------


@pytest.mark.parametrize(
    ("overrides", "message"),
    [
        ({"llm_provider": "anthropic"}, "LLM_PROVIDER='anthropic' must be one of"),
        (
            {"embedding_provider": "cohere"},
            "EMBEDDING_PROVIDER='cohere' must be one of",
        ),
        ({"embedding_dimensions": 768}, "EMBEDDING_DIMENSIONS must be 1536"),
        (
            {"openrouter_fallback_models": "gpt-4o-mini"},
            "'gpt-4o-mini' must look like 'vendor/model'",
        ),
        ({"rag_min_similarity": 1.5}, "less than or equal to 1"),
        ({"llm_max_attempts": 0}, "greater than or equal to 1"),
        ({"llm_cooldown_max_seconds": 10}, "LLM_COOLDOWN_MAX_SECONDS must be >="),
    ],
)
def test_invalid_ai_settings_are_rejected(
    overrides: dict[str, Any], message: str
) -> None:
    with pytest.raises(
        ValidationError, match=message.replace("(", r"\(").replace("'", "'")
    ):
        Settings(**overrides)


def test_valid_fallback_models_are_accepted() -> None:
    settings = Settings(
        openrouter_fallback_models="openai/gpt-4o-mini, x-ai/grok-4.1-fast:free"
    )
    assert config.openrouter_fallback_list(settings) == [
        "openai/gpt-4o-mini",
        "x-ai/grok-4.1-fast:free",
    ]


def test_get_settings_reports_problems_readably(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setenv("LLM_PROVIDER", "anthropic")
    monkeypatch.setenv("EMBEDDING_DIMENSIONS", "768")
    with pytest.raises(SystemExit) as exit_info:
        config.get_settings.__wrapped__()  # uncached: the shared instance stays intact
    assert exit_info.value.code == 2
    err = capsys.readouterr().err
    assert err.startswith("Invalid Sentiora backend configuration:")
    assert (
        "LLM_PROVIDER='anthropic'" in err and "EMBEDDING_DIMENSIONS must be 1536" in err
    )
    assert "Traceback" not in err
