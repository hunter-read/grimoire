"""Pydantic schemas for the public share routes."""
from typing import Optional

from pydantic import BaseModel, Field


class ShareUnlock(BaseModel):
    password: str = Field(..., max_length=200)


class ShareUnlockResponse(BaseModel):
    unlocked: bool


class ShareMetaResponse(BaseModel):
    """`GET /api/share/{token}/meta`. Only the first two fields are present until
    a password-protected link is unlocked."""

    password_required: bool
    unlocked: bool
    resource_type: Optional[str] = None
    name: Optional[str] = None
    label: Optional[str] = None
    filename: Optional[str] = None
    media_type: Optional[str] = None
    # image | audio | video | pdf | model | file - how the share page presents it.
    media_kind: Optional[str] = None
    file_size: Optional[int] = None
    file_url: Optional[str] = None
    download_url: Optional[str] = None
    expires_at: Optional[str] = None
