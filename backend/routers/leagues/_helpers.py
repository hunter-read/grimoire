"""Access rules and serialization for leagues.

GMs and admins organise leagues. Only a league's people see it: its organiser,
its members, and admins. The organiser (or an admin) changes anything; a member
logs the games they play in and edits those.
"""
from typing import Any, Optional

from fastapi import HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser
from ...models import (
    Army,
    League,
    LeagueGame,
    LeagueMember,
    LeagueResource,
    LeagueResourceShare,
    User,
)
from ...models.base import utc_iso
from ...services import leagues as league_service
from ...services.armies.matching import wargame_system


def is_admin(user: CurrentUser) -> bool:
    return getattr(user, "role", None) == "admin"


def manages(league: League, user: CurrentUser) -> bool:
    return league.organizer_id == user.id or is_admin(user)


def member(db: Session, league_id: str, user_id: str) -> Optional[LeagueMember]:
    return db.query(LeagueMember).filter_by(league_id=league_id, user_id=user_id).first()


def get_league(db: Session, league_id: str, user: CurrentUser, *, manage: bool = False) -> League:
    """The league, or a 404 for one the caller is not part of."""
    league = db.query(League).filter_by(id=league_id).first()
    if league is None or not (manages(league, user) or member(db, league_id, user.id) is not None):
        raise HTTPException(404, "League not found")
    if manage and not manages(league, user):
        raise HTTPException(403, "Only the league's organiser can do that")
    return league


def check_system(db: Session, user: CurrentUser, game_system_id: Optional[str]) -> None:
    if game_system_id and wargame_system(db, user, game_system_id) is None:
        raise HTTPException(400, "That is not a wargame system in the library")


def can_edit_game(league: League, game: LeagueGame, user: CurrentUser) -> bool:
    """The organiser, an admin, whoever logged it, or either of its players."""
    return manages(league, user) or user.id in (
        game.recorded_by,
        game.player_a_id,
        game.player_b_id,
    )


def is_eligible(user: Optional[User]) -> bool:
    """Whether ``user`` may join a league: anyone with a full account."""
    return user is not None and not user.is_guest and user.role != "guest"


def _names(db: Session, user_ids: set[str]) -> dict[str, str]:
    if not user_ids:
        return {}
    rows = db.query(User.id, User.display_name, User.username).filter(User.id.in_(user_ids))
    return {uid: display or username for uid, display, username in rows}


def _army_ref(army: Optional[Army]) -> Optional[dict[str, Any]]:
    if army is None:
        return None
    return {
        "id": army.id,
        "name": army.name,
        "points": army.points or 0,
        "cost_name": army.cost_name or "pts",
    }


def summary(
    db: Session,
    league: League,
    user: CurrentUser,
    *,
    member_count: Optional[int] = None,
    organizer_name: Optional[str] = None,
) -> dict[str, Any]:
    """The list view's shape."""
    system = wargame_system(db, user, league.game_system_id) if league.game_system_id else None
    if member_count is None:
        member_count = db.query(LeagueMember).filter_by(league_id=league.id).count()
    if organizer_name is None:
        organizer_name = _names(db, {league.organizer_id}).get(league.organizer_id, "")
    return {
        "id": league.id,
        "name": league.name,
        "description": league.description or "",
        "organizer_id": league.organizer_id,
        "organizer_name": organizer_name,
        "game_system_id": league.game_system_id,
        "game_system_name": system.name if system else "",
        "points_limit": league.points_limit,
        "points_win": league.points_win or 0,
        "points_draw": league.points_draw or 0,
        "points_loss": league.points_loss or 0,
        "status": league.status or "active",
        "member_count": member_count,
        "created_at": utc_iso(league.created_at),
    }


def detail(db: Session, league: League, user: CurrentUser) -> dict[str, Any]:
    """The league page: members and their armies, games, and the standings."""
    members = db.query(LeagueMember).filter_by(league_id=league.id).all()
    games = (
        db.query(LeagueGame)
        .filter_by(league_id=league.id)
        .order_by(
            LeagueGame.played_on.desc().nulls_last(),
            LeagueGame.created_at.desc(),
            LeagueGame.id,
        )
        .all()
    )
    user_ids = {m.user_id for m in members} | {league.organizer_id}
    user_ids |= {g.player_a_id for g in games} | {g.player_b_id for g in games}
    names = _names(db, user_ids)
    army_ids = {m.army_id for m in members if m.army_id}
    army_ids |= {g.army_a_id for g in games if g.army_a_id}
    army_ids |= {g.army_b_id for g in games if g.army_b_id}
    armies = {a.id: a for a in db.query(Army).filter(Army.id.in_(army_ids))} if army_ids else {}
    member_rows = sorted(
        (
            {
                "user_id": m.user_id,
                "name": names.get(m.user_id, ""),
                "army": _army_ref(armies.get(m.army_id)) if m.army_id else None,
                "is_guest": bool(m.is_guest),
            }
            for m in members
        ),
        key=lambda m: str(m["name"]).lower(),
    )
    return {
        **summary(
            db,
            league,
            user,
            member_count=len(members),
            organizer_name=names.get(league.organizer_id, ""),
        ),
        "can_manage": manages(league, user),
        "is_member": any(m.user_id == user.id for m in members),
        "members": member_rows,
        "games": [
            {
                "id": g.id,
                "played_on": g.played_on.isoformat() if g.played_on else None,
                "mission": g.mission or "",
                "notes": g.notes or "",
                "player_a": {"id": g.player_a_id, "name": names.get(g.player_a_id, "")},
                "player_b": {"id": g.player_b_id, "name": names.get(g.player_b_id, "")},
                "army_a": _army_ref(armies.get(g.army_a_id)) if g.army_a_id else None,
                "army_b": _army_ref(armies.get(g.army_b_id)) if g.army_b_id else None,
                "score_a": g.score_a,
                "score_b": g.score_b,
                "result": g.result,
                "can_edit": can_edit_game(league, g, user),
            }
            for g in games
        ],
        "standings": league_service.standings(
            member_rows,
            games,
            (league.points_win or 0, league.points_draw or 0, league.points_loss or 0),
        ),
    }


def leave(db: Session, league_id: str, user_id: str) -> None:
    """Take ``user_id`` out of a league, with the league's books shared with them.

    A guest's account stays, whether they left or the organiser removed them:
    their armies are theirs, and they keep signing in to reach them. Their games
    stay logged. Does not commit.
    """
    db.query(LeagueMember).filter_by(league_id=league_id, user_id=user_id).delete(
        synchronize_session=False
    )
    books = db.query(LeagueResource.id).filter_by(league_id=league_id)
    db.query(LeagueResourceShare).filter(
        LeagueResourceShare.user_id == user_id, LeagueResourceShare.resource_id.in_(books)
    ).delete(synchronize_session=False)


def delete_rows(db: Session, league_id: str) -> None:
    """Delete a league's books, games and memberships, ahead of the league. Does not commit.

    Its guests' accounts and armies stay, as when one leaves (see ``leave``).
    """
    books = db.query(LeagueResource.id).filter_by(league_id=league_id)
    db.query(LeagueResourceShare).filter(LeagueResourceShare.resource_id.in_(books)).delete(
        synchronize_session=False
    )
    db.query(LeagueResource).filter_by(league_id=league_id).delete(synchronize_session=False)
    db.query(LeagueGame).filter_by(league_id=league_id).delete(synchronize_session=False)
    db.query(LeagueMember).filter_by(league_id=league_id).delete(synchronize_session=False)
