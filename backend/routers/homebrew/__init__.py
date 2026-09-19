"""Homebrew package — user-authored catalog entries, visibility-scoped."""
from fastapi import APIRouter

from ._schemas import (
    HomebrewDeletedResponse,
    HomebrewDetail,
    HomebrewImportResponse,
    HomebrewListResponse,
    HomebrewPack,
)
from .core import (
    create_homebrew,
    delete_homebrew,
    export_homebrew,
    fork_entry,
    get_homebrew,
    import_homebrew,
    list_homebrew,
    share_homebrew,
    update_homebrew,
)

router = APIRouter(prefix="/homebrew", tags=["homebrew"])

__all__ = ["router"]

# Literal segments before /{entry_row_id}, so they are not swallowed by it.
router.add_api_route(
    "",
    list_homebrew,
    methods=["GET"],
    summary="List homebrew this user can see",
    response_model=HomebrewListResponse,
)
router.add_api_route(
    "",
    create_homebrew,
    methods=["POST"],
    summary="Create a homebrew entry",
    response_model=HomebrewDetail,
)
router.add_api_route(
    "/fork",
    fork_entry,
    methods=["POST"],
    summary="Fork a catalog entry into homebrew",
    response_model=HomebrewDetail,
)
router.add_api_route(
    "/export",
    export_homebrew,
    methods=["GET"],
    summary="Export this user's homebrew as a pack",
    response_model=HomebrewPack,
    # `$schema` is an alias, and a pack is only recognisable with it.
    response_model_by_alias=True,
)
router.add_api_route(
    "/import",
    import_homebrew,
    methods=["POST"],
    summary="Import a homebrew pack",
    response_model=HomebrewImportResponse,
)
router.add_api_route(
    "/{entry_row_id}",
    get_homebrew,
    methods=["GET"],
    summary="One homebrew entry",
    response_model=HomebrewDetail,
)
router.add_api_route(
    "/{entry_row_id}",
    update_homebrew,
    methods=["PUT"],
    summary="Edit a homebrew entry",
    response_model=HomebrewDetail,
)
router.add_api_route(
    "/{entry_row_id}/share",
    share_homebrew,
    methods=["PATCH"],
    summary="Change an entry's visibility",
    response_model=HomebrewDetail,
)
router.add_api_route(
    "/{entry_row_id}",
    delete_homebrew,
    methods=["DELETE"],
    summary="Delete a homebrew entry",
    response_model=HomebrewDeletedResponse,
)
