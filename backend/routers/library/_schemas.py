"""Request/response schemas for the library router."""
from typing import Literal, Optional

from pydantic import BaseModel


class RescanRequest(BaseModel):
    """Body for POST /rescan.

    scope restricts the rescan to a subtree relative to the library root, e.g.
    "books/D&D 5e/adventure" or "maps/Forests".  Omitted = whole library.
    metadata_mode controls sidecar metadata re-application on already-indexed books.
    """

    scope: Optional[str] = None
    metadata_mode: Literal["new", "missing", "replace"] = "new"


class ScanStatusResponse(BaseModel):
    """Live scan state, mirroring `_helpers._DEFAULT_STATUS`.

    The counters are Optional because the payload can come back from Valkey,
    where a status blob written by an older build may predate a counter that was
    added since; a strict model would raise on those. `phase` and `ocr_current`
    are None whenever no scan is in flight, which is the common case.
    """

    running: bool
    # "scanning" | "indexing" | "ocr", or None between runs.
    phase: Optional[str] = None
    total_books: Optional[int] = None
    scanned_books: Optional[int] = None
    total_maps: Optional[int] = None
    scanned_maps: Optional[int] = None
    total_tokens: Optional[int] = None
    scanned_tokens: Optional[int] = None
    total_audio: Optional[int] = None
    scanned_audio: Optional[int] = None
    new_books: Optional[int] = None
    new_maps: Optional[int] = None
    new_tokens: Optional[int] = None
    new_audio: Optional[int] = None
    updated_books: Optional[int] = None
    indexed: Optional[int] = None
    to_index: Optional[int] = None
    # Deferred-OCR queue progress (phase "ocr").
    total_ocr: Optional[int] = None
    ocr_done: Optional[int] = None
    # Filename currently being OCR'd; None unless a book is in flight.
    ocr_current: Optional[str] = None


class StatusResponse(BaseModel):
    """`{"status": ...}` — the rescan/cancel acknowledgements."""

    status: str


class StatsResponse(BaseModel):
    """Library counts for the dashboard and external integrations."""

    game_systems: int
    books: int
    maps: int
    tokens: int
    audio: int
    indexed_books: int
    total_pages: int
    total_size_mb: float


class AboutResponse(BaseModel):
    version: str
    # Unset in local/source builds where no commit hash was baked in.
    commit_hash: Optional[str] = None
    python_version: str


class LatestReleaseResponse(BaseModel):
    """None when version checking is disabled or the GitHub proxy call failed."""

    latest_version: Optional[str] = None
