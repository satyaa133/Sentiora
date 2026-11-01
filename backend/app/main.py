import logging
import uuid
from datetime import datetime, UTC

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from app.api.v1.ask_routes import router as ask_router
from app.api.v1.auth_routes import router as auth_router
from app.api.v1.health_routes import router as health_router
from app.api.v1.memory_routes import router as memory_router
from app.api.v1.user_routes import router as user_router
from app.core.config import get_settings
from app.core.logging import configure_logging
from app.models import MemoryChunk, MemoryItem  # noqa: F401

configure_logging()
logger = logging.getLogger(__name__)
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs" if settings.app_environment == "development" else None,
    redoc_url="/redoc" if settings.app_environment == "development" else None,
)


_DOCS_PATHS = ("/docs", "/redoc", "/openapi.json")


@app.middleware("http")
async def attach_request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
    request.state.request_id = f"req_{uuid.uuid4().hex[:8]}"

    # Refuse oversized bodies before they are read and parsed.
    declared = request.headers.get("content-length")
    if declared and declared.isdigit() and int(declared) > settings.max_request_body_bytes:
        return JSONResponse(
            status_code=413,
            content={
                "success": False,
                "error": {
                    "code": "PAYLOAD_TOO_LARGE",
                    "message": "Request body is too large.",
                    "details": None,
                },
                "meta": _meta(request),
            },
            headers={"X-Request-ID": request.state.request_id},
        )

    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    response.headers.setdefault("X-Content-Type-Options", "nosniff")
    response.headers.setdefault("X-Frame-Options", "DENY")
    response.headers.setdefault("Referrer-Policy", "no-referrer")
    if not request.url.path.startswith(_DOCS_PATHS):
        # JSON API: nothing should ever be rendered or framed. Swagger/ReDoc
        # (development only) load their own assets, so they are excluded.
        response.headers.setdefault(
            "Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'"
        )
    if request.url.scheme == "https" or request.headers.get("x-forwarded-proto") == "https":
        response.headers.setdefault(
            "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
        )
    return response


if settings.cors_origins:
    # Only explicitly configured origins. The Sentiora extension does not need a
    # CORS grant (extension pages with host permissions bypass CORS); a wildcard
    # chrome-extension:// rule would let any installed extension call the API.
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )


def _meta(request: Request) -> dict:
    return {
        "timestamp": datetime.now(UTC).isoformat(),
        "request_id": getattr(
            request.state, "request_id", f"req_{uuid.uuid4().hex[:8]}"
        ),
    }


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    detail = exc.detail
    if isinstance(detail, dict):
        code = detail.get("code", "HTTP_ERROR")
        message = detail.get("message", str(exc.detail))
    else:
        code = "HTTP_ERROR"
        message = str(detail)

    return JSONResponse(
        status_code=exc.status_code,
        content={
            "success": False,
            "error": {"code": code, "message": message, "details": None},
            "meta": _meta(request),
        },
        headers=dict(exc.headers or {}),
    )


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(
    request: Request, exc: RequestValidationError
) -> JSONResponse:
    details = []
    for error in exc.errors():
        field = ".".join(str(loc) for loc in error["loc"] if loc != "body")
        details.append({"field": field, "issue": error["msg"]})

    return JSONResponse(
        status_code=422,
        content={
            "success": False,
            "error": {
                "code": "VALIDATION_ERROR",
                "message": "One or more fields failed validation.",
                "details": details,
            },
            "meta": _meta(request),
        },
    )


@app.exception_handler(Exception)
async def generic_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled server error on %s %s", request.method, request.url.path)
    details = None
    if settings.app_environment == "development":
        details = {"exception": type(exc).__name__, "message": str(exc)}
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "SYSTEM_ERROR",
                "message": "An unexpected error occurred.",
                "details": details,
            },
            "meta": _meta(request),
        },
    )


app.include_router(health_router)
app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(user_router, prefix=settings.api_v1_prefix)
app.include_router(memory_router, prefix=settings.api_v1_prefix)
app.include_router(ask_router, prefix=settings.api_v1_prefix)
