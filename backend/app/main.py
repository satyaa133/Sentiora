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
settings = get_settings()

app = FastAPI(
    title=settings.app_name,
    version=settings.app_version,
    docs_url="/docs",
    redoc_url="/redoc",
)


@app.middleware("http")
async def attach_request_id(request: Request, call_next):  # type: ignore[no-untyped-def]
    request.state.request_id = f"req_{uuid.uuid4().hex[:8]}"
    response = await call_next(request)
    response.headers["X-Request-ID"] = request.state.request_id
    return response


if settings.cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.cors_origins,
        allow_origin_regex=r"chrome-extension://.*",
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
    return JSONResponse(
        status_code=500,
        content={
            "success": False,
            "error": {
                "code": "SYSTEM_ERROR",
                "message": "An unexpected error occurred.",
                "details": None,
            },
            "meta": _meta(request),
        },
    )


app.include_router(health_router)
app.include_router(auth_router, prefix=settings.api_v1_prefix)
app.include_router(user_router, prefix=settings.api_v1_prefix)
app.include_router(memory_router, prefix=settings.api_v1_prefix)
app.include_router(ask_router, prefix=settings.api_v1_prefix)
