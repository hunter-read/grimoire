"""Pydantic schemas for API key management."""
import datetime
from typing import Optional

from pydantic import BaseModel, Field


class ApiKeyCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=100)
    # {permission: "none" | "read" | "write"}; omitted permissions are No access.
    permissions: dict[str, str] = Field(default_factory=dict)
    # Null (or omitted) means the key never expires.
    expires_at: Optional[datetime.datetime] = None


class ApiKeyUpdate(BaseModel):
    """Every field optional; send ``expires_at: null`` to make a key never expire."""

    name: Optional[str] = Field(None, min_length=1, max_length=100)
    permissions: Optional[dict[str, str]] = None
    expires_at: Optional[datetime.datetime] = None


class ApiKeyOut(BaseModel):
    """A key as listed: everything but the secret, which is never stored."""

    id: str
    # The user the key acts as.
    user_id: str
    # Their username; listed so an admin reviewing every key can tell whose it is.
    username: Optional[str] = None
    name: str
    prefix: str
    permissions: dict[str, str]
    created_at: Optional[datetime.datetime] = None
    last_used_at: Optional[datetime.datetime] = None
    expires_at: Optional[datetime.datetime] = None
    expired: bool


class ApiKeyWithSecret(BaseModel):
    """Create/regenerate response: the only time the full key is returned."""

    api_key: ApiKeyOut
    key: str


class ApiKeyPermissionOut(BaseModel):
    id: str
    tags: list[str]
    description: str
    # The key editor's section: "library", "media", "campaigns" or "admin".
    group: str
    # The levels the caller's role can use here: a player sees game systems as
    # ["none", "read"], and permissions their role can't reach are left out.
    levels: list[str]
