"""Request/response models for filename rules."""
from typing import Any, Literal, Optional

from pydantic import BaseModel, Field


class FolderRuleOut(BaseModel):
    path: str
    pattern: str
    # False when the folder is gone from disk (renamed outside Grimoire, say):
    # the rule is kept, since the folder may come back, but flagged.
    exists: bool
    # Whether the pattern can write filenames as well as read them - false when
    # it holds a {*} wildcard.
    renderable: bool
    # Set when the stored pattern no longer parses; the scanner skips it.
    error: Optional[str] = None


class FolderRulesResponse(BaseModel):
    rules: list[FolderRuleOut]
    # Every placeholder a pattern may use, and the subset reading a filename
    # can set on a book.
    fields: list[str]
    read_fields: list[str]


class FolderRuleIn(BaseModel):
    path: str = Field(..., max_length=1000)
    pattern: str = Field(..., max_length=500)


class PreviewRequest(BaseModel):
    path: str = Field(..., max_length=1000)
    # Preview this instead of the saved pattern - what the editor sends while
    # the admin is still typing.
    pattern: Optional[str] = Field(None, max_length=500)


class PreviewRow(BaseModel):
    id: str
    filename: str
    relative_path: Optional[str] = None
    title: Optional[str] = None
    # The fields the pattern reads from the filename; null when it does not fit.
    read: Optional[dict[str, Any]] = None
    title_status: Literal["change", "same", "no_match"]
    proposed: Optional[str] = None
    rename_status: Literal["ok", "same", "missing", "too_long", "conflict", "unavailable"]
    missing: list[str] = []
    path_length: int = 0
    long_path: bool = False
    # False when the proposed name would not read back to the book's title -
    # usually a title holding the pattern's own separator.
    reads_back: bool = True


class PreviewResponse(BaseModel):
    path: str
    pattern: str
    renderable: bool
    writable: bool
    total: int
    truncated: bool
    rows: list[PreviewRow]


class ApplyRequest(BaseModel):
    path: str = Field(..., max_length=1000)
    ids: list[str] = Field(..., max_length=1000)


class SkippedItem(BaseModel):
    id: str
    reason: str
    detail: Optional[str] = None


class ApplyTitlesResponse(BaseModel):
    updated: list[str]
    skipped: list[SkippedItem]


class RenamedItem(BaseModel):
    id: str
    from_: str = Field(..., alias="from")
    to: str

    model_config = {"populate_by_name": True}


class NamingRenameResponse(BaseModel):
    renamed: list[RenamedItem]
    skipped: list[SkippedItem]


class VariantRule(BaseModel):
    match: Literal["token", "prefix", "suffix"]
    value: str = Field(..., max_length=100)
    kind: Optional[str] = None
    label: str = ""
    # A collection's singular name ("map"), or null for every collection.
    collection: Optional[str] = None


class VariantRulesResponse(BaseModel):
    rules: list[VariantRule]


class VariantRulesIn(BaseModel):
    rules: list[VariantRule]


class NamingStatusResponse(BaseModel):
    status: str
