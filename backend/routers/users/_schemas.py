"""Pydantic schemas for the users API."""
import re
from typing import Optional
from pydantic import BaseModel, field_validator

from ...auth import ROLES


# Pragmatic email regex — matches the same shape browsers use for input[type=email].
# We only need it to reject obvious garbage; the IdP/SMTP server is the real authority.
_EMAIL_RE = re.compile(r"^[^\s@]+@[^\s@]+\.[^\s@]+$")


def _normalize_email(v: Optional[str]) -> Optional[str]:
    """Trim and lowercase. Empty string → None (so the field can be cleared)."""
    if v is None:
        return None
    v = v.strip().lower()
    if not v:
        return None
    if not _EMAIL_RE.match(v):
        raise ValueError("Invalid email address")
    return v


class UserCreate(BaseModel):
    username: str
    # Optional so admins can create OIDC-only accounts when password auth is
    # disabled. When provided it must still meet the length requirement.
    password: Optional[str] = None
    role: str = "player"
    email: Optional[str] = None
    allow_explicit: Optional[bool] = None
    campaign_access: Optional[bool] = None

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v not in ROLES:
            raise ValueError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        return _normalize_email(v)


class UserUpdate(BaseModel):
    role: Optional[str] = None
    password: Optional[str] = None
    allow_explicit: Optional[bool] = None
    campaign_access: Optional[bool] = None
    email: Optional[str] = None  # "" clears the value

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v is not None and v not in ROLES:
            raise ValueError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if v is not None and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        # Allow None (no change) and "" (clear). Validate any other value.
        if v is None or v == "":
            return v
        return _normalize_email(v)


class GuestConvert(BaseModel):
    """Promote a guest to a permanent account. Password is optional because it's
    only applied when password auth is enabled (validated in the handler)."""

    username: str
    password: Optional[str] = None
    role: str = "player"

    @field_validator("username")
    @classmethod
    def username_valid(cls, v):
        v = (v or "").strip()
        if not v:
            raise ValueError("Username is required")
        return v

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        # A guest promoted to a permanent account shouldn't stay a guest.
        if v not in ROLES or v == "guest":
            allowed = ", ".join(r for r in ROLES if r != "guest")
            raise ValueError(f"Role must be one of: {allowed}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if v is not None and v != "" and len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class PasswordChange(BaseModel):
    current_password: str
    new_password: str

    @field_validator("new_password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class PreferencesUpdate(BaseModel):
    allow_explicit: Optional[bool] = None
    display_name: Optional[str] = None
    email: Optional[str] = None  # "" clears

    @field_validator("email")
    @classmethod
    def email_valid(cls, v):
        if v is None or v == "":
            return v
        return _normalize_email(v)


class UserOut(BaseModel):
    """A user row in the admin list, and the body returned by create/convert.

    The three handlers emit slightly different subsets of these keys — the admin
    list and `convert_guest` include `display_name`/`created_at`, `create_user`
    does not — so every key that is not in all of them is Optional.
    """

    id: str
    username: str
    # Explicitly nullable column, and absent from `create_user`'s dict.
    display_name: Optional[str] = None
    email: Optional[str] = None
    # `role` is `default="player"` rather than NOT NULL, so it can be NULL.
    role: Optional[str] = None
    # Both are coalesced by the handlers, so they are always concrete booleans.
    allow_explicit: bool
    campaign_access: bool
    campaign_count: int
    oidc_linked: bool
    # `created_at` is `default=...` rather than NOT NULL, and `create_user` omits
    # the key entirely.
    created_at: Optional[str] = None


class UserUpdateResponse(BaseModel):
    """`update_user` returns a deliberately narrower body than `UserOut`."""

    id: str
    username: str
    email: Optional[str] = None
    role: Optional[str] = None
    allow_explicit: bool
    campaign_access: bool


class GuestOut(BaseModel):
    """One guest account, with the campaign it is scoped to and its inviter."""

    id: str
    display_name: Optional[str] = None
    # `created_at` is `default=...` rather than NOT NULL.
    created_at: Optional[str] = None
    # All three are None when the guest's membership or campaign has been
    # deleted out from under it.
    campaign_id: Optional[str] = None
    campaign_name: Optional[str] = None
    invited_by: Optional[str] = None


class PreferencesResponse(BaseModel):
    """Echoes the stored values, which are all nullable columns."""

    allow_explicit: Optional[bool] = None
    display_name: Optional[str] = None
    email: Optional[str] = None


class PasswordChangeResponse(BaseModel):
    status: str
    # How many *other* sessions were ended; the current one is kept.
    sessions_revoked: int


class OpdsStatusResponse(BaseModel):
    opds_enabled: bool
    # Omitted entirely when OPDS is disabled or the caller is a guest — that
    # branch returns only `opds_enabled`/`feed_url`.
    has_token: Optional[bool] = None
    # Null when no token has been generated yet.
    feed_url: Optional[str] = None
