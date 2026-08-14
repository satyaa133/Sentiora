from functools import lru_cache
from typing import Self

from pydantic import Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

DEFAULT_JWT_SECRET_KEY = "DEV_SECRET_KEY_CHANGE_IN_PRODUCTION_SENTIORA_2026"
DEFAULT_DATABASE_URL = (
    "postgresql+psycopg://postgres:CHANGE_ME_LOCAL_DEV@localhost:5432/Sentiora"
)


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        extra="ignore",
    )

    app_name: str = "Sentiora Backend"
    app_environment: str = "development"
    app_version: str = "0.1.0"
    api_v1_prefix: str = "/api/v1"
    database_url: str = DEFAULT_DATABASE_URL
    redis_url: str = "redis://localhost:6379/0"
    cors_origins: list[str] = Field(default_factory=lambda: ["http://localhost:5173"])
    # MUST be overridden via JWT_SECRET_KEY env var in staging/production.
    jwt_secret_key: str = DEFAULT_JWT_SECRET_KEY
    jwt_algorithm: str = "HS256"
    access_token_expire_minutes: int = 15
    refresh_token_expire_days: int = 30
    openai_api_key: str | None = None
    openai_embedding_model: str = "text-embedding-3-small"
    openai_chat_model: str = "gpt-4o-mini"
    # RAG retrieval tuning
    rag_top_k: int = 8
    rag_max_distance: float = 0.65
    # Maximum total characters of retrieved chunk content sent to the LLM.
    # Keeps prompt size predictable and within token budget.
    rag_max_context_chars: int = 6000
    embedding_dimensions: int = 1536

    @field_validator("cors_origins", mode="before")
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
        if (
            self.app_environment != "development"
            and self.jwt_secret_key == DEFAULT_JWT_SECRET_KEY
        ):
            raise ValueError(
                "jwt_secret_key must be set via JWT_SECRET_KEY when "
                "app_environment is not 'development'"
            )
        return self


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()
