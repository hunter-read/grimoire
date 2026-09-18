"""Request and response models for the character endpoints."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class SchemaSummary(BaseModel):
    """One installed schema, without its document — enough to list and pick."""

    id: str
    schema_id: str
    name: str
    system: str = ""
    description: str = ""
    version: str = ""
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None
    is_community: bool = False
    character_count: int = 0


class SchemaDetail(SchemaSummary):
    """A schema with its validated document, for rendering a sheet."""

    document: dict[str, Any] = Field(default_factory=dict)


class SchemaListResponse(BaseModel):
    schemas: list[SchemaSummary]


class SchemaImport(BaseModel):
    """A pasted or uploaded schema document."""

    document: dict[str, Any]
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None


class SchemaDeletedResponse(BaseModel):
    deleted: bool = True
    schema_id: str


class CharacterSummary(BaseModel):
    """One character, without its data — enough for the list view."""

    id: str
    name: str
    schema_ref: str
    schema_name: str = ""
    system: str = ""
    # False when the schema this character was built on is not installed. The
    # character still opens; it renders read-only from stored data.
    schema_missing: bool = False
    created_at: Optional[str] = None
    updated_at: Optional[str] = None


class ValidatorResult(BaseModel):
    """One schema validator that fired against a character."""

    rule: str
    message: str = ""
    severity: str = "warning"
    # The field to attach the message to, when the schema names one. Null means
    # it belongs to the sheet as a whole.
    field: Optional[str] = None


class CharacterDetail(CharacterSummary):
    """A character with its values, derived values, and any validator results."""

    data: dict[str, Any] = Field(default_factory=dict)
    computed: dict[str, Any] = Field(default_factory=dict)
    validators: list[ValidatorResult] = Field(default_factory=list)
    # Catalog entries this character's references point at, keyed by entry id,
    # so rendering the sheet costs no extra request.
    entries: dict[str, Any] = Field(default_factory=dict)


class CharacterListResponse(BaseModel):
    characters: list[CharacterSummary]


class CharacterCreate(BaseModel):
    schema_ref: str
    name: str = ""
    data: dict[str, Any] = Field(default_factory=dict)


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[dict[str, Any]] = None


class CharacterDeletedResponse(BaseModel):
    deleted: bool = True
    id: str
