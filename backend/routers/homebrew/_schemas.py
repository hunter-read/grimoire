"""Request and response models for homebrew entries."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class HomebrewSummary(BaseModel):
    """One homebrew entry as the manager lists it."""

    id: str
    schema_id: str
    content_type: str
    entry_id: str
    name: str
    visibility: str = "private"
    campaign_id: Optional[str] = None
    forked_from: Optional[str] = None
    # False when the caller is not the owner — a shared entry is readable but
    # never editable.
    owned: bool = True
    owner_name: str = ""
    # How many of the caller's own characters reference this entry, so a delete
    # can say what it would break.
    used_by: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class HomebrewDetail(HomebrewSummary):
    data: dict[str, Any] = Field(default_factory=dict)


class HomebrewListResponse(BaseModel):
    entries: list[HomebrewSummary]


class HomebrewCreate(BaseModel):
    schema_id: str
    content_type: str
    data: dict[str, Any] = Field(default_factory=dict)
    entry_id: str = ""
    visibility: str = "private"
    campaign_id: Optional[str] = None
    forked_from: Optional[str] = None


class HomebrewUpdate(BaseModel):
    data: Optional[dict[str, Any]] = None


class HomebrewShare(BaseModel):
    visibility: str
    campaign_id: Optional[str] = None


class HomebrewForkRequest(BaseModel):
    """Fork a catalog entry into the caller's own homebrew."""

    schema_id: str
    content_type: str
    entry_id: str
    source: str = ""


class HomebrewDeletedResponse(BaseModel):
    deleted: bool = True
    id: str


class HomebrewPack(BaseModel):
    """A portable bundle of one user's homebrew for one system.

    `entries` is keyed by content type, each holding entries in the same shape
    a filesystem pack uses — so a homebrew pack and an SRD pack are the same
    kind of document, and one can become the other.
    """

    # `$schema` identifies the format, so it has to survive serialisation; it
    # is aliased because it is not a valid Python identifier.
    schema_marker: str = Field(default="", alias="$schema")
    pack_name: str = ""
    schema_id: str = ""
    author: str = ""
    version: str = "1.0.0"
    entries: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class HomebrewImportRequest(BaseModel):
    pack: dict[str, Any]
    conflict: str = "skip"


class HomebrewImportResponse(BaseModel):
    imported: int = 0
    skipped: int = 0
    renamed: int = 0
    overwritten: int = 0
    failed: list[dict[str, Any]] = Field(default_factory=list)
