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
    # Required only when the folder still holds content: the API refuses the
    # delete with `confirm_required` until this matches the folder's own name.
    confirm_name: Optional[str] = None


class DeleteRequest(BaseModel):
    """A file or folder to remove, with the typed-name guard for full folders."""

    path: str
    confirm_name: Optional[str] = None
    # False (the default) is the *soft* delete: the indexed rows go, the files
    # stay, and a rescan brings back anything still present and not excluded.
    # The safer of the two is the default deliberately: the destructive one is
    # opted into, never fallen into by omitting a field.
    delete_files: bool = False


class DeleteResponse(BaseModel):
    """What the delete actually removed, for the confirmation message."""

    path: str
    records: int = 0
    files: int = 0
    # Whether files were unlinked, so the UI can word its confirmation for what
    # happened rather than for what was asked. A soft delete reports False and
    # `files: 0` even though it removed rows.
    files_deleted: bool = True


class FolderContentsResponse(BaseModel):
    """Whether a folder holds anything, so the UI knows which guard to show."""

    path: str
    has_content: bool
    name: str


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
