"""Pydantic schemas for the maps API."""
from typing import Optional
from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model


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
