"""Media models — generic maps, tokens, audio, and 3D models, plus their folder tag tables."""
import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Float, Index, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


def _browse_indexes(table: str, *, explicit: bool = False) -> tuple:
    """The indexes paged browsing reads (issue #221), one set per media table.

    Every browse index leads with ``variant_parent_id`` because every browse
    query filters to variant parents (``IS NULL`` is index-usable).

    ``folder`` and ``name`` are *covering* for the gallery's filters: besides
    their sort columns they carry everything a search or tag filter tests per
    row (the filename, the id that tag links and favorites join on, and the
    explicit flag where the table has one). A filter that matches rarely then
    scans an index a third the size of the table and never fetches a row it
    rejects; without the extra columns SQLite walked the index and fetched every
    row to test it, which took 300-400ms on 187k tokens. ``folder`` serves
    grouping by folder, "under this tagged folder", and one folder's items in
    name order; ``name`` the flat list and the filtered scans. ``added`` and
    ``size`` back the other flat sorts, so a deep page is an index walk rather
    than a sort of the whole table. ``live`` is the odd one out, keyed on
    ``id``.
    """
    covered = ["filename", "id", *(["is_explicit"] if explicit else [])]
    return (
        Index(
            f"ix_{table}_browse_folder", "variant_parent_id", "folder_path", "sort_name", *covered
        ),
        Index(
            f"ix_{table}_browse_name", "variant_parent_id", "sort_name", "folder_path", *covered
        ),
        Index(f"ix_{table}_browse_added", "variant_parent_id", "added_at", "sort_name"),
        Index(f"ix_{table}_browse_size", "variant_parent_id", "file_size", "sort_name"),
        # "Is this id a live parent?" answered from the index alone, for the
        # per-tag link counts (see tag_service.live_links).
        Index(f"ix_{table}_live", "id", "variant_parent_id"),
    )


class GenericMap(Base):
    """A generic map (not tied to a specific game system)."""

    __tablename__ = "generic_maps"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    filepath: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    relative_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    map_type: Mapped[Optional[str]] = mapped_column(String(100), default="")
    grid_size: Mapped[Optional[str]] = mapped_column(String(50), default="")
    # Manual grid override (issue #125). NULL means "no override" — the detail
    # endpoint falls back to the detection in maps/_helpers.py. Stored as floats
    # rounded to 2dp because maps routinely bleed a partial cell past the grid
    # (a 33x24 map printed with a quarter-cell margin is really 33.5x24.5), and
    # UVTT's map_size is numeric, not integral. grid_px is pixels per cell.
    grid_width: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    grid_height: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    grid_px: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Authored Universal VTT geometry — walls, portals, lights, environment —
    # drawn in the in-app editor (issues #126/#127). NULL means nothing has been
    # authored. Held here rather than in a sidecar file because the library is
    # routinely mounted read-only and authoring must never write beside the
    # user's maps; the export endpoint builds a .uvtt from this on demand.
    # Geometry is in grid units (as UVTT itself uses) and carries the
    # pixels_per_grid it was authored at, since everything is scale-relative and
    # replacing the source image would otherwise invalidate it undetectably.
    # See backend/routers/maps/vtt_authoring.py for the document shape.
    vtt_data: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Content identity — see the note on Book.content_hash. ``file_mtime`` +
    # ``file_size`` gate the re-hash so unchanged rescans read no file content;
    # the hash then distinguishes a replaced file from a moved one (issue #284).
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    file_mtime: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    variant_kind: Mapped[Optional[str]] = mapped_column(String(30), default="")
    variant_label: Mapped[Optional[str]] = mapped_column(String(120), default="")
    has_thumbnail: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_missing: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    # When this first appeared in the library - the "new" badge and date-added
    # sort (issue #199). See ``Book.added_at`` for when it is NULL.
    added_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True, default=_utcnow, index=True)
    # Natural-order filename key and the item's directory, kept in step by
    # models/browse.py for paged browsing (issue #221).
    sort_name: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    __table_args__ = _browse_indexes("generic_maps")


class MapFolder(Base):
    """Tags applied to a map folder path."""

    __tablename__ = "map_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    path: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    tags: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)


class Token(Base):
    """A token image (character, creature, object) for use on maps."""

    __tablename__ = "tokens"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    filepath: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    relative_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    is_explicit: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    file_mtime: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    variant_kind: Mapped[Optional[str]] = mapped_column(String(30), default="")
    variant_label: Mapped[Optional[str]] = mapped_column(String(120), default="")
    has_thumbnail: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_missing: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    # When this first appeared in the library - the "new" badge and date-added
    # sort (issue #199). See ``Book.added_at`` for when it is NULL.
    added_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True, default=_utcnow, index=True)
    # Natural-order filename key and the item's directory, kept in step by
    # models/browse.py for paged browsing (issue #221).
    sort_name: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    __table_args__ = _browse_indexes("tokens", explicit=True)


class TokenFolder(Base):
    """Tags applied to a token folder path."""

    __tablename__ = "token_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    path: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    tags: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)


class Audio(Base):
    """An audio track (ambient music, soundscape, sound effect)."""

    __tablename__ = "audio"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    filepath: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    relative_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    # Embedded metadata (best-effort; populated by the indexer via mutagen).
    duration: Mapped[Optional[float]] = mapped_column(Float, default=0.0)  # seconds
    title: Mapped[Optional[str]] = mapped_column(String(500), default="")
    artist: Mapped[Optional[str]] = mapped_column(String(500), default="")
    album: Mapped[Optional[str]] = mapped_column(String(500), default="")
    # Position on the album from the track/disc tags (issue #494): 0 when the
    # file has no such tag, NULL when the row predates reading them - the next
    # scan reads those once, so NULL never means "untagged".
    track_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    disc_number: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # True when folder cover art or embedded album art is available.
    has_artwork: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    # Bare filename of a cover set through the UI, under DATA_PATH/audio_covers/.
    # Takes precedence over folder art and embedded tags, since it is the only
    # one of the three a user can actually choose from Grimoire (issue #286).
    cover_image: Mapped[Optional[str]] = mapped_column(String(255), default="")
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    file_mtime: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    variant_kind: Mapped[Optional[str]] = mapped_column(String(30), default="")
    variant_label: Mapped[Optional[str]] = mapped_column(String(120), default="")
    is_missing: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    # When this first appeared in the library - the "new" badge and date-added
    # sort (issue #199). See ``Book.added_at`` for when it is NULL.
    added_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True, default=_utcnow, index=True)
    # Natural-order filename key and the item's directory, kept in step by
    # models/browse.py for paged browsing (issue #221).
    sort_name: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    __table_args__ = (
        *_browse_indexes("audio"),
        # The "track" sort: one folder's tracks in album order (issue #494).
        # Ends like ix_audio_browse_folder so the same tie-breaks read off it.
        Index(
            "ix_audio_browse_track",
            "variant_parent_id",
            "folder_path",
            "disc_number",
            "track_number",
            "sort_name",
            "filename",
            "id",
        ),
    )


class AudioFolder(Base):
    """Tags applied to an audio folder path."""

    __tablename__ = "audio_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    path: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    tags: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)


class Model3D(Base):
    """A 3D printable model (miniature, terrain, accessory).

    Named ``Model3D`` rather than ``Model`` because this package is
    ``backend.models``: a bare ``Model`` reads as "the ORM base" at every import
    site, and ``model`` is already the parameter name for an ORM class
    throughout the indexer and the variants service. The stored discriminator is
    still the plain ``"model"``.
    """

    __tablename__ = "models_3d"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    filepath: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    relative_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    is_explicit: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    file_size: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Triangles in the mesh, read from the binary STL header (84 bytes, no
    # parse). 0 when unknown — an ASCII mesh, or a format we do not parse.
    triangle_count: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Tri-state, and deliberately not a Boolean default: True is presupported
    # (ships with printing supports), False is unsupported, and NULL is "we
    # could not tell from the name or folder". Defaulting to False would assert
    # something about every model in a library that never uses the convention.
    is_supported: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, index=True)
    file_mtime: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    variant_kind: Mapped[Optional[str]] = mapped_column(String(30), default="")
    variant_label: Mapped[Optional[str]] = mapped_column(String(120), default="")
    has_thumbnail: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    # Set when a mesh was too heavy to rasterise inline during the scan. The
    # deferred thumbnail queue drains these afterwards with a longer budget, so
    # a pile of photogrammetry scans slows nothing down until the fast phases
    # are finished. Mirrors Book.ocr_pending.
    thumbnail_pending: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    is_missing: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    # When this first appeared in the library - the "new" badge and date-added
    # sort (issue #199). See ``Book.added_at`` for when it is NULL.
    added_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True, default=_utcnow, index=True)
    # Natural-order filename key and the item's directory, kept in step by
    # models/browse.py for paged browsing (issue #221).
    sort_name: Mapped[Optional[str]] = mapped_column(String(600), nullable=True)
    folder_path: Mapped[Optional[str]] = mapped_column(String(1000), nullable=True)

    __table_args__ = _browse_indexes("models_3d", explicit=True)


class Model3DFolder(Base):
    """Tags applied to a 3D model folder path."""

    __tablename__ = "model_3d_folders"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    path: Mapped[str] = mapped_column(String(1000), nullable=False, unique=True)
    tags: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
