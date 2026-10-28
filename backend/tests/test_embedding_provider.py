import pytest

from app.core.config import get_settings
from app.services.embedding_service import resolve_embedding_provider


@pytest.mark.parametrize(
    (
        "embedding_provider",
        "llm_provider",
        "openrouter_key",
        "openai_key",
        "gemini_key",
        "expected",
    ),
    [
        # auto prefers OpenRouter whenever an OpenRouter key is set
        ("auto", "openrouter", "k", "k", "k", "openrouter"),
        ("auto", "gemini", "k", None, "k", "openrouter"),
        # without OpenRouter, auto follows an embedding-capable chat provider
        ("auto", "openai", None, "k", "k", "openai"),
        ("auto", "gemini", None, "k", "k", "gemini"),
        ("auto", "openai", None, None, "k", None),
        # ...or the first configured embedding key
        ("auto", "openrouter", None, "k", "k", "openai"),
        ("auto", "openrouter", None, None, "k", "gemini"),
        ("auto", "openrouter", None, None, None, None),
        # explicit choices
        ("openrouter", "openai", "k", "k", "k", "openrouter"),
        ("openrouter", "openai", None, "k", "k", None),
        ("gemini", "openrouter", "k", "k", "k", "gemini"),
        ("openai", "gemini", None, "k", None, "openai"),
        ("openai", "openrouter", "k", None, "k", None),
        ("none", "openai", "k", "k", "k", None),
        ("bogus", "openai", "k", "k", "k", None),
    ],
)
def test_resolve_embedding_provider(
    monkeypatch: pytest.MonkeyPatch,
    embedding_provider: str,
    llm_provider: str,
    openrouter_key: str | None,
    openai_key: str | None,
    gemini_key: str | None,
    expected: str | None,
) -> None:
    settings = get_settings()
    monkeypatch.setattr(settings, "embedding_provider", embedding_provider)
    monkeypatch.setattr(settings, "llm_provider", llm_provider)
    monkeypatch.setattr(settings, "openrouter_api_key", openrouter_key)
    monkeypatch.setattr(settings, "openai_api_key", openai_key)
    monkeypatch.setattr(settings, "gemini_api_key", gemini_key)
    assert resolve_embedding_provider() == expected


def test_default_gemini_embedding_model_supports_vector_dimensions() -> None:
    # text-embedding-004 caps at 768 dims, which cannot fill the 1536-dim column.
    field = type(get_settings()).model_fields["gemini_embedding_model"]
    assert field.default != "text-embedding-004"
