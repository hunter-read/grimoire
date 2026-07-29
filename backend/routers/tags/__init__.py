"""Tags package — registers the shared-tag routes on a single router (issue #235)."""
from fastapi import APIRouter

from .core import (
    create_tag,
    delete_tag,
    list_tags,
    merge_tag,
    tag_items,
    update_tag_display,
)

router = APIRouter(prefix="/tags", tags=["tags"])

router.add_api_route("", list_tags, methods=["GET"], summary="List tags")
router.add_api_route("", create_tag, methods=["POST"], summary="Create a tag", status_code=201)
router.add_api_route(
    "/{internal}/items", tag_items, methods=["GET"], summary="Items carrying a tag"
)
router.add_api_route(
    "/{internal}", update_tag_display, methods=["PATCH"], summary="Rename a tag's display value"
)
router.add_api_route(
    "/{internal}/merge", merge_tag, methods=["POST"], summary="Merge a tag into another"
)
router.add_api_route(
    "/{internal}", delete_tag, methods=["DELETE"], summary="Delete a tag", status_code=204
)
