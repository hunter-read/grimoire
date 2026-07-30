"""Pydantic schemas for the saved-filters API."""
from typing import Any, Optional

from pydantic import BaseModel, field_validator

# Browsable content areas a saved filter can belong to.
VALID_SCOPES = {"systems", "books", "maps", "tokens", "audio"}


class SavedFilterCreate(BaseModel):
    scope: str
    name: str
    state: dict[str, Any] = {}
    is_default: bool = False

    @field_validator("scope")
    @classmethod
    def valid_scope(cls, v: str) -> str:
        if v not in VALID_SCOPES:
            raise ValueError(f"scope must be one of: {', '.join(sorted(VALID_SCOPES))}")
        return v

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class SavedFilterUpdate(BaseModel):
    name: Optional[str] = None
    state: Optional[dict[str, Any]] = None
    is_default: Optional[bool] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: Optional[str]) -> Optional[str]:
        if v is None:
            return v
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v
