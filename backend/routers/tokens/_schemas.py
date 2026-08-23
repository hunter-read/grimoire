"""Pydantic schemas for the tokens API."""
from typing import Optional
from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._variant_schemas import VariantCountMixin, VariantFamilyMixin


class TokenUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    is_explicit: Optional[bool] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v


# Batch form of TokenUpdate: {"items": [{"id": ..., ...TokenUpdate fields}]}.
TokenBulkUpdate = bulk_update_model(TokenUpdate, "Token")


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class TokenOut(VariantCountMixin):
    """One token, as returned by the list endpoint.

    `description`/`file_size`/`has_thumbnail` are declared `default=...` on
    `Token` rather than NOT NULL, so NULL is still representable (the default
    applies at insert only, and rows predating a column migration keep NULL) —
    hence Optional. `is_explicit`/`is_missing`/`is_archive` are coalesced with
    `bool(...)` by the handler and stay required.
    """

    id: str
    filename: str
    relative_path: str
    description: Optional[str] = None
    tags: list[str]
    file_size: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_explicit: bool
    is_missing: bool
    is_archive: bool


class TokenListResponse(BaseModel):
    total: int
    tokens: list[TokenOut]


class TokenDetailResponse(TokenOut, VariantFamilyMixin):
    """`GET /tokens/{id}` — token metadata, folder context, and image size.

    `pixel_width`/`pixel_height` are None for archives and for any image PIL
    cannot open.
    """

    folder_path: str
    folder_tags: list[str]
    pixel_width: Optional[int] = None
    pixel_height: Optional[int] = None


class FolderTagsOut(BaseModel):
    """One folder path and its tags.

    Note the list/update endpoints differ: `GET /token-folders` returns display
    tags, while the PATCH/bulk writes echo back the stored internal keys.
    """

    path: str
    tags: list[str]


class TokenFoldersResponse(BaseModel):
    folders: list[FolderTagsOut]


class StatusResponse(BaseModel):
    status: str
