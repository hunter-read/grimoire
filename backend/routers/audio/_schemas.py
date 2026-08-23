"""Pydantic schemas for the audio API."""
from typing import Optional
from pydantic import BaseModel, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._variant_schemas import VariantCountMixin, VariantFamilyMixin


class AudioUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v


# Batch form of AudioUpdate: {"items": [{"id": ..., ...AudioUpdate fields}]}.
AudioBulkUpdate = bulk_update_model(AudioUpdate, "Audio")


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class AudioOut(VariantCountMixin):
    """One audio track, as built by `core._serialize`.

    Columns declared `default=...` rather than `nullable=False` can still hold
    NULL (the default only applies at insert, and rows predating a column
    migration keep NULL), so those are Optional. `duration`/`title`/`artist`/
    `album`/`has_artwork`/`is_missing` are coalesced by the serializer
    (`a.duration or 0.0`, `bool(...)`) and so stay required.
    """

    id: str
    filename: str
    relative_path: str
    # `description` is `default=""`, not NOT NULL — legacy rows can be NULL.
    description: Optional[str] = None
    tags: list[str]
    duration: float
    title: str
    artist: str
    album: str
    has_artwork: bool
    # True only when a cover was set through the UI (issue #286).
    has_cover: bool = False
    # `file_size` is `default=0`, not NOT NULL.
    file_size: Optional[int] = None
    is_missing: bool
    is_archive: bool


class AudioListResponse(BaseModel):
    total: int
    audio: list[AudioOut]


class AudioDetailResponse(AudioOut, VariantFamilyMixin):
    """`GET /audio/{id}` — the serialized track plus its folder context."""

    folder_path: str
    folder_tags: list[str]


class FolderTagsOut(BaseModel):
    """One folder path and its tags.

    Note the list/update endpoints differ: `GET /audio-folders` returns display
    tags, while the PATCH/bulk writes echo back the stored internal keys.
    """

    path: str
    tags: list[str]


class AudioFoldersResponse(BaseModel):
    folders: list[FolderTagsOut]


class StatusResponse(BaseModel):
    status: str


class AudioCoverResponse(BaseModel):
    cover_image: str


class AudioCoverSourceIn(BaseModel):
    """Set a track's cover from an image Grimoire already holds (issue #286).

    `source_type` is one of `services.image_source.SOURCE_TYPES`; the
    campaign-scoped `campaign_file` kind is not reachable here, since a track
    has no campaign context to resolve it against.
    """

    source_type: str
    source_id: str

    @field_validator("source_type")
    @classmethod
    def known_source(cls, v: str) -> str:
        from ...services.image_source import SOURCE_TYPES

        allowed = tuple(t for t in SOURCE_TYPES if t != "campaign_file")
        if v not in allowed:
            raise ValueError(f"source_type must be one of {', '.join(allowed)}")
        return v
