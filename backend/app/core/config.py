import logging
import os
import re
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any, Self

from dotenv import dotenv_values
from pydantic import Field, ValidationError, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

LLM_PROVIDERS = ("openai", "gemini", "openrouter")
EMBEDDING_PROVIDER_CHOICES = ("auto", "openrouter", "openai", "gemini", "none")
# memory_chunks.embedding is vector(1536) in the migrations.
VECTOR_DIMENSIONS = 1536
_OPENROUTER_MODEL_RE = re.compile(r"^[A-Za-z0-9._-]+/[A-Za-z0-9._:-]+$")

logger = logging.getLogger(__name__)

DEFAULT_JWT_SECRET_KEY = "DEV_SECRET_KEY_CHANGE_IN_PRODUCTION_SENTIORA_2026"
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:CHANGE_ME_LOCAL_DEV@127.0.0.1:5432/Sentiora"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        # Load repo-root .env first, then backend/.env so local backend settings win.
        env_file=("../.env", ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Sentiora Backend"
    app_environment: str = "development"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    database_url: str = DEFAULT_DATABASE_URL
    redis_url: str = "redis://127.0.0.1:6379/0"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    # Reverse proxies whose X-Forwarded-For header is trusted for client IPs
    # (rate limiting). Empty = ignore X-Forwarded-For entirely.
    trusted_proxy_ips: list[str] = Field(default_factory=list)
    # Reject request bodies larger than this (bytes) before parsing.
    max_request_body_bytes: int = 4 * 1024 * 1024
    # MUST be overridden via JWT_SECRET_KEY env var in staging/production.
    jwt_secret_key: str = DEFAULT_JWT_SECRET_KEY
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    llm_provider: str = "openai"
    # Embedding provider for semantic search:
    # "auto" | "openrouter" | "openai" | "gemini" | "none".
    # "auto" uses OpenRouter when an OpenRouter key is set; otherwise it follows
    # LLM_PROVIDER (openai/gemini), then the first configured embedding key.
    embedding_provider: str = "auto"
    # Embedding model for the chosen provider. Empty = the provider default
    # (openrouter: openai/text-embedding-3-small). Changing it requires the
    # embedding backfill: queries only match chunks embedded with this model.
    embedding_model: str | None = None
    openrouter_embedding_model: str = "openai/text-embedding-3-small"
    openai_api_key: str | None = None
    openai_embedding_model: str = "text-embedding-3-small"
    openai_chat_model: str = "gpt-4o-mini"
    gemini_api_key: str | None = None
    # Must support EMBEDDING_DIMENSIONS output (text-embedding-004 caps at 768).
    gemini_embedding_model: str = "gemini-embedding-001"
    gemini_chat_model: str = "gemini-2.5-flash"
    # OpenRouter keys: OPENROUTER_API_KEY and/or OPENROUTER_API_KEY_1..N (any
    # count, auto-detected from the environment and .env files). Ask and
    # embeddings rotate across all of them; use openrouter_keys() to read them.
    openrouter_api_key: str | None = None
    openrouter_chat_model: str = "anthropic/claude-haiku-4.5"
    # Comma-separated OpenRouter models tried in order when the chat model is
    # unavailable (sent as OpenRouter's `models` fallback list).
    openrouter_fallback_models: str = ""
    # Kept as a field for older .env files; any OPENROUTER_API_KEY_N works.
    openrouter_api_key_2: str | None = None
    # Numbered keys found at startup (OPENROUTER_API_KEY_<n>), by number.
    openrouter_numbered_keys: dict[int, str] = Field(default_factory=dict, exclude=True)
    # A key that fails with an out-of-credit, auth or rate-limit error is skipped
    # for this long, doubling on each further failure up to the maximum.
    llm_key_cooldown_seconds: int = Field(default=300, ge=1)
    llm_cooldown_max_seconds: int = Field(default=3600, ge=1)
    # At most this many backends (keys) are tried for one model call.
    llm_max_attempts: int = Field(default=4, ge=1, le=20)
    # RAG retrieval tuning
    rag_top_k: int = 15
    # Chunks handed to the model per question (summary questions take up to 8).
    rag_final_k: int = 6
    # Candidates fetched from each retrieval leg (vector, full-text) before fusion.
    rag_candidates: int = 30
    # Cosine similarity a vector hit needs to count as relevant. When no hit
    # clears it and no full-text hit matches, the question is "not covered".
    rag_min_similarity: float = Field(default=0.25, ge=0.0, le=1.0)
    # MMR trade-off between relevance (1.0) and diversity (0.0).
    rag_mmr_lambda: float = Field(default=0.7, ge=0.0, le=1.0)
    # At most this many chunks from one memory, unless the question is scoped
    # to that memory or asks for a summary.
    rag_max_chunks_per_memory: int = 2
    # "Which sources mention X" answers: a meaning-only hit must be at least
    # this close (cosine distance) to be listed as mentioning X.
    rag_strong_distance: float = 0.4
    # Maximum total characters of retrieved chunk content sent to the LLM.
    # Keeps prompt size predictable and within token budget.
    rag_max_context_chars: int = 12000
    # Output budget for Ask answers. Sized for structured multi-point
    # explanations without encouraging rambling dumps.
    rag_max_output_tokens: int = 900
    embedding_dimensions: int = 1536
    rate_limit_login_per_minute: int = 10
    rate_limit_register_per_minute: int = 5
    rate_limit_chat_per_minute: int = 20
    rate_limit_chat_per_user_per_minute: int = 10
    rate_limit_refresh_per_minute: int = 30
    rate_limit_search_per_user_per_minute: int = 30
    failed_login_max_attempts: int = 5
    failed_login_base_backoff_seconds: int = 2
    failed_login_max_backoff_seconds: int = 60

    @field_validator("cors_origins", "trusted_proxy_ips", mode="before")
    @classmethod
    def parse_cors_origins(cls, value: object) -> list[str]:
        if value is None:
            return []
        if isinstance(value, str):
            return [origin.strip() for origin in value.split(",") if origin.strip()]
        if isinstance(value, list):
            return [str(origin).strip() for origin in value if str(origin).strip()]
        return []

    @model_validator(mode="after")
    def collect_numbered_openrouter_keys(self) -> Self:
        if not self.openrouter_numbered_keys:
            self.openrouter_numbered_keys = _numbered_env_keys(
                "OPENROUTER_API_KEY_", self.model_config.get("env_file")
            )
        return self

    @model_validator(mode="after")
    def validate_ai_settings(self) -> Self:
        problems: list[str] = []
        if self.llm_provider.strip().lower() not in LLM_PROVIDERS:
            problems.append(
                f"LLM_PROVIDER={self.llm_provider!r} must be one of {', '.join(LLM_PROVIDERS)}"
            )
        if self.embedding_provider.strip().lower() not in EMBEDDING_PROVIDER_CHOICES:
            problems.append(
                f"EMBEDDING_PROVIDER={self.embedding_provider!r} must be one of "
                f"{', '.join(EMBEDDING_PROVIDER_CHOICES)}"
            )
        if self.embedding_dimensions != VECTOR_DIMENSIONS:
            problems.append(
                f"EMBEDDING_DIMENSIONS must be {VECTOR_DIMENSIONS}: memory_chunks.embedding "
                f"is vector({VECTOR_DIMENSIONS})"
            )
        for model in [self.openrouter_chat_model, *openrouter_fallback_list(self)]:
            if not _OPENROUTER_MODEL_RE.match(model):
                problems.append(
                    f"OpenRouter model {model!r} must look like 'vendor/model' "
                    "(OPENROUTER_CHAT_MODEL, OPENROUTER_FALLBACK_MODELS)"
                )
        if self.llm_cooldown_max_seconds < self.llm_key_cooldown_seconds:
            problems.append(
                "LLM_COOLDOWN_MAX_SECONDS must be >= LLM_KEY_COOLDOWN_SECONDS"
            )
        if problems:
            raise ValueError("; ".join(problems))
        return self

    @model_validator(mode="after")
    def validate_non_development_secrets(self) -> Self:
        if self.app_environment != "development":
            if not self.jwt_secret_key or not self.jwt_secret_key.strip():
                raise ValueError(
                    "jwt_secret_key cannot be empty when app_environment is not 'development'"
                )
            if self.jwt_secret_key == DEFAULT_JWT_SECRET_KEY:
                raise ValueError(
                    "jwt_secret_key must be set via JWT_SECRET_KEY when "
                    "app_environment is not 'development'"
                )
            if len(self.jwt_secret_key) < 32:
                raise ValueError(
                    "JWT_SECRET_KEY must be at least 32 characters when "
                    "app_environment is not 'development'"
                )
            if "*" in self.cors_origins:
                raise ValueError(
                    "CORS_ORIGINS must list explicit origins (no '*') when "
                    "app_environment is not 'development'"
                )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    try:
        return Settings()
    except ValidationError as exc:
        # One readable line per problem instead of a pydantic traceback.
        lines = []
        for error in exc.errors():
            field = ".".join(str(part) for part in error["loc"]).upper() or "SETTINGS"
            message = str(error["msg"]).removeprefix("Value error, ")
            lines.append(
                f"  - {field}: {message}" if error["loc"] else f"  - {message}"
            )
        print(
            "Invalid Sentiora backend configuration:\n" + "\n".join(lines),
            file=sys.stderr,
        )
        raise SystemExit(2) from None


def openrouter_keys(settings: Any) -> list[str]:
    """Every configured OpenRouter key, de-duplicated, in a stable order.

    OPENROUTER_API_KEY first, then OPENROUTER_API_KEY_1..N by number.
    ``OPENROUTER_API_KEY_2`` also arrives through its legacy field, which wins
    over the scanned value so tests and overrides of the field apply.
    """
    numbered = dict(getattr(settings, "openrouter_numbered_keys", None) or {})
    legacy_second = getattr(settings, "openrouter_api_key_2", None)
    if legacy_second is not None:
        numbered[2] = legacy_second
    ordered = [getattr(settings, "openrouter_api_key", None)] + [
        numbered[n] for n in sorted(numbered)
    ]
    return [key for key in dict.fromkeys(k.strip() for k in ordered if k and k.strip())]


def openrouter_fallback_list(settings: Any) -> list[str]:
    """``OPENROUTER_FALLBACK_MODELS`` as a list (comma-separated in the env)."""
    raw = getattr(settings, "openrouter_fallback_models", None) or ""
    if isinstance(raw, list):
        return [str(m).strip() for m in raw if str(m).strip()]
    return [m.strip() for m in str(raw).split(",") if m.strip()]


def _numbered_env_keys(prefix: str, env_files: object) -> dict[int, str]:
    """``PREFIX<n>`` values from .env files, overridden by the process environment."""
    pattern = re.compile(rf"^{re.escape(prefix)}(\d+)$")
    found: dict[int, str] = {}
    files = (
        env_files
        if isinstance(env_files, list | tuple)
        else [env_files]
        if env_files
        else []
    )
    for name in files:
        path = Path(str(name))
        if path.is_file():
            for key, value in dotenv_values(path).items():
                match = pattern.match(key)
                if match and value is not None:
                    found[int(match.group(1))] = value
    for key, value in os.environ.items():
        match = pattern.match(key)
        if match:
            found[int(match.group(1))] = value
    return {n: v.strip() for n, v in found.items() if v and v.strip()}
