"""Pydantic schemas for the auth API."""
from typing import Optional

from pydantic import BaseModel, field_validator


class LoginRequest(BaseModel):
    username: str
    password: str


class GuestLoginRequest(BaseModel):
    code: str

    @field_validator("code")
    @classmethod
    def code_clean(cls, v):
        return (v or "").strip().upper()


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


class AuthStatusResponse(BaseModel):
    initialized: bool


class LoginUser(BaseModel):
    """The abbreviated user block returned by every login-ish endpoint."""

    id: str
    username: str
    # `display_name` is an explicitly nullable column (users may never set one).
    display_name: Optional[str] = None
    # `role` is `default="player"` rather than NOT NULL, so legacy rows can be NULL.
    role: Optional[str] = None


class LoginResponse(BaseModel):
    """Body shared by setup/login/refresh, as built by `_helpers.issue_login`.

    The refresh token is deliberately absent — it travels only as an HttpOnly
    cookie, so it must not appear in the schema either.
    """

    token: str
    user: LoginUser


class GuestLoginResponse(LoginResponse):
    """Guest login adds the campaign the invite code was scoped to."""

    campaign_id: str


class OkResponse(BaseModel):
    ok: bool


class RevokeSessionResponse(BaseModel):
    ok: bool
    revoked: int


class RevokeOtherSessionsResponse(BaseModel):
    ok: bool
    revoked: int
    # False when the access token predates sessions (no `sid`), in which case
    # every session was revoked and the caller was logged out too.
    kept_current: bool


class SessionOut(BaseModel):
    """One live session row, as built by `core._session_payload`."""

    id: str
    # Coalesced by the handler (`session.origin or "password"`).
    origin: str
    # Both are explicitly nullable columns — best-effort client details only.
    user_agent: Optional[str] = None
    ip_address: Optional[str] = None
    # `created_at`/`last_used_at` are `default=...` rather than NOT NULL, and the
    # handler emits None for a NULL datetime rather than omitting the key.
    created_at: Optional[str] = None
    last_used_at: Optional[str] = None
    # `expires_at` is NOT NULL in the model, but the handler still guards it.
    expires_at: Optional[str] = None
    current: bool


class AuthConfigResponse(BaseModel):
    password_auth_enabled: bool
    guest_access_enabled: bool
    custom_login_message_enabled: bool
    custom_login_message: str
    oidc_enabled: bool
    oidc_button_text: str
    oidc_auto_launch: bool


class AuthMeResponse(BaseModel):
    id: str
    username: str
    # Nullable columns; `role` is `default=...` so legacy rows can be NULL.
    display_name: Optional[str] = None
    email: Optional[str] = None
    role: Optional[str] = None
    # Both are coalesced by the handler, so they are always concrete booleans.
    allow_explicit: bool
    campaign_access: bool
    oidc_linked: bool
