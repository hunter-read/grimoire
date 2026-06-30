"""Pydantic schemas for the audio API."""
from typing import Optional
from pydantic import BaseModel, field_validator


def _normalize_tags(tags: list[str]) -> list[str]:
    seen = set()
    result = []
    for t in tags:
        lowered = t.strip().lower()
        if lowered and lowered not in seen:
            seen.add(lowered)
            result.append(lowered)
    return result


class AudioUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None

    @field_validator("tags", mode="before")
    @classmethod
    def lowercase_tags(cls, v):
        return _normalize_tags(v) if v is not None else v


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def lowercase_tags(cls, v):
        return _normalize_tags(v)
