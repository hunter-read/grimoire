"""Tokens package — registers all token routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    list_tokens,
    list_token_folders,
    update_token_folder,
    bulk_update_token_folders,
    get_token,
    serve_token_file,
    serve_token_thumbnail,
    update_token,
    bulk_update_tokens,
    bulk_add_token_tags,
)

router = APIRouter(tags=["tokens"])

# Browsing the whole token library is blocked for guests. Serving an individual
# token/thumbnail by id is allowed, but the get/file/thumbnail handlers enforce
# access themselves (via assert_media_access): guests are limited to tokens shared
# into their campaign, and explicit tokens are gated on allow_explicit.
router.add_api_route(
    "/tokens",
    list_tokens,
    methods=["GET"],
    summary="List tokens",
    description="Returns a paginated list of tokens.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/token-folders",
    list_token_folders,
    methods=["GET"],
    summary="List token folders",
    description="Returns all known token folder paths and their associated tags.",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route(
    "/token-folders",
    update_token_folder,
    methods=["PATCH"],
    summary="Set tags on a token folder",
    description="Creates or replaces the tag list for a folder path. GM or admin role required.",
)
router.add_api_route(
    "/tokens/{token_id}",
    get_token,
    methods=["GET"],
    summary="Get a token",
    description="Returns full token metadata including folder tags.",
)
router.add_api_route(
    "/tokens/{token_id}/file",
    serve_token_file,
    methods=["GET"],
    summary="Download token file",
    description="Streams the original token image.",
)
router.add_api_route(
    "/tokens/{token_id}/thumbnail",
    serve_token_thumbnail,
    methods=["GET"],
    summary="Token thumbnail",
    description="Returns the pregenerated WebP thumbnail for a token. 404 if not yet generated.",
)
router.add_api_route(
    "/tokens/{token_id}",
    update_token,
    methods=["PATCH"],
    summary="Update token metadata",
    description="Updates editable fields on a token (description, tags). GM or admin role required.",
)
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/tokens/bulk",
    bulk_update_tokens,
    methods=["POST"],
    summary="Bulk update tokens",
    description=(
        "Applies per-token edits for many tokens in one transaction. "
        "Body: {items: [{id, description?, tags?, is_explicit?}]}. Unknown ids are "
        "reported in `errors` and skipped. GM or admin role required."
    ),
)
router.add_api_route(
    "/tokens/bulk/tags",
    bulk_add_token_tags,
    methods=["POST"],
    summary="Bulk add tags to tokens",
    description=(
        "Additively applies tags to many tokens in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
)
router.add_api_route(
    "/token-folders/bulk",
    bulk_update_token_folders,
    methods=["POST"],
    summary="Bulk set token folder tags",
    description=(
        "Sets tags on many token folders in one transaction. "
        "Body: {folders: [{path, tags}]}. GM or admin role required."
    ),
)
