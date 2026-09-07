"""Media models — generic maps, tokens, audio, and 3D models, plus their folder tag tables."""
from sqlalchemy import Boolean, Column, DateTime, Float, Integer, JSON, String, Text

from .base import Base, _utcnow, _uuid


class GenericMap(Base):
    """A generic map (not tied to a specific game system)."""

    __tablename__ = "generic_maps"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    map_type = Column(String(100), default="")
    grid_size = Column(String(50), default="")
    file_size = Column(Integer, default=0)
    # Content identity — see the note on Book.content_hash. ``file_mtime`` +
    # ``file_size`` gate the re-hash so unchanged rescans read no file content;
    # the hash then distinguishes a replaced file from a moved one (issue #284).
    content_hash = Column(String(64), nullable=True, index=True)
    file_mtime = Column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id = Column(String(36), nullable=True, index=True)
    variant_kind = Column(String(30), default="")
    variant_label = Column(String(120), default="")
    has_thumbnail = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class MapFolder(Base):
    """Tags applied to a map folder path."""

    __tablename__ = "map_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class Token(Base):
    """A token image (character, creature, object) for use on maps."""

    __tablename__ = "tokens"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    is_explicit = Column(Boolean, default=False)
    file_size = Column(Integer, default=0)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash = Column(String(64), nullable=True, index=True)
    file_mtime = Column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id = Column(String(36), nullable=True, index=True)
    variant_kind = Column(String(30), default="")
    variant_label = Column(String(120), default="")
    has_thumbnail = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class TokenFolder(Base):
    """Tags applied to a token folder path."""

    __tablename__ = "token_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class Audio(Base):
    """An audio track (ambient music, soundscape, sound effect)."""

    __tablename__ = "audio"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    # Embedded metadata (best-effort; populated by the indexer via mutagen).
    duration = Column(Float, default=0.0)  # seconds
    title = Column(String(500), default="")
    artist = Column(String(500), default="")
    album = Column(String(500), default="")
    # True when folder cover art or embedded album art is available.
    has_artwork = Column(Boolean, default=False)
    # Bare filename of a cover set through the UI, under DATA_PATH/audio_covers/.
    # Takes precedence over folder art and embedded tags, since it is the only
    # one of the three a user can actually choose from Grimoire (issue #286).
    cover_image = Column(String(255), default="")
    file_size = Column(Integer, default=0)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash = Column(String(64), nullable=True, index=True)
    file_mtime = Column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id = Column(String(36), nullable=True, index=True)
    variant_kind = Column(String(30), default="")
    variant_label = Column(String(120), default="")
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class AudioFolder(Base):
    """Tags applied to an audio folder path."""

    __tablename__ = "audio_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)


class Model3D(Base):
    """A 3D printable model (miniature, terrain, accessory).

    Named ``Model3D`` rather than ``Model`` because this package is
    ``backend.models``: a bare ``Model`` reads as "the ORM base" at every import
    site, and ``model`` is already the parameter name for an ORM class
    throughout the indexer and the variants service. The stored discriminator is
    still the plain ``"model"``.
    """

    __tablename__ = "models_3d"

    id = Column(String(36), primary_key=True, default=_uuid)
    filename = Column(String(500), nullable=False)
    filepath = Column(String(1000), nullable=False, unique=True)
    relative_path = Column(String(1000), nullable=False)
    description = Column(Text, default="")
    is_explicit = Column(Boolean, default=False)
    file_size = Column(Integer, default=0)
    # Triangles in the mesh, read from the binary STL header (84 bytes, no
    # parse). 0 when unknown — an ASCII mesh, or a format we do not parse.
    triangle_count = Column(Integer, default=0)
    # Tri-state, and deliberately not a Boolean default: True is presupported
    # (ships with printing supports), False is unsupported, and NULL is "we
    # could not tell from the name or folder". Defaulting to False would assert
    # something about every model in a library that never uses the convention.
    is_supported = Column(Boolean, nullable=True)
    # Content identity — see the note on GenericMap.content_hash.
    content_hash = Column(String(64), nullable=True, index=True)
    file_mtime = Column(Float, nullable=True)
    # Variant grouping — see the note on Book.variant_parent_id. Two levels
    # only, no ForeignKey; enforced in services/variants.py.
    variant_parent_id = Column(String(36), nullable=True, index=True)
    variant_kind = Column(String(30), default="")
    variant_label = Column(String(120), default="")
    has_thumbnail = Column(Boolean, default=False)
    # Set when a mesh was too heavy to rasterise inline during the scan. The
    # deferred thumbnail queue drains these afterwards with a longer budget, so
    # a pile of photogrammetry scans slows nothing down until the fast phases
    # are finished. Mirrors Book.ocr_pending.
    thumbnail_pending = Column(Boolean, default=False)
    is_missing = Column(Boolean, default=False)
    created_at = Column(DateTime, default=_utcnow)


class Model3DFolder(Base):
    """Tags applied to a 3D model folder path."""

    __tablename__ = "model_3d_folders"

    id = Column(String(36), primary_key=True, default=_uuid)
    path = Column(String(1000), nullable=False, unique=True)
    tags = Column(JSON, default=list)
