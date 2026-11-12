"""Leagues package - a group playing a wargame over time. A league's guests use it; a campaign's do not."""
from fastapi import APIRouter, Depends

from ... import api_keys
from ...auth import require_wargame_access
from ._schemas import (
    BookSearchResult,
    EligibleMember,
    GuestShareTemplate,
    LeagueBook,
    LeagueDetail,
    LeagueGuest,
    LeagueSummary,
)
from .books import add_book, list_books, remove_book, reorder_books, search_books, update_book
from .guests import (
    create_guest,
    guest_share_template,
    list_guests,
    regenerate_guest_code,
    remove_guest,
)
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
    # A guest invited to a campaign reaches only campaigns and characters.
    dependencies=[Depends(require_wargame_access)],
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


# --- Guests (organiser) ----------------------------------------------------------

router.add_api_route(
    "/{league_id}/guests",
    list_guests,
    methods=["GET"],
    summary="List the league's guests",
    response_model=list[LeagueGuest],
    # Guest invite codes are logins: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/{league_id}/guests",
    create_guest,
    methods=["POST"],
    summary="Invite a guest",
    description=(
        "Makes a code-only guest account and adds it to the league. The guest signs in "
        "with the code at `POST /api/auth/guest-login` and reaches leagues and their own "
        "armies only. Needs guest access on."
    ),
    status_code=201,
    response_model=LeagueGuest,
    # Guest invite codes are logins: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/{league_id}/guests/{user_id}/regenerate",
    regenerate_guest_code,
    methods=["POST"],
    summary="Give a guest a new code",
    description="The old code stops working and the guest's sessions end.",
    response_model=LeagueGuest,
    # Guest invite codes are logins: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/{league_id}/guests/{user_id}/share",
    guest_share_template,
    methods=["GET"],
    summary="Invite text for a guest's code",
    response_model=GuestShareTemplate,
    # Guest invite codes are logins: session only, never a key.
    openapi_extra=api_keys.EXCLUDED,
)
router.add_api_route(
    "/{league_id}/guests/{user_id}",
    remove_guest,
    methods=["DELETE"],
    summary="Remove a guest from the league",
    description=(
        "The guest leaves the league; their account and armies stay, and they can still "
        "sign in to them. An admin deletes the account from the guest list."
    ),
    status_code=204,
)

# --- Books ------------------------------------------------------------------------

router.add_api_route(
    "/{league_id}/books",
    list_books,
    methods=["GET"],
    summary="Books shared with the league",
    description=(
        "The organiser sees every one, with who a private one is shared with; a member "
        "sees the public ones and the private ones shared with them."
    ),
    response_model=list[LeagueBook],
)
router.add_api_route(
    "/{league_id}/books",
    add_book,
    methods=["POST"],
    summary="Share a book with the league (organiser)",
    status_code=201,
    response_model=LeagueBook,
)
router.add_api_route(
    "/{league_id}/books/search",
    search_books,
    methods=["GET"],
    summary="Find library books to share (organiser)",
    response_model=list[BookSearchResult],
)
router.add_api_route(
    "/{league_id}/books/order",
    reorder_books,
    methods=["PUT"],
    summary="Reorder the league's books (organiser)",
    status_code=204,
)
router.add_api_route(
    "/{league_id}/books/{resource_id}",
    update_book,
    methods=["PATCH"],
    summary="Change who a shared book reaches (organiser)",
    response_model=LeagueBook,
)
router.add_api_route(
    "/{league_id}/books/{resource_id}",
    remove_book,
    methods=["DELETE"],
    summary="Stop sharing a book (organiser)",
    status_code=204,
)
