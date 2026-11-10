"""Access rules and serialization for armies.

An army is its owner's: only they (and admins) change it. It is private until
it is registered in a league; then the league's organiser and members may read
it too - they are about to face it.
"""
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...models import Army, Faction, League, LeagueMember
from ...models.base import utc_iso
from ...services.armies import battlescribe, guests, links
from ...services.armies.matching import wargame_system


def is_admin(user: CurrentUser) -> bool:
    return getattr(user, "role", None) == "admin"


def can_view(db: Session, army: Army, user: CurrentUser) -> bool:
    """Owner and admins, plus anyone sharing a league the army is registered in."""
    if army.user_id == user.id or is_admin(user):
        return True
    league_ids = [
        row[0]
        for row in db.query(LeagueMember.league_id).filter(LeagueMember.army_id == army.id).all()
    ]
    if not league_ids:
        return False
    member = (
        db.query(LeagueMember.id)
        .filter(LeagueMember.league_id.in_(league_ids), LeagueMember.user_id == user.id)
        .first()
    )
    if member is not None:
        return True
    organised = (
        db.query(League.id)
        .filter(League.id.in_(league_ids), League.organizer_id == user.id)
        .first()
    )
    return organised is not None


def can_edit(army: Army, user: CurrentUser) -> bool:
    return army.user_id == user.id or is_admin(user)


def get_army(db: Session, army_id: str, user: CurrentUser, *, edit: bool = False) -> Army:
    """The army, or a 404 - also for one the caller may not see, so ids do not leak."""
    army = db.query(Army).filter_by(id=army_id).first()
    if army is None or not can_view(db, army, user):
        raise HTTPException(404, "Army not found")
    if edit and not can_edit(army, user):
        raise HTTPException(403, "Only the army's owner can change it")
    return army


def check_system_and_faction(
    db: Session, user: CurrentUser, game_system_id: Optional[str], faction_id: Optional[str]
) -> tuple[Optional[str], Optional[str]]:
    """The ``(system, faction)`` pair to store, or a 400.

    The system must be a wargame in the library the caller may see, and the
    faction one of its own. A faction given without a system brings its system.
    A guest's faction must be one of their leagues' games', and any other reads
    as missing, so an id cannot be probed.
    """
    if faction_id:
        faction = db.query(Faction).filter_by(id=faction_id).first()
        if faction is not None and guests.is_guest(user):
            if faction.game_system_id not in guests.league_system_ids(db, user.id):
                faction = None
        if faction is None:
            raise HTTPException(400, "That faction is not in the library")
        if game_system_id and faction.game_system_id != game_system_id:
            raise HTTPException(400, "That faction does not belong to the army's system")
        game_system_id = faction.game_system_id
    if game_system_id and wargame_system(db, user, game_system_id) is None:
        raise HTTPException(400, "That is not a wargame system in the library")
    return game_system_id or None, faction_id or None


def summary(db: Session, army: Army, user: CurrentUser) -> dict[str, Any]:
    """The list view's shape.

    The system is named only when the caller may see it. A league's guest
    reading another member's army in some other game is given neither its id
    nor its faction, which would name library entries outside their leagues.
    """
    system = wargame_system(db, user, army.game_system_id) if army.game_system_id else None
    faction = db.query(Faction).filter_by(id=army.faction_id).first() if army.faction_id else None
    system_id = army.game_system_id
    if guests.is_guest(user) and system is None:
        system_id, faction = None, None
    return {
        "id": army.id,
        "name": army.name,
        "user_id": army.user_id,
        "game_system_id": system_id,
        "game_system_name": system.name if system else "",
        "system_name": army.system_name or "",
        "faction": {"id": faction.id, "name": faction.name} if faction else None,
        "points": army.points or 0,
        "points_limit": army.points_limit,
        "cost_name": army.cost_name or "pts",
        "source": army.source or "manual",
        "source_filename": army.source_filename or "",
        "updated_at": utc_iso(army.updated_at),
    }


def detail(db: Session, army: Army, user: CurrentUser) -> dict[str, Any]:
    """Everything the army page shows: the list, progress, and where each cited book is."""
    data = army.data or {}
    cited = links.publications_in(data)
    return {
        **summary(db, army, user),
        "data": data,
        "progress": army.progress or {},
        "notes": army.notes or "",
        "can_edit": can_edit(army, user),
        "publications": cited,
        "publication_links": links.resolve(db, user, army.system_name or "", cited),
    }


def recount(army: Army) -> None:
    """Recompute the army's total from its list, after the list changed."""
    army.points = battlescribe.roster_points(army.data or {}, army.cost_name or "pts")
