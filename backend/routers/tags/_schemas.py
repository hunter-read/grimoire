"""Pydantic schemas for the tags API (issue #235)."""
from typing import Optional

from pydantic import BaseModel


class TagDisplayUpdate(BaseModel):
    """Rename a tag's human-facing display value (internal key is immutable)."""

    display: str


class TagMerge(BaseModel):
    """Merge this tag into another, re-pointing all its resource links."""

    into: str  # target tag's internal key (or any casing of it)


class TagCreate(BaseModel):
    """Create a tag up-front (optional; tags are also created on first use)."""

    value: str
    display: Optional[str] = None
