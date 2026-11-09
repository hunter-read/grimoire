"""Factions - the armies a wargame is played with (Necrons, Stormcast, ...).

A faction belongs to one wargame system (an edition, when the game has them),
and may sit under a parent faction: Blood Angels inside Space Marines. Books
link to factions many-to-many, because a book can cover several armies (a
BattleTech Field Manual, an Imperial Armour compendium) and an army has many
books.

The scan creates factions from folders (``indexer/factions.py``). A faction's
``slug`` is the slug path from the system root - ``space-marines--blood-angels``
- so two parents can each hold a child of the same name without colliding.
"""
import datetime
from typing import TYPE_CHECKING, Optional

from sqlalchemy import Column, DateTime, ForeignKey, String, Table, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, _utcnow, _uuid

if TYPE_CHECKING:
    from .library import Book, GameSystem

#: Books <-> factions. Both sides cascade at the database level so a bulk delete
#: of books (or a pruned system taking its factions) cannot strand a link row.
book_factions = Table(
    "book_factions",
    Base.metadata,
    Column(
        "book_id",
        String(36),
        ForeignKey("books.id", ondelete="CASCADE"),
        primary_key=True,
    ),
    Column(
        "faction_id",
        String(36),
        ForeignKey("factions.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    ),
)


class Faction(Base):
    """One army of a wargame system, optionally inside a parent faction."""

    __tablename__ = "factions"
    __table_args__ = (
        UniqueConstraint("game_system_id", "slug", name="uq_factions_system_slug"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    game_system_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("game_systems.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    slug: Mapped[str] = mapped_column(String(500), nullable=False)
    parent_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("factions.id", ondelete="CASCADE"), nullable=True, index=True
    )
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)

    game_system: Mapped["GameSystem"] = relationship("GameSystem", back_populates="factions")
    parent: Mapped[Optional["Faction"]] = relationship(
        "Faction", remote_side=[id], back_populates="children"
    )
    children: Mapped[list["Faction"]] = relationship(
        "Faction",
        back_populates="parent",
        cascade="all, delete-orphan",
        passive_deletes=True,
    )
    books: Mapped[list["Book"]] = relationship(
        "Book",
        secondary=book_factions,
        back_populates="factions",
        passive_deletes=True,
    )
