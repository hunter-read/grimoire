"""Pydantic schemas for the maps API."""
from typing import Optional
from pydantic import BaseModel, field_validator


def _dedupe_tags(tags: list[str]) -> list[str]:
    """Strip and de-duplicate tags by lowercased key, keeping first-seen casing.

    Item tags are shared tags (issue #235): the service lowercases the internal
    match key while preserving this display casing, so we must NOT lowercase here.
    """
    seen: set = set()
    result = []
    for t in tags:
        stripped = t.strip()
        key = stripped.lower()
        if key and key not in seen:
            seen.add(key)
            result.append(stripped)
    return result


class MapUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    map_type: Optional[str] = None
    grid_size: Optional[str] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return _dedupe_tags(v) if v is not None else v


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return _dedupe_tags(v)
