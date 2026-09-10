"""Pydantic schemas for the maps API."""
from typing import Optional
from pydantic import BaseModel, Field, field_validator

from ...services import tag_service
from .._bulk_schemas import bulk_update_model
from .._variant_schemas import VariantCountMixin, VariantFamilyMixin


class MapUpdate(BaseModel):
    description: Optional[str] = None
    tags: Optional[list[str]] = None
    map_type: Optional[str] = None
    grid_size: Optional[str] = None
    # Manual grid override (issue #125). Fractional to allow the partial-cell
    # bleed common on printed maps; stored at 2dp. Sending 0 clears the
    # override and restores automatic detection.
    grid_width: Optional[float] = Field(default=None, ge=0, le=1000)
    grid_height: Optional[float] = Field(default=None, ge=0, le=1000)
    grid_px: Optional[float] = Field(default=None, ge=0, le=2000)

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        return tag_service.dedupe_tags(v) if v is not None else v

    @field_validator("grid_width", "grid_height", "grid_px")
    @classmethod
    def round_grid(cls, v):
        # 0 is the documented "clear the override" signal, normalised to None so
        # it stores as NULL rather than a zero that would read as a real grid.
        if v is None:
            return None
        return round(v, 2) or None


# Batch form of MapUpdate: {"items": [{"id": ..., ...MapUpdate fields}]}.
MapBulkUpdate = bulk_update_model(MapUpdate, "Map")


class FolderTagsUpdate(BaseModel):
    path: str
    tags: list[str]

    @field_validator("tags", mode="before")
    @classmethod
    def dedupe_tags(cls, v):
        # Keep the entered casing (dedupe by key); the folder-update handler
        # registers catalog rows with this casing and stores internal keys.
        return tag_service.dedupe_tags(v)


class MapOut(VariantCountMixin):
    """One map, as returned by the list endpoint.

    `description`/`map_type`/`file_size`/`has_thumbnail` are declared
    `default=...` on `GenericMap` rather than NOT NULL, so NULL is still
    representable (the default applies at insert only, and rows predating a
    column migration keep NULL) — hence Optional. `is_missing`/`is_archive` are
    coalesced with `bool(...)` by the handler and stay required.
    """

    id: str
    filename: str
    relative_path: str
    description: Optional[str] = None
    tags: list[str]
    map_type: Optional[str] = None
    file_size: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_missing: bool
    is_archive: bool


class MapListResponse(BaseModel):
    total: int
    maps: list[MapOut]


class MapGrid(BaseModel):
    """Detected grid dimensions for a map (see `_helpers._map_image_info`).

    `cell_px` is only present on the DPI/computed branches — the filename branch
    omits it, and PDF maps have it stripped — so it is Optional.

    Floats rather than ints: a manual override may carry a fractional cell count
    for a map that bleeds part of a cell past its grid (issue #125). Inferred
    grids still come back whole.
    """

    width: float
    height: float
    cell_px: Optional[float] = None
    source: str


class MapDetailResponse(VariantFamilyMixin):
    """`GET /maps/{id}` — map metadata, folder context, and image info.

    Everything from `_map_image_info` is nullable by construction: the dict is
    seeded with `None`s and only filled in when the file could be measured
    (archives, unreadable files, and PDFs all leave some or all of it None).
    """

    id: str
    filename: str
    relative_path: str
    folder_path: str
    folder_tags: list[str]
    description: Optional[str] = None
    tags: list[str]
    map_type: Optional[str] = None
    grid_size: Optional[str] = None
    # The stored override, echoed back so the editor can tell a corrected grid
    # from an inferred one. None on all three means detection is in charge.
    grid_width: Optional[float] = None
    grid_height: Optional[float] = None
    grid_px: Optional[float] = None
    file_size: Optional[int] = None
    has_thumbnail: Optional[bool] = None
    is_missing: bool
    is_archive: bool
    pixel_width: Optional[int] = None
    pixel_height: Optional[int] = None
    dpi: Optional[int] = None
    grid: Optional[MapGrid] = None
    is_pdf: bool
    page_count: Optional[int] = None
    # Which viewer to mount: "image" (raster), "video" (.webm/.mp4),
    # "vtt" (.uvtt/.dd2vtt), or "archive".
    media_kind: str = "image"


class FolderTagsOut(BaseModel):
    """One folder path and its tags.

    Note the list/update endpoints differ: `GET /map-folders` returns display
    tags, while the PATCH/bulk writes echo back the stored internal keys.
    """

    path: str
    tags: list[str]


class MapFoldersResponse(BaseModel):
    folders: list[FolderTagsOut]


class StatusResponse(BaseModel):
    """Write-endpoint acknowledgement.

    `grid_warning` rides along when a saved grid override looks implausible for
    the map's pixel dimensions. The write still succeeded — some maps really do
    have odd grids — so this is advisory, for the UI to surface as a
    confirmable notice rather than an error.
    """

    status: str
    grid_warning: Optional[dict] = None


class VttDataResponse(BaseModel):
    """Parsed Universal VTT metadata (`GET /maps/{id}/vtt/data`).

    Every field is Optional/defaulted: exporters differ in which keys they write,
    and a file may legitimately have no lights, portals, or walls.
    """

    format: Optional[float] = None
    pixels_per_grid: Optional[int] = None
    grid_width: Optional[float] = None
    grid_height: Optional[float] = None
    wall_count: int = 0
    object_wall_count: int = 0
    portal_count: int = 0
    light_count: int = 0
    has_image: bool = False


# --- Universal VTT authoring (issues #126/#127) --------------------------------
# The editor's document, mirrored as Pydantic so the OpenAPI schema describes it
# and obviously-wrong payloads are rejected at the edge. The *semantic* rules --
# colour channel order, coordinate limits, closed-polyline conventions -- live in
# `vtt_authoring.normalize_vtt_data`, which is the single gate a stored document
# passes through; duplicating them here would leave two definitions to drift.


class VttPoint(BaseModel):
    """A point in **grid units** (not pixels), as the UVTT format itself uses."""

    x: float
    y: float


class VttPortalIn(BaseModel):
    """A door or window.

    `bounds` is the pair of endpoints defining the door line, and is the field
    that matters: `position` and `rotation` are derived from it on export
    because several importers ignore one or the other.

    `closed` is the door/window discriminator — True is a door, False a window.
    """

    bounds: list[VttPoint]
    closed: bool = True
    freestanding: bool = False


class VttLightIn(BaseModel):
    """A light source. `range` is in grid squares; `color` is ARGB hex.

    `intensity` has no scale agreed between VTTs, so it is carried through
    verbatim rather than normalised to any one of them.
    """

    position: VttPoint
    range: float = 0
    intensity: float = 1
    color: Optional[str] = None
    shadows: bool = True


class VttEnvironmentIn(BaseModel):
    """`baked_lighting` means the image already has its lighting painted in."""

    baked_lighting: bool = False
    ambient_light: Optional[str] = None


class VttDocumentIn(BaseModel):
    """A whole authored document: the editor's drawing, in grid units.

    `pixels_per_grid` records the grid the geometry was drawn against. It is
    stored because everything here is scale-relative — replacing the source
    image with a different size would otherwise invalidate every wall silently.
    """

    pixels_per_grid: float = 0
    grid_offset: Optional[VttPoint] = None
    line_of_sight: list[list[VttPoint]] = Field(default_factory=list)
    objects_line_of_sight: list[list[VttPoint]] = Field(default_factory=list)
    portals: list[VttPortalIn] = Field(default_factory=list)
    lights: list[VttLightIn] = Field(default_factory=list)
    environment: Optional[VttEnvironmentIn] = None


class VttAuthoringUpdate(BaseModel):
    """`PUT /maps/{id}/vtt/authoring` — replaces the whole document.

    `data: null` clears everything authored on the map.
    """

    data: Optional[VttDocumentIn] = None


class VttFeatureCounts(BaseModel):
    wall_count: int = 0
    object_wall_count: int = 0
    portal_count: int = 0
    light_count: int = 0


class VttAuthoringResponse(VttFeatureCounts):
    """`GET /maps/{id}/vtt/authoring` — the document plus the grid to draw it on.

    `data` is None when nothing has been authored. Pixel dimensions are
    Optional for the same reason as on `MapDetailResponse`: a file that could
    not be measured reports None rather than failing the request.
    """

    map_id: str
    filename: str
    pixel_width: Optional[int] = None
    pixel_height: Optional[int] = None
    grid: MapGrid
    data: Optional[dict] = None


class VttAuthoringSaveResponse(VttFeatureCounts):
    status: str
