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
    password: str
    role: str = "player"
    email: Optional[str] = None

    @field_validator("role")
    @classmethod
    def role_valid(cls, v):
        if v not in ROLES:
            raise ValueError(f"Role must be one of: {', '.join(ROLES)}")
        return v

    @field_validator("password")
    @classmethod
    def password_valid(cls, v):
        if len(v) < 8:
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
