"""Authentication endpoints for Grimoire."""

from fastapi import APIRouter, HTTPException, Depends
from pydantic import BaseModel, field_validator

from ..config import SessionLocal
from ..models import User
from ..auth import (
    get_current_user,
    CurrentUser,
    hash_password,
    verify_password,
    create_token,
)
from .settings._helpers import (
    _get_raw,
    password_auth_effective,
    oidc_effective,
    oidc_is_configured,
)


class LoginRequest(BaseModel):
    username: str
    password: str


class SetupRequest(BaseModel):
    username: str
    password: str

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        v = v.strip()
        if len(v) < 2:
            raise ValueError("Username must be at least 2 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


public_router = APIRouter(prefix="/api/auth")


@public_router.get(
    "/status",
    tags=["auth"],
    summary="Check initialization status",
    description="Returns whether the server has any users. Used by the frontend to decide whether to show the first-run setup screen.",
)
def auth_status():
    db = SessionLocal()
    try:
        return {"initialized": db.query(User).count() > 0}
    finally:
        db.close()


@public_router.post(
    "/setup",
    tags=["auth"],
    summary="First-run admin setup",
    description="Creates the initial admin account. Returns a JWT. Fails if any users already exist.",
)
def auth_setup(data: SetupRequest):
    db = SessionLocal()
    try:
        if db.query(User).count() > 0:
            raise HTTPException(400, "Server is already initialized")
        user = User(
            username=data.username,
            hashed_password=hash_password(data.password),
            role="admin",
        )
        db.add(user)
        db.commit()
        db.refresh(user)
        token = create_token(user.id, user.username, user.role)
        return {
            "token": token,
            "user": {"id": user.id, "username": user.username, "role": user.role},
        }
    finally:
        db.close()


@public_router.post(
    "/login",
    tags=["auth"],
    summary="Log in",
    description="Authenticates with username and password. Returns a JWT valid for 30 days.",
)
def auth_login(data: LoginRequest):
    db = SessionLocal()
    try:
        if not password_auth_effective(_get_raw(db)):
            raise HTTPException(403, "Password authentication is disabled")
        user = db.query(User).filter_by(username=data.username).first()
        if not user or not verify_password(data.password, user.hashed_password):
            raise HTTPException(401, "Invalid username or password")
        token = create_token(user.id, user.username, user.role)
        return {
            "token": token,
            "user": {"id": user.id, "username": user.username, "role": user.role},
        }
    finally:
        db.close()


@public_router.get(
    "/config",
    tags=["auth"],
    summary="Public auth configuration",
    description="Returns auth-related settings needed by the unauthenticated login screen: which auth methods are enabled and the optional custom login message.",
)
def auth_config():
    db = SessionLocal()
    try:
        raw = _get_raw(db)
        msg_enabled = raw.get("custom_login_message_enabled", "false") == "true"
        eff = oidc_effective(raw)
        oidc_ready = oidc_is_configured(raw)
        return {
            "password_auth_enabled": password_auth_effective(raw),
            "custom_login_message_enabled": msg_enabled,
            "custom_login_message": raw.get("custom_login_message", "") if msg_enabled else "",
            # OIDC — only expose enough for the login screen to render the button.
            # The button is shown only when the IdP is fully configured.
            "oidc_enabled": eff["oidc_enabled"] and oidc_ready,
            "oidc_button_text": eff["oidc_button_text"] if oidc_ready else "",
            "oidc_auto_launch": eff["oidc_auto_launch"] and oidc_ready,
        }
    finally:
        db.close()


router = APIRouter()


@router.get(
    "/auth/me",
    tags=["auth"],
    summary="Get current user",
    description="Returns the authenticated user's id, username, role, and preferences.",
)
def auth_me(user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        u = db.query(User).filter_by(id=user.id).first()
        if not u:
            raise HTTPException(401, "User no longer exists")
        allow_explicit = u.allow_explicit if u.allow_explicit is not None else True
    finally:
        db.close()
    return {
        "id": u.id,
        "username": u.username,
        "display_name": u.display_name,
        "email": u.email,
        "role": u.role,
        "allow_explicit": allow_explicit,
        "oidc_linked": bool(u.oidc_subject),
    }
