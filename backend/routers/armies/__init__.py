"""Armies package - the army builder for wargames. Not for guests."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from ._schemas import (
    ArmyDetail,
    ArmyPublication,
    ArmySummary,
    BookMatch,
    PublicationLinkOut,
    UnitProgress,
)
from .core import (
    army_publications,
    create_army,
    delete_army,
    delete_publication_link,
    export_army,
    get_army_detail,
    import_army,
    list_armies,
    search_link_books,
    set_publication_link,
    update_army,
    update_unit_progress,
)

router = APIRouter(
    prefix="/armies",
    tags=["armies"],
    # Guests are scoped to the campaign they were invited to and have no armies.
    dependencies=[Depends(require_not_guest)],
)

__all__ = ["router"]

router.add_api_route(
    "", list_armies, methods=["GET"], summary="List your armies", response_model=list[ArmySummary]
)
router.add_api_route(
    "",
    create_army,
    methods=["POST"],
    summary="Build an army by hand",
    status_code=201,
    response_model=ArmyDetail,
)
router.add_api_route(
    "/import",
    import_army,
    methods=["POST"],
    summary="Import a BattleScribe roster",
    description=(
        "Upload a `.ros` or `.rosz` roster from BattleScribe or New Recruit. Its game system "
        "and faction are matched to the library's wargames when they can be; the file is kept "
        "so `export?format=roster` hands it back unchanged."
    ),
    status_code=201,
    response_model=ArmyDetail,
)
# Declared ahead of "/{army_id}", which would otherwise take them as an id.
router.add_api_route(
    "/publication-links",
    set_publication_link,
    methods=["PUT"],
    summary="Link a cited publication to a library book (GM/admin)",
    description=(
        "Shared by every army whose roster cites `publication` under `system_name` (the "
        "roster's game system name, matched ignoring case). `page_offset` is added to a "
        "cited page to reach the PDF page."
    ),
    response_model=PublicationLinkOut,
)
router.add_api_route(
    "/publication-links",
    delete_publication_link,
    methods=["DELETE"],
    summary="Remove a publication link (GM/admin)",
    status_code=204,
)
router.add_api_route(
    "/publication-links/books",
    search_link_books,
    methods=["GET"],
    summary="Find wargame books to link a publication to (GM/admin)",
    response_model=list[BookMatch],
)
router.add_api_route(
    "/{army_id}", get_army_detail, methods=["GET"], summary="Get an army", response_model=ArmyDetail
)
router.add_api_route(
    "/{army_id}", update_army, methods=["PATCH"], summary="Update an army", response_model=ArmyDetail
)
router.add_api_route(
    "/{army_id}", delete_army, methods=["DELETE"], summary="Delete an army", status_code=204
)
router.add_api_route(
    "/{army_id}/units/{unit_id}/progress",
    update_unit_progress,
    methods=["PUT"],
    summary="Set a unit's experience, honours and notes",
    response_model=UnitProgress,
)
router.add_api_route(
    "/{army_id}/export",
    export_army,
    methods=["GET"],
    summary="Export an army as its roster file or as text",
)
router.add_api_route(
    "/{army_id}/publications",
    army_publications,
    methods=["GET"],
    summary="The publications an army cites, and their library links",
    response_model=list[ArmyPublication],
)
