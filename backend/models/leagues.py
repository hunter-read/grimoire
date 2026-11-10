"""Leagues: a group playing a wargame over time.

The game-neutral name for what 40k calls a Crusade and Age of Sigmar a Path to
Glory. An organiser (a GM or admin) creates it and adds members; each member
registers one of their armies; members log the games they play; and the
standings come from the results, scored with the league's own points per win,
draw and loss (``services/leagues.py``). Units' experience and honours are kept
on the armies (``Army.progress``). The organiser shares library books with the
league as a campaign's GM does with a campaign (``LeagueResource``), and can
invite guests, who sign in with a code (``User.guest_code``).

References to users have no ``ON DELETE``: removing or merging an account is
handled in code (``services/campaigns/user_data.py``), as for every other table.
"""
import datetime
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid

LEAGUE_ACTIVE = "active"
LEAGUE_FINISHED = "finished"
LEAGUE_STATUSES = (LEAGUE_ACTIVE, LEAGUE_FINISHED)

#: A game's result, from player A's side.
RESULT_A = "a"
RESULT_B = "b"
RESULT_DRAW = "draw"
RESULTS = (RESULT_A, RESULT_B, RESULT_DRAW)

#: Who sees a book shared with a league: every member, the members it is shared
#: with (and the organiser), or the organiser alone.
VISIBILITY_PUBLIC = "public"
VISIBILITY_PRIVATE = "private"
VISIBILITY_ORGANIZER = "organizer"
VISIBILITIES = (VISIBILITY_PUBLIC, VISIBILITY_PRIVATE, VISIBILITY_ORGANIZER)


class League(Base):
    __tablename__ = "leagues"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(255), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    organizer_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    game_system_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("game_systems.id", ondelete="SET NULL"), nullable=True
    )
    points_limit: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # League points for each result - 3/1/0 unless the organiser says otherwise.
    points_win: Mapped[Optional[int]] = mapped_column(Integer, default=3)
    points_draw: Mapped[Optional[int]] = mapped_column(Integer, default=1)
    points_loss: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    status: Mapped[Optional[str]] = mapped_column(String(20), default=LEAGUE_ACTIVE)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)


class LeagueMember(Base):
    __tablename__ = "league_members"
    __table_args__ = (UniqueConstraint("league_id", "user_id", name="uq_league_members"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    league_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    # The army this member plays in the league; must be theirs.
    army_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("armies.id", ondelete="SET NULL"), nullable=True
    )
    joined_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    # A guest invited to the league by its organiser, rather than a full
    # account added to it. Their sign-in code is on the account.
    is_guest: Mapped[Optional[bool]] = mapped_column(Boolean, default=False)


class LeagueResource(Base):
    """A library book the organiser has shared with a league.

    Mirrors ``CampaignResource``. Only books for now, but typed like a
    campaign's resources so the guest content gate (``services.campaigns.access``)
    reads both the same way.
    """

    __tablename__ = "league_resources"
    __table_args__ = (
        UniqueConstraint("league_id", "resource_type", "resource_id", name="uq_league_resources"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    league_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False, index=True)
    # One of VISIBILITIES.
    visibility: Mapped[str] = mapped_column(String(20), nullable=False, default=VISIBILITY_ORGANIZER)
    sort_order: Mapped[Optional[int]] = mapped_column(Integer, default=0)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)


class LeagueResourceShare(Base):
    """A member a ``private`` league book is shared with."""

    __tablename__ = "league_resource_shares"
    __table_args__ = (
        UniqueConstraint("resource_id", "user_id", name="uq_league_resource_shares"),
    )

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    resource_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("league_resources.id", ondelete="CASCADE"), nullable=False, index=True
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )


class LeagueGame(Base):
    """One game between two members, and how it went."""

    __tablename__ = "league_games"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    league_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("leagues.id", ondelete="CASCADE"), nullable=False, index=True
    )
    played_on: Mapped[Optional[datetime.date]] = mapped_column(Date, nullable=True)
    mission: Mapped[Optional[str]] = mapped_column(String(255), default="")
    notes: Mapped[Optional[str]] = mapped_column(Text, default="")
    player_a_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    army_a_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("armies.id", ondelete="SET NULL"), nullable=True
    )
    score_a: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    player_b_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False)
    army_b_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("armies.id", ondelete="SET NULL"), nullable=True
    )
    score_b: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    # RESULT_A, RESULT_B or RESULT_DRAW.
    result: Mapped[str] = mapped_column(String(10), nullable=False)
    # Who logged it: they may edit it, as may the organiser. Attribution only,
    # cleared when its user is deleted.
    recorded_by: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True
    )
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
