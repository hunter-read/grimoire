"""Bookmarks package — registers all bookmark routes on a single router."""
from fastapi import APIRouter

from .core import list_bookmarks, create_bookmark, update_bookmark, delete_bookmark
from ._schemas import BookmarkOut, StatusResponse

router = APIRouter(prefix="/bookmarks", tags=["bookmarks"])

router.add_api_route(
    "",
    list_bookmarks,
    methods=["GET"],
    summary="List bookmarks for a book",
    response_model=list[BookmarkOut],
)
router.add_api_route(
    "",
    create_bookmark,
    methods=["POST"],
    summary="Create a bookmark",
    status_code=201,
    response_model=BookmarkOut,
)
router.add_api_route(
    "/{bookmark_id}",
    update_bookmark,
    methods=["PATCH"],
    summary="Update bookmark label",
    response_model=BookmarkOut,
)
router.add_api_route(
    "/{bookmark_id}",
    delete_bookmark,
    methods=["DELETE"],
    summary="Delete a bookmark",
    response_model=StatusResponse,
)
