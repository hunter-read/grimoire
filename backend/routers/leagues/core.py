"""League endpoint handlers.

GMs and admins organise leagues and add their members; members register one of
their armies and log the games they play; the organiser (or an admin) can edit
or remove any game. Only the league's people see it.
"""
from fastapi import Depends, HTTPException, Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...models import Army, League, LeagueGame, LeagueMember, User
from ...services import leagues as league_service
from ._helpers import (
    can_edit_game,
    check_system,
    detail,
    get_league,
    is_admin,
    is_eligible,
    manages,
    member,
    summary,
)
from ._schemas import GameIn, LeagueCreate, LeagueUpdate, MemberAdd, MemberArmy


# --- Leagues ------------------------------------------------------------------


def list_leagues(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Leagues the caller organises or plays in (admins: every league), newest first."""
    q = db.query(League)
    if not is_admin(current_user):
        mine = db.query(LeagueMember.league_id).filter(LeagueMember.user_id == current_user.id)
        q = q.filter((League.organizer_id == current_user.id) | League.id.in_(mine))
    rows = q.order_by(League.created_at.desc(), League.id).all()
    return [summary(db, league, current_user) for league in rows]


def create_league(
    data: LeagueCreate,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Start a league. The organiser is not a member until they add themselves."""
    check_system(db, current_user, data.game_system_id)
    league = League(organizer_id=current_user.id, **data.model_dump())
    league.name = league.name.strip()
    db.add(league)
    db.commit()
    return detail(db, league, current_user)


def get_league_detail(
    league_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A league: its members and their armies, its games, and the standings."""
    return detail(db, get_league(db, league_id, current_user), current_user)


def update_league(
    league_id: str,
    data: LeagueUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change a league's details, scoring or status (organiser)."""
    league = get_league(db, league_id, current_user, manage=True)
    fields = data.model_dump(exclude_unset=True)
    if "game_system_id" in fields:
        check_system(db, current_user, fields["game_system_id"])
    if "name" in fields:
        fields["name"] = (fields["name"] or "").strip() or league.name
    for key in ("points_win", "points_draw", "points_loss", "status"):
        if key in fields and fields[key] is None:
            fields.pop(key)
    for key, value in fields.items():
        setattr(league, key, value)
    db.commit()
    return detail(db, league, current_user)


def delete_league(
    league_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a league with its members and games (organiser). Armies are untouched."""
    league = get_league(db, league_id, current_user, manage=True)
    db.query(LeagueGame).filter_by(league_id=league.id).delete(synchronize_session=False)
    db.query(LeagueMember).filter_by(league_id=league.id).delete(synchronize_session=False)
    db.delete(league)
    db.commit()
    return Response(status_code=204)


# --- Members --------------------------------------------------------------------


def eligible_members(
    league_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Users the organiser can add: anyone with a full account not already in."""
    league = get_league(db, league_id, current_user, manage=True)
    already = {m.user_id for m in db.query(LeagueMember).filter_by(league_id=league.id)}
    out = [
        {"id": user.id, "name": user.display_name or user.username}
        for user in db.query(User).all()
        if user.id not in already and is_eligible(user)
    ]
    return sorted(out, key=lambda u: u["name"].lower())


def add_member(
    league_id: str,
    data: MemberAdd,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a player (organiser). Adding someone already in changes nothing."""
    league = get_league(db, league_id, current_user, manage=True)
    user = db.query(User).filter_by(id=data.user_id).first()
    if not is_eligible(user):
        raise HTTPException(404, "User not found")
    if member(db, league.id, data.user_id) is None:
        db.add(LeagueMember(league_id=league.id, user_id=data.user_id))
        db.commit()
    return detail(db, league, current_user)


def remove_member(
    league_id: str,
    user_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The organiser removes anyone; a member may leave. Their games stay logged."""
    league = get_league(db, league_id, current_user)
    if user_id != current_user.id and not manages(league, current_user):
        raise HTTPException(403, "Only the league's organiser can remove members")
    row = member(db, league.id, user_id)
    if row is not None:
        db.delete(row)
        db.commit()
    return Response(status_code=204)


def set_member_army(
    league_id: str,
    user_id: str,
    data: MemberArmy,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Register the army a member plays - one of their own."""
    league = get_league(db, league_id, current_user)
    if user_id != current_user.id and not manages(league, current_user):
        raise HTTPException(403, "You can only choose your own army")
    row = member(db, league.id, user_id)
    if row is None:
        raise HTTPException(404, "Not a member of this league")
    if data.army_id:
        army = db.query(Army).filter_by(id=data.army_id).first()
        if army is None or army.user_id != user_id:
            raise HTTPException(400, "That army is not theirs")
    row.army_id = data.army_id or None
    db.commit()
    return detail(db, league, current_user)


# --- Games ------------------------------------------------------------------------


def _apply_game(db: Session, league: League, game: LeagueGame, data: GameIn) -> None:
    if data.player_a_id == data.player_b_id:
        raise HTTPException(400, "A game needs two different players")
    a = member(db, league.id, data.player_a_id)
    b = member(db, league.id, data.player_b_id)
    if a is None or b is None:
        raise HTTPException(400, "Both players must be members of the league")
    try:
        game.result = league_service.decide_result(data.score_a, data.score_b, data.result)
    except league_service.LeagueGameError as exc:
        raise HTTPException(400, str(exc)) from exc
    game.played_on = data.played_on
    game.mission = data.mission.strip()
    game.notes = data.notes
    game.score_a, game.score_b = data.score_a, data.score_b
    # A changed pairing takes the players' current armies; an unchanged one
    # keeps the armies the game was played with.
    if game.player_a_id != a.user_id:
        game.player_a_id, game.army_a_id = a.user_id, a.army_id
    if game.player_b_id != b.user_id:
        game.player_b_id, game.army_b_id = b.user_id, b.army_id


def _plays_in(league: League, data: GameIn, user: CurrentUser) -> None:
    """A member logs or edits only games they play in; the organiser, any."""
    if not manages(league, user) and user.id not in (data.player_a_id, data.player_b_id):
        raise HTTPException(403, "You can only log games you played in")


def log_game(
    league_id: str,
    data: GameIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Log a game. Members log their own games; the organiser logs any."""
    league = get_league(db, league_id, current_user)
    _plays_in(league, data, current_user)
    game = LeagueGame(
        league_id=league.id, recorded_by=current_user.id, player_a_id="", player_b_id=""
    )
    _apply_game(db, league, game, data)
    db.add(game)
    db.commit()
    return detail(db, league, current_user)


def _get_game(db: Session, league: League, game_id: str, user: CurrentUser) -> LeagueGame:
    game = db.query(LeagueGame).filter_by(id=game_id, league_id=league.id).first()
    if game is None:
        raise HTTPException(404, "Game not found")
    if not can_edit_game(league, game, user):
        raise HTTPException(403, "Only the organiser or the game's players can change it")
    return game


def update_game(
    league_id: str,
    game_id: str,
    data: GameIn,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Edit a game (its players, whoever logged it, or the organiser)."""
    league = get_league(db, league_id, current_user)
    game = _get_game(db, league, game_id, current_user)
    _plays_in(league, data, current_user)
    _apply_game(db, league, game, data)
    db.commit()
    return detail(db, league, current_user)


def delete_game(
    league_id: str,
    game_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete a game (its players, whoever logged it, or the organiser)."""
    league = get_league(db, league_id, current_user)
    db.delete(_get_game(db, league, game_id, current_user))
    db.commit()
    return Response(status_code=204)
