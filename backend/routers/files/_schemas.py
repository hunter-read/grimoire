"""Request/response models for library file management."""
from typing import Optional

from pydantic import BaseModel, Field


class BrowseEntry(BaseModel):
    """One row in a folder listing — a folder or an indexed/unindexed file."""

    name: str
    path: str
    is_dir: bool
    size: Optional[int] = None
    # Populated for indexed files only, so the UI can show what a move carries
    # with it (and warn before moving something that is not indexed).
    record_id: Optional[str] = None
    title: Optional[str] = None
    collection: Optional[str] = None
    has_thumbnail: bool = False
    is_missing: bool = False
    # Folder-only: what the folder declares about itself on disk.
    container_kind: Optional[str] = None
    nsfw: bool = False
    # Capped at CHILD_COUNT_CAP; None when the folder could not be read.
    child_count: Optional[int] = None


class BrowseResponse(BaseModel):
    path: str
    parent: Optional[str] = None
    writable: bool
    entries: list[BrowseEntry]
    # How many entries the folder really holds, and whether `entries` is a
    # prefix of them — so the UI can say "showing 2000 of 48,213" rather than
    # quietly presenting a partial folder as complete.
    total: int = 0
    truncated: bool = False
    # {kind: path} for one-of-a-kind collections that already exist, so the UI
    # can offer only the kinds still available.
    singletons_taken: dict[str, str] = Field(default_factory=dict)


class MoveRequest(BaseModel):
    sources: list[str] = Field(..., min_length=1)
    destination: str
    # "skip" reports the collision and leaves the file; "rename" lands it under a
    # suffixed name. Never overwrites.
    on_conflict: str = Field("skip", pattern="^(skip|rename)$")


class MoveResponse(BaseModel):
    moved: list[dict]
    skipped: list[dict]
    count: int


class RenameRequest(BaseModel):
    path: str
    new_name: str = Field(..., min_length=1, max_length=255)


class RenameResponse(BaseModel):
    """Where the item ended up, and how many records followed it."""

    from_: str = Field(..., alias="from")
    to: str
    records: int

    model_config = {"populate_by_name": True}


class FolderResponse(BaseModel):
    """A folder's location and what it declares about itself on disk."""

    path: str
    name: Optional[str] = None
    container_kind: str = ""
    nsfw: bool = False
    markers: list[str] = Field(default_factory=list)


class DeletedFolderResponse(BaseModel):
    path: str


class CreateFolderRequest(BaseModel):
    parent: str
    name: str = Field(..., min_length=1, max_length=255)
    container_kind: str = ""
    nsfw: bool = False


class MarkersRequest(BaseModel):
    path: str
    container_kind: Optional[str] = None
    nsfw: Optional[bool] = None


class DeleteFolderRequest(BaseModel):
    path: str


class ScaffoldRequest(BaseModel):
    path: str


class UploadResponse(BaseModel):
    """Where an uploaded file landed. `name` may differ from what was sent when
    the conflict policy suffixed it."""

    path: str
    name: str
    size: int


class ScaffoldResponse(BaseModel):
    """Which category folders were made, and which were already there."""

    path: str
    created: list[str]
    existing: list[str]
