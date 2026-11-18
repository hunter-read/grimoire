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
    # "key" for a key made here; "app" for an OAuth grant - an MCP client a
    # user approved (issue #906), which holds tokens instead of a key and
    # can't be regenerated.
    kind: str = "key"
    # For an app: the name it registered with, and the host it signs in through.
    client_name: Optional[str] = None
    redirect_host: Optional[str] = None


class ApiKeyWithSecret(BaseModel):
    """Create/regenerate response: the only time the full key is returned."""

    api_key: ApiKeyOut
    key: str


class OAuthApproveIn(BaseModel):
    # {permission: level}, as for a key. Omitted: Read on everything the role can read.
    permissions: Optional[dict[str, str]] = None


class OAuthRequestOut(BaseModel):
    """A pending MCP sign-in, for the consent page (issue #906)."""

    client_name: str
    # Where the browser goes once approved: the one detail a lookalike app
    # calling itself "Claude" can't fake. Show it prominently.
    redirect_host: str
    redirect_uri: Optional[str] = None
    # Whether the caller may approve (they may hold keys), and if not, why.
    may_approve: bool
    reason: Optional[str] = None
    default_permissions: dict[str, str]
    # {permission: [levels]} the caller's role can grant, as for a key.
    levels: dict[str, list[str]]


class OAuthRedirectOut(BaseModel):
    # The client's redirect address with a code or an error; the page sends
    # the browser there.
    redirect_to: str


class ApiKeyPermissionOut(BaseModel):
    id: str
    tags: list[str]
    description: str
    # The key editor's section: "library", "media", "campaigns" or "admin".
    group: str
    # The levels the caller's role can use here: a player sees game systems as
    # ["none", "read"], and permissions their role can't reach are left out.
    levels: list[str]
