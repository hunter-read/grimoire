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
    """A pasted or uploaded sheet.

    Three ways to give the sheet itself, in order of preference:

    * ``document`` — already-parsed JSON, which is what the catalogue installer
      and older clients send.
    * ``text`` — the sheet as typed, parsed as JSON and then as YAML. A sheet is
      a document people hand-write, and YAML is far kinder to write by hand than
      JSON: no quoting every key, no trailing-comma errors, and comments.

    ``layout`` and ``styles`` carry a custom sheet's HTML and CSS as their own
    fields. A layout inlined into JSON has to be escaped, which turns a readable
    template into one unbroken line of ``\\"`` and ``\\n`` — the community repo
    keeps them in sibling files for exactly that reason, and pasting one should
    not be worse than installing one. Given here, they override whatever the
    document holds.
    """

    document: dict[str, Any] = Field(default_factory=dict)
    # The sheet as text, parsed as JSON then YAML. Bounded so a paste cannot
    # hand the parser something enormous.
    text: str = Field(default="", max_length=512 * 1024)
    layout: str = Field(default="", max_length=256 * 1024)
    styles: str = Field(default="", max_length=128 * 1024)
    source_id: Optional[str] = None
    source_url: Optional[str] = None
    source_version: Optional[str] = None


class CatalogueSheet(BaseModel):
    """One sheet the community catalogue offers.

    ``id`` is namespaced by its source so two catalogues offering the same
    sheet stay distinct; ``raw_id`` is what the sheet calls itself.
    """

    id: str
    raw_id: str = ""
    name: str
    version: str = ""
    system: str = ""
    description: str = ""
    author: str = ""
    author_url: str = ""
    homepage: str = ""
    license: str = ""
    license_url: str = ""
    # Rendered verbatim: several open licences mandate exact wording.
    attribution: str = ""
    custom_layout: bool = False
    field_count: int = 0
    grimoire_min_version: str = ""
    path: str = ""
    sha256: str = ""
    # A sheet may keep its layout and stylesheet in sibling files; each is
    # downloaded and digest-checked separately.
    layout_path: str = ""
    layout_sha256: str = ""
    styles_path: str = ""
    styles_sha256: str = ""
    # Which catalogue offered it, so a repo on a branch stays distinguishable.
    index_url: str = ""
    installed: bool = False


class CatalogueSourceError(BaseModel):
    """A configured source that could not be read."""

    url: str
    error: str


class SheetCatalogueResponse(BaseModel):
    sheets: list[CatalogueSheet]
    index_url: str = ""
    # Every catalogue consulted, so a listing can say where it came from.
    sources: list[str] = Field(default_factory=list)
    # Sources that failed, reported rather than silently dropped: with several
    # configured, a missing one otherwise looks like a smaller catalogue.
    errors: list[CatalogueSourceError] = Field(default_factory=list)
    downloads_enabled: bool = True


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
    # The campaign this character is played in, if any. Setting it lets the
    # party read the sheet; editing stays with the owner.
    campaign_id: Optional[str] = None
    portrait_path: Optional[str] = None
    # Changes with the image, for cache-busting the portrait's URL.
    portrait_version: Optional[int] = None
    # False when the caller is reading a party member's sheet rather than
    # their own.
    owned: bool = True
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
    campaign_id: Optional[str] = None


class CharacterUpdate(BaseModel):
    name: Optional[str] = None
    data: Optional[dict[str, Any]] = None
    # Field names to remove from the stored data. Removing a field is what hands
    # it back to its `default_from`: a value the player typed over a derived one
    # is theirs until they reset it, and this is the reset. Separate from `data`
    # because a null there already means "cleared" mid-edit, and snapping a
    # half-typed number back to its default would fight the player.
    unset: list[str] = Field(default_factory=list, max_length=100)
    # "" clears the campaign; a real id must be one the owner belongs to.
    campaign_id: Optional[str] = None


class CharacterExport(BaseModel):
    """A self-contained character file.

    Every reference is denormalised into `entries`, and the schema travels with
    it, so the file opens on an instance that has neither the pack nor the
    ruleset content it was built from.
    """

    schema_marker: str = Field(default="", alias="$schema")
    name: str = ""
    schema_id: str = ""
    character_schema: dict[str, Any] = Field(default_factory=dict, alias="schema")
    data: dict[str, Any] = Field(default_factory=dict)
    entries: dict[str, Any] = Field(default_factory=dict)

    model_config = {"populate_by_name": True}


class CharacterImport(BaseModel):
    payload: dict[str, Any]
    # Recreate entries the receiving instance lacks as the importer's own
    # ruleset, so the sheet reads correctly rather than showing gaps.
    import_entries: bool = True


class PortraitResponse(BaseModel):
    portrait_path: str
    portrait_version: Optional[int] = None


class CharacterDeletedResponse(BaseModel):
    deleted: bool = True
    id: str
