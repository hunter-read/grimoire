"""What the library looks like from the army builder to a league's guest.

A full account reads the library's wargames, narrowed only by access levels.
A guest has no library at all: they were invited to a league, and reach the
league's game (and its editions) and the books the league shares with them,
nothing more. Every place an army reads the library on its caller's behalf -
matching a roster's system, naming a system, opening a cited book - narrows
through here, so a guest never learns the id or the name of anything else.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy.orm import Session

from ...models import GameSystem, League, LeagueMember


def is_guest(user: Any) -> bool:
    return getattr(user, "role", None) == "guest"


def league_system_ids(db: Session, user_id: str) -> set[str]:
    """The wargame systems of the leagues ``user_id`` plays in, with their editions."""
    ids: set[str] = {
        row[0]
        for row in db.query(League.game_system_id)
        .join(LeagueMember, LeagueMember.league_id == League.id)
        .filter(LeagueMember.user_id == user_id, League.game_system_id.isnot(None))
        .all()
        if row[0]
    }
    if ids:
        ids |= {
            row[0]
            for row in db.query(GameSystem.id).filter(GameSystem.parent_id.in_(ids)).all()
        }
    return ids
