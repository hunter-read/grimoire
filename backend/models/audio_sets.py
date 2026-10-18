"""Saved audio sets — named, per-user playlists and soundboards."""
import datetime
from typing import Any, Optional

from sqlalchemy import (
    DateTime,
    ForeignKey,
    JSON,
    String,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

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

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    kind: Mapped[str] = mapped_column(String(20), nullable=False)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    entries: Mapped[Optional[list[Any]]] = mapped_column(JSON, default=list)
    layout: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "kind", "name"),)
