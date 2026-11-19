"""What a library system's compendium is made of (issue #835).

A compendium belongs to a game system, so the content behind it is tied to the
system by two visible links rather than inferred: the **content packs** that
fill it, and the **character sheets** players use for it. Both are set by
whoever can edit the system, and both are many-to-many - a "D&D 5e" shelf may
take the SRD and a homebrew pack, and one SRD pack may serve a "D&D 5e" and a
"D&D 5e (2024)" system alike.

Each link keys the far side by its stable string id rather than a row id, the
way ``Character.schema_ref`` does. A pack's rows are an index of its directory,
rebuilt from disk, and a sheet is installed per user or server-wide, so neither
has one row to point a foreign key at. Uninstalling and reinstalling the SRD
leaves its links standing. The system side cascades, so pruning a system takes
its links with it.
"""
import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class SystemContentPack(Base):
    """``pack_id`` (a ``ContentPack.pack_id``) fills ``game_system_id``'s compendium."""

    __tablename__ = "system_content_packs"

    game_system_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("game_systems.id", ondelete="CASCADE"),
        primary_key=True,
    )
    pack_id: Mapped[str] = mapped_column(String(100), primary_key=True, index=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)


class SystemCharacterSheet(Base):
    """``schema_id`` (a ``CharacterSchema.schema_id``) is a sheet for ``game_system_id``."""

    __tablename__ = "system_character_sheets"

    game_system_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("game_systems.id", ondelete="CASCADE"),
        primary_key=True,
    )
    schema_id: Mapped[str] = mapped_column(String(100), primary_key=True, index=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
