"""Request and response models for the content catalog."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class PackSummary(BaseModel):
    """An installed content pack, with the credit it must be shown under."""

    pack_id: str
    schema_id: str
    name: str
    version: str = ""
    description: str = ""
    license: str = ""
    license_url: str = ""
    # Rendered verbatim wherever this pack's content is surfaced. Several open
    # licences mandate exact wording.
    attribution: str = ""
    source_url: str = ""
    entry_count: int = 0


class PackListResponse(BaseModel):
    packs: list[PackSummary]


class CatalogEntry(BaseModel):
    """One catalog entry as the browser lists it."""

    entry_id: str
    source: str
    name: str
    content_type: str
    data: dict[str, Any] = Field(default_factory=dict)
    # Rendered from the content type's `compact_display` template, when it has
    # one, so a list row reads the way the schema author intended.
    display: str = ""
    # True when this row is a user's homebrew rather than pack content.
    homebrew: bool = False
    owner_name: str = ""
    # The homebrew row's own id, for editing it from the browser.
    row_id: Optional[str] = None


class FilterOption(BaseModel):
    value: Any
    count: int


class CatalogResponse(BaseModel):
    entries: list[CatalogEntry]
    total: int
    page: int
    page_size: int
    # Facets built from the content type's `filter_fields`, each with the values
    # actually present and how many entries carry them.
    filters_available: dict[str, list[FilterOption]] = Field(default_factory=dict)


class ContentTypeSummary(BaseModel):
    """A content type a schema declares, for building the browser's chrome."""

    name: str
    label: str = ""
    label_plural: str = ""
    icon: str = ""
    identity_field: str = "name"
    sort_default: list[str] = Field(default_factory=list)
    search_fields: list[str] = Field(default_factory=list)
    filter_fields: list[str] = Field(default_factory=list)
    compact_display: str = ""
    fields: dict[str, Any] = Field(default_factory=dict)
    entry_count: int = 0


class ContentTypeListResponse(BaseModel):
    content_types: list[ContentTypeSummary]


class ResolvedEntry(BaseModel):
    """An entry resolved from a character's reference.

    ``missing`` is true when the reference points at something no installed pack
    provides — the pack was removed, or the character came from another server.
    The sheet still renders; it shows what the character stored.
    """

    entry_id: str
    source: Optional[str] = None
    name: str = ""
    content_type: str = ""
    data: dict[str, Any] = Field(default_factory=dict)
    missing: bool = False


class ResolveResponse(BaseModel):
    entries: dict[str, ResolvedEntry]
