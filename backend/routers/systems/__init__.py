"""Systems package — registers all game system routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    delete_book_folder,
    get_system,
    list_book_folders,
    list_systems,
    update_book_folder,
    update_system,
    bulk_update_systems,
    bulk_add_system_tags,
)
from .covers import delete_system_cover, serve_system_cover, upload_system_cover
from .metadata import fetch_metadata, list_metadata_sources, search_metadata
from .._bulk_schemas import BulkResult, BulkTagResult
from .._metadata_lookup import (
    MetadataFetchResponse,
    MetadataSearchResponse,
    MetadataSourcesResponse,
)
from ._schemas import (
    BookFoldersResponse,
    BookFolderOut,
    StatusResponse,
    SystemCoverResponse,
    SystemDetail,
    SystemSummary,
)

router = APIRouter(prefix="/systems", tags=["systems"])

# Browsing systems and their book lists is library browsing — blocked for guests.
router.add_api_route(
    "",
    list_systems,
    methods=["GET"],
    summary="List all game systems",
    description=(
        "Returns all game systems with book counts, tags, genre, and mechanics. "
        "Systems nested inside a container folder are omitted by default; pass "
        "`parent_id` to list one container's children, or `include_children=true` "
        "for a flat list of everything."
    ),
    dependencies=[Depends(require_not_guest)],
    response_model=list[SystemSummary],
)
router.add_api_route(
    "/{system_id}",
    get_system,
    methods=["GET"],
    summary="Get a game system",
    description=(
        "Returns full details for a game system including all associated books "
        "grouped by category. For a container folder, `children` holds the "
        "systems nested inside it."
    ),
    dependencies=[Depends(require_not_guest)],
    response_model=SystemDetail,
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
    response_model=BookFoldersResponse,
)
router.add_api_route(
    "/{system_id}/book-folders",
    update_book_folder,
    methods=["PATCH"],
    summary="Set tags on a book folder",
    description=(
        "Creates or replaces the tag list for a book subcategory folder. `path` "
        "must be `{system_id}/{category}/{subfolder...}` for this system. GM or "
        "admin role required."
    ),
    response_model=BookFolderOut,
)
router.add_api_route(
    "/{system_id}/book-folders",
    delete_book_folder,
    methods=["DELETE"],
    summary="Delete a book folder",
    description=(
        "Removes a book subcategory folder row and its tags. Pass the folder's "
        "`path` as a query parameter. GM or admin role required."
    ),
    response_model=StatusResponse,
)
router.add_api_route(
    "/{system_id}",
    update_system,
    methods=["PATCH"],
    summary="Update game system metadata",
    description="Updates editable fields on a game system. GM or admin role required.",
    response_model=StatusResponse,
)
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/bulk",
    bulk_update_systems,
    methods=["POST"],
    summary="Bulk update game systems",
    description=(
        "Applies per-system edits for many systems in one transaction. "
        "Body: {items: [{id, ...GameSystemUpdate fields}]}. Unknown ids and name "
        "clashes are reported in `errors` and skipped. GM or admin role required."
    ),
    response_model=BulkResult,
)
router.add_api_route(
    "/bulk/tags",
    bulk_add_system_tags,
    methods=["POST"],
    summary="Bulk add tags to game systems",
    description=(
        "Additively applies tags to many systems in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
    response_model=BulkTagResult,
)

# Cover art. A ``cover.*``/``folder.*`` image in the system's library folder wins
# over an upload; container folders (issues #261/#262) hold no books to derive a
# thumbnail from, so these are their only source of art.
router.add_api_route(
    "/{system_id}/cover",
    serve_system_cover,
    methods=["GET"],
    summary="System cover image",
    description=(
        "Serves the system's folder cover art or uploaded cover image. 404 when "
        "the system has neither (clients fall back to `cover_book_id`)."
    ),
)
router.add_api_route(
    "/{system_id}/cover",
    upload_system_cover,
    methods=["POST"],
    summary="Upload a system cover",
    description=(
        "Stores a cover image for the system. PNG/JPEG/WebP/GIF, max 10 MB. A "
        "`cover.*` file in the system's library folder still takes precedence. "
        "GM or admin role required."
    ),
    response_model=SystemCoverResponse,
)
router.add_api_route(
    "/{system_id}/cover",
    delete_system_cover,
    methods=["DELETE"],
    summary="Remove an uploaded system cover",
    description=(
        "Deletes the uploaded cover image. Folder cover art is library-managed "
        "and is not affected. GM or admin role required."
    ),
    response_model=StatusResponse,
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
    response_model=MetadataSourcesResponse,
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
    response_model=MetadataSearchResponse,
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
    response_model=MetadataFetchResponse,
)
