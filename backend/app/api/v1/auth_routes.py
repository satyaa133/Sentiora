import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session as DBSession

from app.api.deps import get_current_user, get_db
from app.models.user import User
from app.schemas.auth import (
    AuthTokenData,
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    RefreshTokenRequest,
    RegisterRequest,
    RegisterResponseData,
    ResetPasswordRequest,
)
from app.schemas.envelope import (
    APIResponse,
    ResponseMeta,
)
from app.services.auth_service import AuthService

router = APIRouter(prefix="/auth", tags=["Authentication"])


def _meta(request: Request) -> ResponseMeta:
    request_id = getattr(request.state, "request_id", f"req_{uuid.uuid4().hex[:8]}")
    return ResponseMeta(request_id=request_id)


@router.post(
    "/register",
    response_model=APIResponse[RegisterResponseData],
    status_code=status.HTTP_201_CREATED,
    summary="Register a new user account",
)
def register(
    req: RegisterRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
) -> APIResponse[RegisterResponseData]:
    service = AuthService(db)
    data = service.register(req)
    return APIResponse(data=data, meta=_meta(request))


@router.post(
    "/login",
    response_model=APIResponse[AuthTokenData],
    status_code=status.HTTP_200_OK,
    summary="Login with email and password",
)
def login(
    req: LoginRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
) -> APIResponse[AuthTokenData]:
    service = AuthService(db)
    user_agent = request.headers.get("user-agent")
    ip_address = request.client.host if request.client else None
    # TestClient shim: FastAPI's TestClient reports client host as 'testclient'
    if ip_address == "testclient":
        ip_address = "127.0.0.1"
    data = service.login(req, ip_address=ip_address, user_agent=user_agent)
    return APIResponse(data=data, meta=_meta(request))


@router.post(
    "/refresh-token",
    response_model=APIResponse[AuthTokenData],
    status_code=status.HTTP_200_OK,
    summary="Refresh access token using a valid refresh token",
)
def refresh_token(
    req: RefreshTokenRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
) -> APIResponse[AuthTokenData]:
    service = AuthService(db)
    data = service.refresh_tokens(req.refresh_token)
    return APIResponse(data=data, meta=_meta(request))


@router.post(
    "/logout",
    status_code=status.HTTP_200_OK,
    summary="Logout and revoke refresh tokens for the current user",
)
def logout(
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    service = AuthService(db)
    service.logout(current_user.id)
    return {
        "success": True,
        "data": {"message": "Logged out successfully."},
        "meta": _meta(request).model_dump(),
    }


@router.get(
    "/me",
    status_code=status.HTTP_200_OK,
    summary="Get the currently authenticated user's identity",
)
def get_current_user_me(
    request: Request,
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    return {
        "success": True,
        "data": {
            "id": str(current_user.id),
            "email": current_user.email,
            "is_email_verified": current_user.is_email_verified,
            "is_active": current_user.is_active,
        },
        "meta": _meta(request).model_dump(),
    }


@router.post(
    "/forgot-password",
    status_code=status.HTTP_202_ACCEPTED,
    summary="Request a password reset link (always returns success for security)",
)
def forgot_password(
    req: ForgotPasswordRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    # Always return success to prevent user enumeration (API Spec §10.5)
    # TODO: Integrate email sending in a future phase
    return {
        "success": True,
        "data": {
            "message": "If this email is registered, you will receive a reset link."
        },
        "meta": _meta(request).model_dump(),
    }


@router.post(
    "/reset-password",
    status_code=status.HTTP_200_OK,
    summary="Reset user password using a reset token",
)
def reset_password(
    req: ResetPasswordRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
) -> dict:
    # Reset token email flow is out of scope for Phase 1 MVP
    # Endpoint is defined per API Spec §10.6; returns placeholder
    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail={
            "code": "AUTH_RESET_TOKEN_INVALID",
            "message": "Password reset via token is not yet implemented.",
        },
    )


@router.put(
    "/change-password",
    status_code=status.HTTP_200_OK,
    summary="Change the authenticated user's password",
)
def change_password(
    req: ChangePasswordRequest,
    request: Request,
    db: Annotated[DBSession, Depends(get_db)],
    current_user: Annotated[User, Depends(get_current_user)],
) -> dict:
    service = AuthService(db)
    service.change_password(current_user.id, req)
    return {
        "success": True,
        "data": {"message": "Password changed successfully."},
        "meta": _meta(request).model_dump(),
    }
