"""OpenAI-compatible clients for every chat provider, with their privacy settings.

Shared by Ask (``rag_service``) and enrichment (``enrichment_service``). The
client class is passed in so each caller's module-level ``OpenAI`` (which the
test suite replaces to block live calls) is the one used.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from openai import OpenAI

from app.core.config import Settings, openrouter_fallback_list
from app.services.llm_pool import OPENROUTER_PRIVACY, LLMBackend

GROQ_BASE_URL = "https://api.groq.com/openai/v1"
OPENROUTER_BASE_URL = "https://openrouter.ai/api/v1"
OPENROUTER_HEADERS = {
    "HTTP-Referer": "https://github.com/satyaa133/Sentiora",
    "X-Title": "Sentiora",
}


@dataclass(frozen=True)
class Extra:
    """Provider-specific headers and body fields for an OpenAI-compatible call."""

    headers: dict[str, str] | None = None
    body: dict[str, Any] | None = None


def openai_compatible_client(
    backend: LLMBackend,
    timeout: float,
    settings: Settings,
    *,
    structured: bool = False,
    client_cls: type[OpenAI] = OpenAI,
) -> tuple[OpenAI, Extra]:
    """Client and extra request arguments for an OpenAI-compatible backend."""
    if backend.provider == "groq":
        # gpt-oss models reason before answering; keep it short so the answer
        # fits max_tokens and starts quickly.
        groq_body = {"reasoning_effort": "low"} if "gpt-oss" in backend.model else None
        return client_cls(
            api_key=backend.api_key,
            base_url=GROQ_BASE_URL,
            timeout=timeout,
            max_retries=0,
        ), Extra(body=groq_body)
    if backend.provider != "openrouter":
        return client_cls(api_key=backend.api_key, timeout=timeout, max_retries=0), Extra()
    body: dict[str, Any] = {}
    fallbacks = [m for m in openrouter_fallback_list(settings) if m != backend.model]
    if fallbacks:
        # OpenRouter tries these in order when the primary model is unavailable.
        body["models"] = [backend.model, *fallbacks]
    # Never route to a provider that stores or trains on prompts (REBUILD_PLAN
    # D13): zero-data-retention endpoints that don't collect data only.
    body["provider"] = dict(OPENROUTER_PRIVACY)
    if structured:
        # Only route to providers that actually enforce response_format.
        body["provider"]["require_parameters"] = True
    # OpenRouter usage accounting: the response reports the call's cost.
    body["usage"] = {"include": True}
    client = client_cls(
        api_key=backend.api_key,
        base_url=OPENROUTER_BASE_URL,
        timeout=timeout,
        max_retries=0,  # the key pool fails over instead of the SDK retrying
    )
    return client, Extra(headers=OPENROUTER_HEADERS, body=body)
