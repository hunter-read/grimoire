"""Matching a roster to the library: its wargame system and its faction."""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import Faction, GameSystem
from ...models.game_types import GAME_TYPE_WARGAME
from ..access_control import visible_systems
from ..factions import hidden_faction_ids
from . import guests


def match_system(db: Session, user: Any, system_name: str) -> Optional[GameSystem]:
    """The library's wargame system named like the roster's game system, if any.

    Exact on the name, ignoring case: "Warhammer 40,000 10th Edition" in the
    roster is the edition system the armory's folder produced. Only systems the
    user may see are matched, so an import never reveals a restricted one - and
    a guest's only their leagues' (``guests``).
    """
    name = (system_name or "").strip().lower()
    if not name:
        return None
    q = db.query(GameSystem).filter(
        GameSystem.game_type == GAME_TYPE_WARGAME, func.lower(GameSystem.name) == name
    )
    result: Optional[GameSystem] = _visible(db, q, user).first()
    return result


def match_faction(
    db: Session, user: Any, system_id: Optional[str], catalogue: str
) -> Optional[Faction]:
    """The system's faction whose name the roster's catalogue names.

    Catalogues are named for their faction with a grouping in front
    ("Xenos - Necrons", "Imperium - Space Marines"), so the faction whose name
    appears in the catalogue name wins - the longest, so "Chaos Space Marines"
    beats "Space Marines". Only factions ``user`` may know of are matched.
    """
    wanted = (catalogue or "").lower()
    if not system_id or not wanted:
        return None
    hidden = hidden_faction_ids(db, system_id, user)
    best: Optional[Faction] = None
    for faction in db.query(Faction).filter_by(game_system_id=system_id).all():
        if faction.id in hidden:
            continue
        name = faction.name.lower()
        if name and name in wanted and (best is None or len(name) > len(best.name)):
            best = faction
    return best


def wargame_system(db: Session, user: Any, system_id: str) -> Optional[GameSystem]:
    """The wargame system ``system_id`` names, if ``user`` may see it.

    What an army or a league may be set to: a role-playing system, or one kept
    from the user, is not one.
    """
    q = db.query(GameSystem).filter(
        GameSystem.id == system_id, GameSystem.game_type == GAME_TYPE_WARGAME
    )
    result: Optional[GameSystem] = _visible(db, q, user).first()
    return result


def choosable_systems(db: Session, user: Any) -> list[GameSystem]:
    """The wargame systems ``user`` may set an army to, by name."""
    q = db.query(GameSystem).filter(GameSystem.game_type == GAME_TYPE_WARGAME)
    return sorted(_visible(db, q, user).all(), key=lambda s: (s.name or "").lower())


def _visible(db: Session, q: Any, user: Any) -> Any:
    """``q`` narrowed to the systems ``user`` may see: a guest, their leagues' alone."""
    q = visible_systems(db, q, user)
    if guests.is_guest(user):
        q = q.filter(GameSystem.id.in_(guests.league_system_ids(db, user.id) or {""}))
    return q
