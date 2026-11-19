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
    """Live scan state, mirroring `services.library_scan.runner.DEFAULT_STATUS`.

    The counters are Optional because the payload can come back from Valkey,
    where a status blob written by an older build may predate a counter that was
    added since; a strict model would raise on those. `phase` and `ocr_current`
    are None whenever no scan is in flight, which is the common case.
    """

    running: bool
    # "scanning" | "reconciling" | "pruning" | "indexing" | "ocr" | "thumbnails",
    # or None between runs.
    phase: Optional[str] = None
    total_books: Optional[int] = None
    scanned_books: Optional[int] = None
    total_maps: Optional[int] = None
    scanned_maps: Optional[int] = None
    total_tokens: Optional[int] = None
    scanned_tokens: Optional[int] = None
    total_audio: Optional[int] = None
    scanned_audio: Optional[int] = None
    total_models: Optional[int] = None
    scanned_models: Optional[int] = None
    new_books: Optional[int] = None
    new_maps: Optional[int] = None
    new_tokens: Optional[int] = None
    new_audio: Optional[int] = None
    new_models: Optional[int] = None
    updated_books: Optional[int] = None
    indexed: Optional[int] = None
    to_index: Optional[int] = None
    # Progress of the steps after the walk (phases "reconciling" and "pruning"):
    # records checked for a missing file, or systems whose folder is gone.
    step_done: Optional[int] = None
    step_total: Optional[int] = None
    # Deferred-OCR queue progress (phase "ocr").
    total_ocr: Optional[int] = None
    ocr_done: Optional[int] = None
    # Deferred model-thumbnail queue (phase "thumbnails").
    total_thumbs: Optional[int] = None
    thumbs_done: Optional[int] = None
    thumbs_current: Optional[str] = None
    # Filename currently being OCR'd; None unless a book is in flight.
    ocr_current: Optional[str] = None
    # "reindex" while the running job is the queue re-indexing replaced books
    # (issue #657); replace uploads are accepted during it. None for any other job.
    kind: Optional[str] = None
    # Last time the running scan showed signs of life (ISO 8601, UTC). Stops
    # advancing when the process behind the scan dies (issue #524).
    heartbeat: Optional[str] = None


class StatusResponse(BaseModel):
    """`{"status": ...}` — the rescan/cancel acknowledgements."""

    status: str


class StatsResponse(BaseModel):
    """Library counts for the dashboard and external integrations."""

    # Every system; ``ttrpg_systems`` + ``wargame_systems``.
    game_systems: int
    ttrpg_systems: int = 0
    wargame_systems: int = 0
    # Every book; ``ttrpg_books`` + ``wargame_books``.
    books: int
    ttrpg_books: int = 0
    wargame_books: int = 0
    # Wargame books (the armory/ folder) under their older name; always equal to
    # ``wargame_books``, and counted in ``books`` too.
    armory_books: int = 0
    # The item counts leave out variants (a printer-friendly cut, a gridless
    # map); the *_variants fields count them, so items + variants = files.
    maps: int
    tokens: int
    audio: int
    models: int
    book_variants: int = 0
    map_variants: int = 0
    token_variants: int = 0
    model_variants: int = 0
    audio_variants: int = 0
    indexed_books: int
    # Every book's pages; ``ttrpg_pages`` + ``wargame_pages``.
    total_pages: int
    ttrpg_pages: int = 0
    wargame_pages: int = 0
    # Books only; ``ttrpg_size_mb`` + ``wargame_size_mb``.
    total_size_mb: float
    ttrpg_size_mb: float = 0
    wargame_size_mb: float = 0
    maps_size_mb: float = 0
    tokens_size_mb: float = 0
    models_size_mb: float = 0
    audio_size_mb: float = 0
    # Books plus maps, tokens, audio and 3D models.
    library_size_mb: float


class AboutResponse(BaseModel):
    version: str
    # Unset in local/source builds where no commit hash was baked in.
    commit_hash: Optional[str] = None
    python_version: str


class ChangelogSection(BaseModel):
    """One category of entries within a release (``Added``, ``Fixed``, …)."""

    # Empty for bullets that appeared with no category heading above them; the
    # client renders such a group without a header rather than inventing one.
    title: str
    entries: list[str]


class ChangelogRelease(BaseModel):
    version: str
    # Absent for ``Unreleased``, which has no date until it is tagged.
    date: Optional[str] = None
    # The lead paragraph some releases carry above their first category.
    summary: Optional[str] = None
    sections: list[ChangelogSection]


class ChangelogResponse(BaseModel):
    """Newest release first. Empty when the image ships without a changelog."""

    releases: list[ChangelogRelease]


class LatestReleaseResponse(BaseModel):
    """None when version checking is disabled or the GitHub proxy call failed."""

    latest_version: Optional[str] = None
