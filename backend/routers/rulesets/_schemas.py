"""Request and response models for rulesets."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class RulesetSummary(BaseModel):
    """One ruleset as the manager lists it."""

    id: str
    schema_id: str
    name: str
    description: str = ""
    version: str = ""
    license: str = ""
    license_url: str = ""
    # Rendered verbatim: several open licences mandate exact wording.
    attribution: str = ""
    source_pack_id: Optional[str] = None
    # Null for a server ruleset, which every game can use.
    campaign_id: Optional[str] = None
    campaign_name: str = ""
    # Whether the caller may change this ruleset, as opposed to only read it.
    editable: bool = False
    entry_count: int = 0
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class RulesetListResponse(BaseModel):
    rulesets: list[RulesetSummary]


class RulesetCreate(BaseModel):
    schema_id: str
    name: str
    description: str = ""
    # Null asks for a server ruleset, which needs an admin.
    campaign_id: Optional[str] = None
    license: str = ""
    license_url: str = ""
    attribution: str = ""


class RulesetUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    license: Optional[str] = None
    license_url: Optional[str] = None
    attribution: Optional[str] = None


class RulesetEntrySummary(BaseModel):
    id: str
    ruleset_id: str
    content_type: str
    entry_id: str
    name: str
    forked_from: Optional[str] = None
    editable: bool = False


class RulesetEntryDetail(RulesetEntrySummary):
    data: dict[str, Any] = Field(default_factory=dict)


class RulesetEntryListResponse(BaseModel):
    entries: list[RulesetEntrySummary]


class EntryCreate(BaseModel):
    content_type: str
    data: dict[str, Any] = Field(default_factory=dict)
    entry_id: str = ""
    forked_from: Optional[str] = None


class EntryUpdate(BaseModel):
    data: Optional[dict[str, Any]] = None


class ForkRequest(BaseModel):
    """Copy a catalogue entry into a ruleset you can edit."""

    content_type: str
    entry_id: str
    source: str = ""


class DeletedResponse(BaseModel):
    deleted: bool = True
    id: str


class ImportRequest(BaseModel):
    """Add entries to a ruleset, from a pack document or an installed pack."""

    # One of the two: a document to read entries from, or the id of a
    # filesystem content pack to copy.
    document: Optional[dict[str, Any]] = None
    pack_id: str = ""
    conflict: str = "skip"


class ImportResponse(BaseModel):
    imported: int = 0
    skipped: int = 0
    renamed: int = 0
    overwritten: int = 0
    failed: list[dict[str, Any]] = Field(default_factory=list)


class RulesetExport(BaseModel):
    schema_marker: str = Field(default="", alias="$schema")
    name: str = ""
    schema_id: str = ""
    version: str = "1.0.0"
    description: str = ""
    license: str = ""
    license_url: str = ""
    attribution: str = ""
    entries: dict[str, list[dict[str, Any]]] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class InstallablePack(BaseModel):
    """A filesystem content pack that can be copied into a ruleset."""

    pack_id: str
    schema_id: str
    name: str
    description: str = ""
    version: str = ""
    license: str = ""
    license_url: str = ""
    attribution: str = ""
    entry_count: int = 0


class InstallablePackListResponse(BaseModel):
    packs: list[InstallablePack]
