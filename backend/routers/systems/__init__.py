"""Systems package — registers all game system routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    get_system,
    list_book_folders,
    list_systems,
    update_book_folder,
    update_system,
)
from .metadata import fetch_metadata, list_metadata_sources, search_metadata

router = APIRouter(prefix="/systems", tags=["systems"])

# Browsing systems and their book lists is library browsing — blocked for guests.
router.add_api_route(
    "",
    list_systems,
    methods=["GET"],
    summary="List all game systems",
    description="Returns all game systems with book counts, tags, genre, and mechanics.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/{system_id}",
    get_system,
    methods=["GET"],
    summary="Get a game system",
    description=(
        "Returns full details for a game system including all associated books "
        "grouped by category."
    ),
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/{system_id}/book-folders",
    list_book_folders,
    methods=["GET"],
    summary="List book folders",
    description=(
        "Returns all known book subcategory folder paths for a system and "
        "their associated tags."
    ),
)
router.add_api_route(
    "/{system_id}/book-folders",
    update_book_folder,
    methods=["PATCH"],
    summary="Set tags on a book folder",
    description=(
        "Creates or replaces the tag list for a book subcategory folder. GM or "
        "admin role required."
    ),
)
router.add_api_route(
    "/{system_id}",
    update_system,
    methods=["PATCH"],
    summary="Update game system metadata",
    description="Updates editable fields on a game system. GM or admin role required.",
)

# Add-on metadata lookup (issue #203).  All three are read-only — they report
# what a source offers and how it compares to the system's current values, and
# never write.  Applying goes through PATCH /systems/{id} above, so a fetch can
# never overwrite anything on its own.
router.add_api_route(
    "/{system_id}/metadata-sources",
    list_metadata_sources,
    methods=["GET"],
    summary="List metadata sources",
    description=(
        "Returns installed, enabled add-ons that can supply game system "
        "metadata. GM or admin role required."
    ),
)
router.add_api_route(
    "/{system_id}/metadata-search",
    search_metadata,
    methods=["POST"],
    summary="Search a metadata source",
    description=(
        "Returns ranked candidate matches for this system from one add-on. An "
        "empty query defaults to the system's name. GM or admin role required."
    ),
)
router.add_api_route(
    "/{system_id}/metadata-fetch",
    fetch_metadata,
    methods=["POST"],
    summary="Fetch metadata for review",
    description=(
        "Fetches one candidate's fields and diffs them against the system's "
        "current values. Writes nothing. GM or admin role required."
    ),
)
