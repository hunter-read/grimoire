"""Pydantic models for the leagues API."""
import datetime
from typing import Literal, Optional

from pydantic import BaseModel, Field


class LeagueCreate(BaseModel):
    name: str = Field(min_length=1, max_length=255)
    description: str = Field(default="", max_length=20000)
    game_system_id: Optional[str] = None
    points_limit: Optional[int] = Field(default=None, ge=0, le=1000000)
    points_win: int = Field(default=3, ge=-100, le=100)
    points_draw: int = Field(default=1, ge=-100, le=100)
    points_loss: int = Field(default=0, ge=-100, le=100)


class LeagueUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    description: Optional[str] = Field(default=None, max_length=20000)
    game_system_id: Optional[str] = None
    points_limit: Optional[int] = Field(default=None, ge=0, le=1000000)
    points_win: Optional[int] = Field(default=None, ge=-100, le=100)
    points_draw: Optional[int] = Field(default=None, ge=-100, le=100)
    points_loss: Optional[int] = Field(default=None, ge=-100, le=100)
    # "active" or "finished".
    status: Optional[Literal["active", "finished"]] = None


class MemberAdd(BaseModel):
    user_id: str


class GuestCreate(BaseModel):
    nickname: str = Field(default="", max_length=100)


class BookAdd(BaseModel):
    """Share a library book with the league."""

    book_id: str = Field(min_length=1, max_length=36)
    # "public" (every member), "private" (the members in shared_user_ids) or
    # "organizer" (the organiser alone).
    visibility: Literal["public", "private", "organizer"] = "organizer"
    shared_user_ids: list[str] = Field(default_factory=list, max_length=500)


class BookUpdate(BaseModel):
    visibility: Optional[Literal["public", "private", "organizer"]] = None
    shared_user_ids: Optional[list[str]] = Field(default=None, max_length=500)


class BookReorder(BaseModel):
    ordered_ids: list[str] = Field(max_length=2000)


class MemberArmy(BaseModel):
    """The army a member plays in the league; null to clear it."""

    army_id: Optional[str] = None


class GameIn(BaseModel):
    """A game between two members. ``result`` (a, b or draw) may be left out when both scores are given."""

    played_on: Optional[datetime.date] = None
    mission: str = Field(default="", max_length=255)
    notes: str = Field(default="", max_length=20000)
    player_a_id: str
    player_b_id: str
    score_a: Optional[int] = Field(default=None, ge=0, le=100000)
    score_b: Optional[int] = Field(default=None, ge=0, le=100000)
    result: Optional[Literal["a", "b", "draw"]] = None


# --- Responses ----------------------------------------------------------------


class LeagueSummary(BaseModel):
    id: str
    name: str
    description: str = ""
    organizer_id: str
    game_system_id: Optional[str] = None
    # The library system's name, when it is one the caller may see.
    game_system_name: str = ""
    points_limit: Optional[int] = None
    points_win: int = 3
    points_draw: int = 1
    points_loss: int = 0
    status: str
    member_count: int = 0
    organizer_name: str = ""
    created_at: Optional[str] = None


class PlayerRef(BaseModel):
    id: str
    name: str


class ArmyRef(BaseModel):
    id: str
    name: str
    points: int = 0
    cost_name: str = "pts"


class LeagueMemberOut(BaseModel):
    user_id: str
    name: str
    army: Optional[ArmyRef] = None
    # Invited by the organiser with a sign-in code, rather than a full account.
    is_guest: bool = False


class LeagueGameOut(BaseModel):
    id: str
    played_on: Optional[str] = None
    mission: str = ""
    notes: str = ""
    player_a: PlayerRef
    player_b: PlayerRef
    army_a: Optional[ArmyRef] = None
    army_b: Optional[ArmyRef] = None
    score_a: Optional[int] = None
    score_b: Optional[int] = None
    # "a", "b" or "draw", from player A's side.
    result: str
    can_edit: bool = False


class StandingRow(BaseModel):
    user_id: str
    name: str
    played: int
    won: int
    drawn: int
    lost: int
    score_for: int
    score_against: int
    points: int


class LeagueDetail(LeagueSummary):
    can_manage: bool = False
    is_member: bool = False
    members: list[LeagueMemberOut] = []
    games: list[LeagueGameOut] = []
    standings: list[StandingRow] = []


class EligibleMember(BaseModel):
    id: str
    name: str


class LeagueGuest(BaseModel):
    """One of the league's guests, for its organiser."""

    user_id: str
    nickname: Optional[str] = None
    # None when SECRET_KEY changed since the code was made; regenerate it.
    guest_code: Optional[str] = None
    army: Optional[ArmyRef] = None


class GuestShareTemplate(BaseModel):
    """Copy-paste share text and links for a league guest's code."""

    code: Optional[str] = None
    link: str
    message: str
    mailto_url: str
    discord_message: str


class LeagueBook(BaseModel):
    """A book shared with the league, as the caller may see it."""

    id: str
    book_id: str
    title: str
    has_thumbnail: bool = False
    visibility: str
    sort_order: int = 0
    # Who a private book is shared with - for the organiser only.
    shared_user_ids: Optional[list[str]] = None


class BookSearchResult(BaseModel):
    book_id: str
    title: str
    has_thumbnail: bool = False
    game_system_name: str = ""
