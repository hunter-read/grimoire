"""Armies and the source-book links behind their units.

An army is one player's force for a wargame: a points limit, and units with
their points, wargear, stat lines and rules. Most come from a BattleScribe
roster (``.ros``/``.rosz``, the format BattleScribe and New Recruit share);
the rest are entered by hand. Either way the parsed list is kept as one JSON
document (``data``) - a roster is a tree of selections inside forces, and the
army builder reads it whole - beside the original file, so an export hands
back exactly what was imported (``services/armies/storage.py``).

Progress over a league - experience, honours, notes - lives apart from the
list, in ``progress``, keyed by unit id, so it is never confused with what the
roster says.

``PublicationLink`` maps a publication a roster cites ("Codex: Necrons", page
82) to a book in the library, so a unit's rules open at their page in the
user's own PDF. Grimoire ships no points, stat lines or rules text: an army
holds only what its owner imported or typed.
"""
import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid

#: Where an army's list came from.
SOURCE_BATTLESCRIBE = "battlescribe"
SOURCE_MANUAL = "manual"


class Army(Base):
    """One player's army list for a wargame."""

    __tablename__ = "armies"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # The owner. Like every reference to a user, deleting or merging the
    # account is handled in code (services/campaigns/user_data.py).
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    # The library's wargame system and faction this army is for, when they can
    # be matched (from the roster's game system and catalogue names) or are set
    # by hand. Both nullable: an army for a game with no books is still an army.
    game_system_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("game_systems.id", ondelete="SET NULL"), nullable=True, index=True
    )
    faction_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("factions.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # The roster's own game system name ("Warhammer 40,000 10th Edition"), kept
    # whether or not it matched a library system: publication links key on it.
    system_name: Mapped[Optional[str]] = mapped_column(String(255), default="")
    # Total points and the limit, in ``cost_name`` (BattleScribe's cost type,
    # "pts" almost always). The total is recomputed whenever ``data`` changes.
    points: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    points_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    cost_name: Mapped[Optional[str]] = mapped_column(String(40), default="pts")
    source: Mapped[Optional[str]] = mapped_column(String(20), default=SOURCE_MANUAL)
    # The imported file's name, for the export; the bytes are on disk under
    # DATA_PATH/army_rosters/.
    source_filename: Mapped[Optional[str]] = mapped_column(String(255), default="")
    data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    # {unit_id: {"experience": int, "honours": [str], "notes": str}}
    progress: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    notes: Mapped[Optional[str]] = mapped_column(Text, default="")
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(
        DateTime, default=_utcnow, onupdate=_utcnow
    )


class PublicationLink(Base):
    """A publication a roster cites, linked to a book in the library.

    Shared by everyone and set by GMs and admins: one link makes every army
    citing that publication open at the right page. ``system_name`` is the
    roster's game system name, lower-cased, since two games can each have a
    "Core Rules". ``page_offset`` is added to the cited page to reach the PDF
    page, for books whose printed numbering does not start at the cover.
    """

    __tablename__ = "publication_links"
    __table_args__ = (
        UniqueConstraint("system_name", "publication", name="uq_publication_links_system_pub"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    system_name: Mapped[str] = mapped_column(String(255), nullable=False, default="")
    publication: Mapped[str] = mapped_column(String(255), nullable=False)
    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id", ondelete="CASCADE"), nullable=False, index=True
    )
    page_offset: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    # Attribution only: cleared when its user is deleted, the link stays.
    created_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
