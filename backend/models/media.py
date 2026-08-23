"""Media models — generic maps, tokens, and audio, plus their folder tag tables."""
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
