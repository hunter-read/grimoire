"""Leagues: a group playing a wargame over time.

The game-neutral name for what 40k calls a Crusade and Age of Sigmar a Path to
Glory. An organiser (a GM or admin) creates it and adds members; each member
registers one of their armies; members log the games they play; and the
standings come from the results, scored with the league's own points per win,
draw and loss (``services/leagues.py``). Units' experience and honours are kept
on the armies (``Army.progress``).

References to users have no ``ON DELETE``: removing or merging an account is
handled in code (``services/campaigns/user_data.py``), as for every other table.
"""
import datetime
from typing import Optional

from sqlalchemy import Date, DateTime, ForeignKey, Integer, String, Text, UniqueConstraint
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
