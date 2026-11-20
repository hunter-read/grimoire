"""Compendium package - a library system's rules content (issue #835)."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest

from ._schemas import (
    CompendiumBrowseResponse,
    CompendiumEntryDetail,
    CompendiumSearchResponse,
    CompendiumSummary,
)
from .core import (
    browse_compendium,
    get_compendium,
    get_compendium_entry,
    search_compendiums,
    search_system_compendium,
    update_links,
)

router = APIRouter(
    tags=["compendium"],
    # A compendium is part of the library, which no guest reaches: a guest
    # sees only the campaign or league they were invited to.
    dependencies=[Depends(require_not_guest)],
)

__all__ = ["router"]

router.add_api_route(
    "/compendium/search",
    search_compendiums,
    methods=["GET"],
    summary="Search the compendium of every system you can see",
    response_model=CompendiumSearchResponse,
)
router.add_api_route(
    "/systems/{system_id}/compendium",
    get_compendium,
    methods=["GET"],
    summary="A system's linked packs and sheets, and the content types they hold",
    response_model=CompendiumSummary,
)
router.add_api_route(
    "/systems/{system_id}/compendium/links",
    update_links,
    methods=["PUT"],
    summary="Link content packs and character sheets to a system (GM or admin)",
    response_model=CompendiumSummary,
)
# Literal segments before /{content_type}, so they are not swallowed by it.
router.add_api_route(
    "/systems/{system_id}/compendium/search",
    search_system_compendium,
    methods=["GET"],
    summary="Search every content type in a system's compendium",
    response_model=CompendiumSearchResponse,
)
router.add_api_route(
    "/systems/{system_id}/compendium/{content_type}",
    browse_compendium,
    methods=["GET"],
    summary="Browse one content type in a system's compendium",
    response_model=CompendiumBrowseResponse,
)
router.add_api_route(
    "/systems/{system_id}/compendium/{content_type}/{entry_id}",
    get_compendium_entry,
    methods=["GET"],
    summary="One compendium entry",
    response_model=CompendiumEntryDetail,
)
