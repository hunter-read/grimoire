"""Pydantic schemas for the maintenance API."""
from pydantic import BaseModel, Field


class CleanupCounts(BaseModel):
    """Per-collection counts of DB rows removed for missing files."""

    books: int
    maps: int
    tokens: int
    audio: int
    systems: int


class CleanupResponse(BaseModel):
    removed: CleanupCounts


class SidecarSettings(BaseModel):
    """Metadata sidecar export configuration (issue #300)."""

    formats: list[str] = Field(
        default_factory=list,
        description="Enabled sidecar formats: opf, nfo, json. Empty disables export.",
    )
    covers: bool = Field(
        default=False, description="Write the cover image next to the metadata file."
    )
    overwrite_foreign: bool = Field(
        default=False,
        description="Allow a backfill to replace sidecars Grimoire did not write.",
    )


class SidecarExportResponse(BaseModel):
    """Outcome of a sidecar backfill run."""

    written: int
    skipped_foreign: int
    skipped_missing: int
    failed: int
    covers: int
    read_only: bool
    errors: list[str]
