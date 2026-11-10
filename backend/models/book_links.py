"""A book shown on a second system's shelf (issue #446).

A book belongs to one system: the folder it sits in, read on every scan. Some
books belong to more than one - a setting book with player guides for both
Pathfinder and D&D, a module statted for three OSR games - and a second copy of
the file would be a second row, with its own tags, bookmarks and progress
drifting away from the first.

A link is the library's symlink instead. The book stays where it is, one file
and one row, and also appears on the linked system's shelf. Everything shown
there is the book's own: its category, tags, cover, access level and reading
progress all come from the one row.

Links are keyed on the book's id rather than its path, so they survive every
rescan, and a moved or renamed book keeps them (move detection keeps the id).
Both sides cascade at the database level, so pruning a book or a system leaves
no link behind.
"""
import datetime
from typing import Optional

from sqlalchemy import DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow


class BookSystemLink(Base):
    """``book_id`` also appears on ``game_system_id``'s shelf."""

    __tablename__ = "book_system_links"

    book_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("books.id", ondelete="CASCADE"), primary_key=True
    )
    game_system_id: Mapped[str] = mapped_column(
        String(36),
        ForeignKey("game_systems.id", ondelete="CASCADE"),
        primary_key=True,
        index=True,
    )
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
