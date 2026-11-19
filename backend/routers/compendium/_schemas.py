"""Request and response models for a system's compendium."""
from typing import Any, Optional

from pydantic import BaseModel, Field


class CompendiumPack(BaseModel):
    """A content pack linked to the system, with the credit it is shown under."""

    pack_id: str
    name: str
    schema_id: str = ""
    version: str = ""
    description: str = ""
    license: str = ""
    license_url: str = ""
    # Rendered verbatim wherever the pack's content is shown. Several open
    # licences mandate exact wording.
    attribution: str = ""
    source_url: str = ""
    entry_count: int = 0
    # False for a link whose pack has since been uninstalled. The link stays,
    # so reinstalling brings the content back.
    installed: bool = True


class CompendiumSheet(BaseModel):
    """A character sheet linked to the system."""

    schema_id: str
    name: str
    system: str = ""
    # Whether the caller can start a character on it: they have their own
    # copy, or an admin installed it for everyone.
    available: bool = False
    # An admin installed it for every account.
    server_wide: bool = False


class CompendiumType(BaseModel):
    """A content type with entries in the compendium, and how it lists."""

    name: str
    label: str = ""
    label_plural: str = ""
    icon: str = ""
    identity_field: str = "name"
    sort_default: list[str] = Field(default_factory=list)
    search_fields: list[str] = Field(default_factory=list)
    filter_fields: list[str] = Field(default_factory=list)
    filter_depends: dict[str, str] = Field(default_factory=dict)
    compact_display: str = ""
    fields: dict[str, Any] = Field(default_factory=dict)
    entry_count: int = 0


class CompendiumSummary(BaseModel):
    system_id: str
    packs: list[CompendiumPack] = Field(default_factory=list)
    sheets: list[CompendiumSheet] = Field(default_factory=list)
    content_types: list[CompendiumType] = Field(default_factory=list)
    # Whether the caller may change the links (a GM or an admin).
    can_edit: bool = False


class CompendiumLinks(BaseModel):
    """The packs and sheets to link. A list left out is left as it is."""

    pack_ids: Optional[list[str]] = None
    sheet_ids: Optional[list[str]] = None


class CompendiumSystemRef(BaseModel):
    id: str
    name: str


class CompendiumEntry(BaseModel):
    """One compendium entry, from a pack or a ruleset."""

    entry_id: str
    source: str
    name: str
    content_type: str
    data: dict[str, Any] = Field(default_factory=dict)
    # Rendered from the type's `compact_display` template.
    display: str = ""
    ruleset: bool = False
    owner_name: str = ""
    row_id: Optional[str] = None
    ruleset_id: Optional[str] = None
    ruleset_name: str = ""
    # The sheet whose content types describe it, and where it came from: a
    # pack id, or `ruleset:<id>`. Passed back as `origin` to fetch it again.
    schema_id: str = ""
    origin: str = ""


class CompendiumEntryDetail(CompendiumEntry):
    """An entry with the definition it renders by."""

    type_definition: CompendiumType


class CompendiumSearchResult(CompendiumEntry):
    """A search hit, with its type's label and the systems it appears in."""

    type_label: str = ""
    systems: list[CompendiumSystemRef] = Field(default_factory=list)


class CompendiumSearchResponse(BaseModel):
    results: list[CompendiumSearchResult] = Field(default_factory=list)


class FilterOption(BaseModel):
    value: Any
    count: int


class CompendiumBrowseResponse(BaseModel):
    content_type: CompendiumType
    entries: list[CompendiumEntry]
    total: int
    page: int
    page_size: int
    filters_available: dict[str, list[FilterOption]] = Field(default_factory=dict)
    filters_without_parent: dict[str, bool] = Field(default_factory=dict)
