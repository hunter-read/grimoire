"""Pydantic models for the army builder API."""
from typing import Optional

from pydantic import BaseModel, Field


class ManualUnitIn(BaseModel):
    """One unit of a hand-built list. ``id`` keeps a unit's progress across edits."""

    id: Optional[str] = Field(default=None, max_length=64)
    name: str = Field(max_length=500)
    number: int = Field(default=1, ge=1, le=100000)
    points: int = Field(default=0, ge=0, le=1000000)
    category: Optional[str] = Field(default=None, max_length=100)
    categories: list[str] = Field(default_factory=list, max_length=50)
    notes: Optional[str] = Field(default=None, max_length=2000)


class ArmyCreate(BaseModel):
    """A hand-built army."""

    name: str = Field(min_length=1, max_length=255)
    game_system_id: Optional[str] = None
    faction_id: Optional[str] = None
    points_limit: Optional[int] = Field(default=None, ge=0)
    units: list[ManualUnitIn] = Field(default_factory=list)
    notes: str = Field(default="", max_length=20000)


class ArmyUpdate(BaseModel):
    """Fields to change. ``units`` replaces a hand-built army's list (an imported one is read-only)."""

    name: Optional[str] = Field(default=None, min_length=1, max_length=255)
    game_system_id: Optional[str] = None
    faction_id: Optional[str] = None
    points_limit: Optional[int] = Field(default=None, ge=0)
    notes: Optional[str] = Field(default=None, max_length=20000)
    units: Optional[list[ManualUnitIn]] = None


class UnitProgress(BaseModel):
    """A unit's progress over a league: experience, honours earned, notes."""

    experience: int = Field(default=0, ge=0, le=100000)
    honours: list[str] = Field(default_factory=list, max_length=50)
    notes: str = Field(default="", max_length=4000)


class PublicationLinkIn(BaseModel):
    """Link a cited publication to a library book, for every army citing it."""

    system_name: str = Field(default="", max_length=255)
    publication: str = Field(min_length=1, max_length=255)
    book_id: str
    page_offset: int = Field(default=0, ge=-10000, le=10000)


# --- Responses ----------------------------------------------------------------


# The army document: a parsed roster, or a hand-built list in the same shape
# (services/armies/battlescribe.py and manual.py write it).


class RosterCost(BaseModel):
    name: str = ""
    value: int = 0


class RosterCharacteristic(BaseModel):
    name: str = ""
    value: str = ""


class RosterProfile(BaseModel):
    """A stat line: a unit's or a weapon's, by ``type`` ("Unit", "Ranged Weapons")."""

    name: str = ""
    type: str = ""
    characteristics: list[RosterCharacteristic] = Field(default_factory=list)
    publication: str = ""
    page: str = ""


class RosterRule(BaseModel):
    name: str = ""
    description: str = ""
    publication: str = ""
    page: str = ""


class RosterUnit(BaseModel):
    """A selection: a unit, a model in one, or an upgrade, with what it holds."""

    id: str = ""
    name: str = ""
    type: str = ""
    number: int = 1
    costs: list[RosterCost] = Field(default_factory=list)
    categories: list[str] = Field(default_factory=list)
    primary_category: str = ""
    profiles: list[RosterProfile] = Field(default_factory=list)
    rules: list[RosterRule] = Field(default_factory=list)
    # The publication and page the unit's entry cites.
    publication: str = ""
    page: str = ""
    # Hand-built lists only.
    notes: str = ""
    children: list["RosterUnit"] = Field(default_factory=list)


class RosterForce(BaseModel):
    id: str = ""
    name: str = ""
    # The faction catalogue the force is drawn from ("Xenos - Necrons").
    catalogue: str = ""
    catalogue_id: str = ""
    units: list[RosterUnit] = Field(default_factory=list)
    forces: list["RosterForce"] = Field(default_factory=list)


class RosterDocument(BaseModel):
    # "battlescribe" or "manual".
    format: str = ""
    name: str = ""
    game_system_id: str = ""
    game_system_name: str = ""
    costs: list[RosterCost] = Field(default_factory=list)
    cost_limits: list[RosterCost] = Field(default_factory=list)
    forces: list[RosterForce] = Field(default_factory=list)


class FactionRef(BaseModel):
    id: str
    name: str


class PublicationLinkOut(BaseModel):
    book_id: str
    book_title: str
    page_offset: int = 0


class ArmySummary(BaseModel):
    id: str
    name: str
    user_id: str
    game_system_id: Optional[str] = None
    # The library system's name, when the army is matched to one the caller may see.
    game_system_name: str = ""
    # The roster's own game system name, whether or not it matched the library.
    system_name: str = ""
    faction: Optional[FactionRef] = None
    points: int = 0
    points_limit: Optional[int] = None
    cost_name: str = "pts"
    # "battlescribe" (imported from a roster) or "manual" (built by hand).
    source: str
    source_filename: str = ""
    updated_at: Optional[str] = None


class ArmyDetail(ArmySummary):
    data: RosterDocument = Field(default_factory=RosterDocument)
    # Each unit's progress, by unit id.
    progress: dict[str, UnitProgress] = Field(default_factory=dict)
    notes: str = ""
    can_edit: bool = False
    publications: list[str] = Field(default_factory=list)
    publication_links: dict[str, PublicationLinkOut] = Field(default_factory=dict)


class BookMatch(BaseModel):
    book_id: str
    title: str


class ArmyPublication(BaseModel):
    publication: str
    link: Optional[PublicationLinkOut] = None
    suggestions: list[BookMatch] = Field(default_factory=list)
