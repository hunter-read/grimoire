"""Saved audio sets — named, per-user playlists and soundboards."""
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    JSON,
    String,
    UniqueConstraint,
)

from .base import Base, _utcnow, _uuid

# The two kinds of set. A playlist is an ordered track list for the player
# queue; a soundboard is an ordered pad list plus a grid size.
SET_TYPES = ("playlist", "soundboard")


class AudioSet(Base):
    """A named collection of audio the user saved to reload later.

    Both kinds share one table because they are the same shape — a name plus an
    ordered list of audio ids with per-entry settings — and the UI lists them
    side by side. ``kind`` discriminates; ``entries`` holds the ordered list
    (``[{audio_id, loop?}]``) and ``layout`` the soundboard grid size, null for
    a playlist.

    Entries store audio ids only, not titles: a title edited in the library
    should show through on the saved set, and a track deleted from the library
    is skipped on load rather than resurrected from a stale copy.

    **Unique** ``(user_id, kind, name)`` so re-saving a name updates that set
    rather than growing a second one beside it, while a playlist and a
    soundboard may share a name (a "Tavern" of each is a reasonable pair).
    """

    __tablename__ = "audio_sets"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    kind = Column(String(20), nullable=False)
    name = Column(String(120), nullable=False)
    entries = Column(JSON, default=list)
    layout = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "kind", "name"),)
