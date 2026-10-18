"""Pydantic schemas for the share-link management API."""
from typing import Literal, Optional

from pydantic import BaseModel, Field

ShareableType = Literal["book", "map", "token", "audio", "model"]


class ShareLinkCreate(BaseModel):
    resource_type: ShareableType
    resource_id: str = Field(..., max_length=36)
    label: str = Field("", max_length=200)
    # Days until the link stops working; omitted or null for never.
    expires_in_days: Optional[int] = Field(None, ge=1, le=3650)
    # Optional password the share page asks for before showing anything.
    password: Optional[str] = Field(None, min_length=4, max_length=200)
    # Serve a derived form of the item instead (issue #551). "otfbm": a map
    # resized for an OTFBM background, at `cell` pixels per cell (20-100;
    # omitted for the suggested size).
    variant: Optional[Literal["otfbm"]] = None
    cell: Optional[int] = Field(None, ge=20, le=100)


class ShareLinkUpdate(BaseModel):
    """Only the fields sent are changed. `expires_in_days: null` makes the link
    never expire; `password: null` (or "") removes the password."""

    label: Optional[str] = Field(None, max_length=200)
    expires_in_days: Optional[int] = Field(None, ge=1, le=3650)
    password: Optional[str] = Field(None, max_length=200)


class ShareLinkOut(BaseModel):
    id: str
    # The share page, and the raw file for tools that load a URL directly. null
    # when the link is "lost" (sealed under a SECRET_KEY since replaced).
    url: Optional[str] = None
    file_url: Optional[str] = None
    resource_type: str
    resource_id: str
    resource_name: str
    label: str
    filename: str
    has_password: bool
    # null for the item itself; "otfbm" with {"cell": n} for an OTFBM background.
    variant: Optional[str] = None
    variant_options: Optional[dict] = None
    # active | disabled | revoked | expired | suspended | unavailable | lost
    state: str
    created_at: Optional[str] = None
    expires_at: Optional[str] = None
    revoked_at: Optional[str] = None
    last_used_at: Optional[str] = None
    use_count: int = 0
    # Present on the admin listings.
    user_id: Optional[str] = None
    username: Optional[str] = None


class ShareLinkPermission(BaseModel):
    """Whether the caller may create share links, and which layer decided."""

    enabled: bool
    allowed: bool
    # disabled | guest | role | user
    source: str
    # role | allow | deny
    override: str
    role_allows: bool


class StatusResponse(BaseModel):
    status: str
