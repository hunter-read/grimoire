"""The GM screen: a campaign's board of tools (issue #764).

A board is the panels on it - one row each, so moving a panel or ticking a
countdown writes that panel alone, and two devices at the table do not overwrite
each other's whole board. Only the campaign's GM sees or edits it.

``config`` and ``state`` are JSON because each kind of panel holds its own
shape (a counter's range, a list of countdowns, a turn order). They are cleaned
by ``backend/services/gm_screen/panels.py`` on the way in, and the panel kinds
are a closed set there, so a row holds nothing a client chose freely.
"""
import datetime
from typing import Any, Optional

from sqlalchemy import DateTime, ForeignKey, Integer, JSON, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class GmScreenPanel(Base):
    """One tool on a campaign's GM screen, at one cell of the grid."""

    __tablename__ = "gm_screen_panels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    campaign_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("campaigns.id", ondelete="CASCADE"), nullable=False, index=True
    )
    # note | party | counter | clocks | pools | scratch | initiative
    kind: Mapped[str] = mapped_column(String(30), nullable=False)
    title: Mapped[str] = mapped_column(String(120), nullable=False, default="")
    # The panel's cell on a twelve-column grid, in grid units.
    x: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    y: Mapped[int] = mapped_column(Integer, nullable=False, default=0)
    w: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    h: Mapped[int] = mapped_column(Integer, nullable=False, default=4)
    # How the tool is set up, copied with the board...
    config: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    # ...and what is on it now, which a copied board starts without.
    state: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)
