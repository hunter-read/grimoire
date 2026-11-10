"""Pins on a wiki map page (issue #578).

A map page shows one map, and its pins are the places on it: each sits at a
point on the picture and usually links to another page of the campaign's wiki,
so a region map works as an index of the world. Click the pin on Waterdeep and
you land on the *Waterdeep* page.

``x`` and ``y`` are fractions of the picture's width and height (0-1), not
pixels, so a pin stays on its spot when the map is re-exported at a different
resolution or swapped for the campaign's copy of it.

The target is a page id, never a title, so a pin keeps working when that page
is renamed or moved in the tree. Deleting the target clears it, leaving an
unlinked pin rather than a dead one.
"""
import datetime
from typing import Optional

from sqlalchemy import DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class WikiMapPin(Base):
    """One pin on a map page."""

    __tablename__ = "wiki_map_pins"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    page_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("wiki_pages.id", ondelete="CASCADE"), nullable=False, index=True
    )
    x: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    y: Mapped[float] = mapped_column(Float, nullable=False, default=0.5)
    # The page the pin opens. Null for a pin that marks a spot without a page,
    # and for one whose page was deleted.
    target_page_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("wiki_pages.id", ondelete="SET NULL"), nullable=True, index=True
    )
    label: Mapped[Optional[str]] = mapped_column(String(255), default="")
    # A curated Lucide key or an emoji, and its tint, as on a page.
    icon: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    icon_color: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    # page: seen by whoever can see both the map page and the target page.
    # gm:   the campaign's GM alone - an unrevealed location on a shared map,
    #       stripped server-side like a ||GM secret||.
    visibility: Mapped[Optional[str]] = mapped_column(String(20), default="page")
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    created_by_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
