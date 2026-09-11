"""Tags package — registers the shared-tag routes on a single router (issue #235)."""
from fastapi import APIRouter

from ._schemas import (
    TagCreatedResponse,
    TagItemsResponse,
    TagRenamedResponse,
    TagsResponse,
)
from .core import (
    create_tag,
    delete_tag,
    list_tags,
    merge_tag,
    tag_items,
    update_tag_display,
)

router = APIRouter(prefix="/tags", tags=["tags"])

# A tag's internal key may contain a slash: tags created before slashes were
# rejected (issue #430 — someone typing "Storage/Box1" out of subtag habit), or
# applied from a `tags.json`, which Grimoire treats as read-only and does not
# validate. `encodeURIComponent` sends that as %2F, but the ASGI server
# percent-decodes before routing, so a plain `{internal}` matches nothing and
# such a tag cannot be viewed, renamed, or deleted. `:path` matches across
# slashes, keeping those tags reachable so they can be cleaned up.
#
# `:path` is greedy, but the `/items` and `/merge` suffix routes are still
# matched: Starlette tries routes in declaration order, and `/items` is declared
# first, while `/merge` is the only POST here (the greedy routes are PATCH and
# DELETE), so neither is swallowed.

router.add_api_route(
    "", list_tags, methods=["GET"], summary="List tags", response_model=TagsResponse
)
router.add_api_route(
    "",
    create_tag,
    methods=["POST"],
    summary="Create a tag",
    status_code=201,
    response_model=TagCreatedResponse,
)
router.add_api_route(
    "/{internal:path}/items",
    tag_items,
    methods=["GET"],
    summary="Items carrying a tag",
    response_model=TagItemsResponse,
)
router.add_api_route(
    "/{internal:path}",
    update_tag_display,
    methods=["PATCH"],
    summary="Rename a tag's display value",
    response_model=TagRenamedResponse,
)
router.add_api_route(
    "/{internal:path}/merge",
    merge_tag,
    methods=["POST"],
    summary="Merge a tag into another",
    response_model=TagRenamedResponse,
)
router.add_api_route(
    "/{internal:path}", delete_tag, methods=["DELETE"], summary="Delete a tag", status_code=204
)
