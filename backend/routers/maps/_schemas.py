"""Pydantic schemas for the maps API."""
from typing import Optional
from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._variant_schemas import VariantCountMixin, VariantFamilyMixin


class MapUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    map_type: Optional[str] = None
    grid_size: Optional[str] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v


# Batch form of MapUpdate: {"items": [{"id": ..., ...MapUpdate fields}]}.
MapBulkUpdate = bulk_update_model(MapUpdate, "Map")


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class MapOut(VariantCountMixin):
    """One map, as returned by the list endpoint.

    `description`/`map_type`/`file_size`/`has_thumbnail` are declared
    `default=...` on `GenericMap` rather than NOT NULL, so NULL is still
    representable (the default applies at insert only, and rows predating a
    column migration keep NULL) — hence Optional. `is_missing`/`is_archive` are
    coalesced with `bool(...)` by the handler and stay required.
    """

    id: str
    filename: str
    relative_path: str
    description: Optional[str] = None
    tags: list[str]
    map_type: Optional[str] = None
    file_size: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_missing: bool
    is_archive: bool


class MapListResponse(BaseModel):
    total: int
    maps: list[MapOut]


class MapGrid(BaseModel):
    """Detected grid dimensions for a map (see `_helpers._map_image_info`).

    `cell_px` is only present on the DPI/computed branches — the filename branch
    omits it, and PDF maps have it stripped — so it is Optional.
    """

    width: int
    height: int
    cell_px: Optional[int] = None
    source: str


class MapDetailResponse(VariantFamilyMixin):
    """`GET /maps/{id}` — map metadata, folder context, and image info.

    Everything from `_map_image_info` is nullable by construction: the dict is
    seeded with `None`s and only filled in when the file could be measured
    (archives, unreadable files, and PDFs all leave some or all of it None).
    """

    id: str
    filename: str
    relative_path: str
    folder_path: str
    folder_tags: list[str]
    description: Optional[str] = None
    tags: list[str]
    map_type: Optional[str] = None
    grid_size: Optional[str] = None
    file_size: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_missing: bool
    is_archive: bool
    pixel_width: Optional[int] = None
    pixel_height: Optional[int] = None
    dpi: Optional[int] = None
    grid: Optional[MapGrid] = None
    is_pdf: bool
    page_count: Optional[int] = None


class FolderTagsOut(BaseModel):
    """One folder path and its tags.

    Note the list/update endpoints differ: `GET /map-folders` returns display
    tags, while the PATCH/bulk writes echo back the stored internal keys.
    """

    path: str
    tags: list[str]


class MapFoldersResponse(BaseModel):
    folders: list[FolderTagsOut]


class StatusResponse(BaseModel):
    status: str
