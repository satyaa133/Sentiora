"""Error tracking (Sentry) for the API and worker, off unless SENTRY_DSN is set.

Saved pages are private, so nothing personal goes to Sentry: no request
bodies, no cookies or auth headers (``send_default_pii`` off), and no local
variables in stack traces (they would include page text and questions).
"""

from __future__ import annotations

from typing import Any

from app.core.config import get_settings


def init_error_tracking(component: str, *, transport: Any = None) -> bool:
    """Start Sentry for ``component`` ("api" or "worker"). Returns True if started."""
    settings = get_settings()
    if not settings.sentry_dsn:
        return False

    import sentry_sdk

    options: dict[str, Any] = {
        "dsn": settings.sentry_dsn,
        "environment": settings.app_environment,
        "release": f"sentiora-backend@{settings.app_version}",
        "traces_sample_rate": settings.sentry_traces_sample_rate,
        "send_default_pii": False,
        "max_request_body_size": "never",
        "include_local_variables": False,
    }
    if transport is not None:
        options["transport"] = transport
    sentry_sdk.init(**options)
    sentry_sdk.set_tag("component", component)
    return True
