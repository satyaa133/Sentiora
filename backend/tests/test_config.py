import pytest
from pydantic_core import ValidationError

def test_production_rejects_default_secret(monkeypatch):
    from app.core.config import get_settings, Settings
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", "DEV_SECRET_KEY_CHANGE_IN_PRODUCTION_SENTIORA_2026")
    with pytest.raises(ValidationError) as exc_info:
        Settings()
    assert "jwt_secret_key must be set via JWT_SECRET_KEY" in str(exc_info.value)

def test_production_rejects_empty_secret(monkeypatch):
    from app.core.config import get_settings, Settings
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", "")
    with pytest.raises(ValidationError) as exc_info:
        Settings()
    assert "jwt_secret_key cannot be empty" in str(exc_info.value)

def test_production_accepts_valid_secret(monkeypatch):
    from app.core.config import get_settings, Settings
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENVIRONMENT", "production")
    monkeypatch.setenv("JWT_SECRET_KEY", "super_secure_test_key_12345")
    settings = Settings()
    assert settings.app_environment == "production"
    assert settings.jwt_secret_key == "super_secure_test_key_12345"

def test_development_accepts_default_secret(monkeypatch):
    from app.core.config import get_settings, Settings
    get_settings.cache_clear()
    monkeypatch.setenv("APP_ENVIRONMENT", "development")
    settings = Settings()
    assert settings.app_environment == "development"
    assert settings.jwt_secret_key == "DEV_SECRET_KEY_CHANGE_IN_PRODUCTION_SENTIORA_2026"
