"""Leagues package - a group playing a wargame over time. Not for guests."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from ._schemas import EligibleMember, LeagueDetail, LeagueSummary
from .core import (
    add_member,
    create_league,
    delete_game,
    delete_league,
    eligible_members,
    get_league_detail,
    list_leagues,
    log_game,
    remove_member,
    set_member_army,
    update_game,
    update_league,
)

router = APIRouter(
    prefix="/leagues",
    tags=["leagues"],
    # Guests are scoped to the campaign they were invited to and have no leagues.
    dependencies=[Depends(require_not_guest)],
)

__all__ = ["router"]

router.add_api_route(
    "",
    list_leagues,
    methods=["GET"],
    summary="List your leagues",
    response_model=list[LeagueSummary],
)
router.add_api_route(
    "",
    create_league,
    methods=["POST"],
    summary="Create a league (GM/admin)",
    status_code=201,
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}",
    get_league_detail,
    methods=["GET"],
    summary="Get a league",
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}",
    update_league,
    methods=["PATCH"],
    summary="Update a league",
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}", delete_league, methods=["DELETE"], summary="Delete a league", status_code=204
)
router.add_api_route(
    "/{league_id}/eligible-members",
    eligible_members,
    methods=["GET"],
    summary="Users the organiser can add",
    description="Anyone with a full account (not a guest) who is not already a member.",
    response_model=list[EligibleMember],
)
router.add_api_route(
    "/{league_id}/members",
    add_member,
    methods=["POST"],
    summary="Add a member",
    status_code=201,
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}/members/{user_id}",
    remove_member,
    methods=["DELETE"],
    summary="Remove a member, or leave",
    status_code=204,
)
router.add_api_route(
    "/{league_id}/members/{user_id}/army",
    set_member_army,
    methods=["PUT"],
    summary="Register the army a member plays",
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}/games",
    log_game,
    methods=["POST"],
    summary="Log a game",
    description=(
        "A member logs games they played in; the organiser logs any. Give both scores and "
        "`result` (`a`, `b` or `draw`, from player A's side) follows from them; without "
        "scores, `result` is required."
    ),
    status_code=201,
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}/games/{game_id}",
    update_game,
    methods=["PUT"],
    summary="Edit a game",
    description="Its players, whoever logged it, or the organiser.",
    response_model=LeagueDetail,
)
router.add_api_route(
    "/{league_id}/games/{game_id}",
    delete_game,
    methods=["DELETE"],
    summary="Delete a game",
    status_code=204,
)
