from functools import lru_cache
from typing import Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

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
    openrouter_api_key: str | None = None
    openrouter_chat_model: str = "anthropic/claude-haiku-4.5"
    # Optional second OpenRouter key. Ask rotates across every configured chat
    # key and skips one that is out of credits or rate-limited (llm_pool.py).
    openrouter_api_key_2: str | None = None
    # How long a failing chat key is skipped before it is tried again.
    llm_key_cooldown_seconds: int = 300
    # RAG retrieval tuning
    rag_top_k: int = 15
    # Chunks handed to the model per question (summary questions take up to 8).
    rag_final_k: int = 6
    # Candidates fetched from each retrieval leg (vector, full-text) before fusion.
    rag_candidates: int = 30
    # Cosine similarity a vector hit needs to count as relevant. When no hit
    # clears it and no full-text hit matches, the question is "not covered".
    rag_min_similarity: float = 0.25
    # MMR trade-off between relevance (1.0) and diversity (0.0).
    rag_mmr_lambda: float = 0.7
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
    return Settings()
