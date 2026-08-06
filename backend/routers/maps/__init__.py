"""Maps package — registers all map routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    list_maps,
    list_map_folders,
    update_map_folder,
    bulk_update_map_folders,
    get_map,
    serve_map_file,
    serve_map_page,
    serve_map_thumbnail,
    update_map,
    bulk_update_maps,
    bulk_add_map_tags,
)

router = APIRouter(tags=["maps"])

# Browsing the whole map library is blocked for guests. Serving an individual
# map/thumbnail by id is allowed, but the get/file/thumbnail handlers enforce
# access themselves (via assert_media_access): guests are limited to maps shared
# into their campaign.
router.add_api_route(
    "/maps",
    list_maps,
    methods=["GET"],
    summary="List maps",
    description="Returns a paginated list of maps. Filter by `map_type` or `folder`.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/map-folders",
    list_map_folders,
    methods=["GET"],
    summary="List map folders",
    description="Returns all known map folder paths and their associated tags.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/map-folders",
    update_map_folder,
    methods=["PATCH"],
    summary="Set tags on a map folder",
    description="Creates or replaces the tag list for a folder path. GM or admin role required.",
)
router.add_api_route(
    "/maps/{map_id}",
    get_map,
    methods=["GET"],
    summary="Get a map",
    description="Returns full map metadata including pixel dimensions, DPI, detected grid size, and folder tags.",
)
router.add_api_route(
    "/maps/{map_id}/file",
    serve_map_file,
    methods=["GET"],
    summary="Download map file",
    description="Streams the original map image or PDF. Accepts `?token=` for browser-embedded images.",
)
router.add_api_route(
    "/maps/{map_id}/page/{page_num}",
    serve_map_page,
    methods=["GET"],
    summary="Render a map page",
    description="Renders a single page of a PDF map to WebP (`?width=` sets the target pixel width, default 1600, max 3000). Image maps are streamed as-is and only accept page 1. Accepts `?token=` for browser-embedded images.",
)
router.add_api_route(
    "/maps/{map_id}/thumbnail",
    serve_map_thumbnail,
    methods=["GET"],
    summary="Map thumbnail",
    description="Returns the pregenerated WebP thumbnail for a map. 404 if not yet generated.",
)
router.add_api_route(
    "/maps/{map_id}",
    update_map,
    methods=["PATCH"],
    summary="Update map metadata",
    description="Updates editable fields on a map (description, tags, map_type, grid_size). GM or admin role required.",
)
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/maps/bulk",
    bulk_update_maps,
    methods=["POST"],
    summary="Bulk update maps",
    description=(
        "Applies per-map edits for many maps in one transaction. "
        "Body: {items: [{id, description?, tags?, map_type?, grid_size?}]}. Unknown "
        "ids are reported in `errors` and skipped. GM or admin role required."
    ),
)
router.add_api_route(
    "/maps/bulk/tags",
    bulk_add_map_tags,
    methods=["POST"],
    summary="Bulk add tags to maps",
    description=(
        "Additively applies tags to many maps in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
)
router.add_api_route(
    "/map-folders/bulk",
    bulk_update_map_folders,
    methods=["POST"],
    summary="Bulk set map folder tags",
    description=(
        "Sets tags on many map folders in one transaction. "
        "Body: {folders: [{path, tags}]}. GM or admin role required."
    ),
)
