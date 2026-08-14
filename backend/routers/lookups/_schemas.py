"""Pydantic schemas for the genre / system-family lookup API (issue #202)."""
from typing import Optional

from pydantic import BaseModel, field_validator


class GenreCreate(BaseModel):
    name: str
    parent_id: Optional[str] = None

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class SystemFamilyCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class ParentSystemCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class LicenseCreate(BaseModel):
    name: str

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


class DiceMaterialCreate(BaseModel):
    name: str
    group: Optional[str] = "Custom"

    @field_validator("name")
    @classmethod
    def name_not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("name must not be blank")
        return v


# --- Response models ---------------------------------------------------------
# `name` is NOT NULL on every lookup model, and the serializers in `_helpers`
# coalesce `is_default`/`sort_order`/`group`, so those stay required here.


class GenreOut(BaseModel):
    """One genre, as built by `_helpers.serialize_genre`."""

    id: str
    name: str
    # Null for a top-level genre (the column is explicitly nullable).
    parent_id: Optional[str] = None
    is_default: bool
    sort_order: int


class GenresResponse(BaseModel):
    genres: list[GenreOut]


class LookupOut(BaseModel):
    """A flat lookup value — system family, parent system, or license."""

    id: str
    name: str
    is_default: bool
    sort_order: int


class SystemFamiliesResponse(BaseModel):
    families: list[LookupOut]


class ParentSystemsResponse(BaseModel):
    parent_systems: list[LookupOut]


class LicensesResponse(BaseModel):
    licenses: list[LookupOut]


class DiceMaterialOut(LookupOut):
    """Dice/materials add a picker grouping label, coalesced to "Custom"."""

    group: str


class DiceMaterialsResponse(BaseModel):
    dice_materials: list[DiceMaterialOut]


class LookupDeleteResponse(BaseModel):
    status: str
    # How many systems/books still referenced the value when it was force-deleted.
    removed_usage: int
