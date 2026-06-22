"""Books package — registers all book routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import list_books, get_book, update_book, serve_book_file, serve_book_thumbnail
from .pages import get_book_toc, serve_book_page, get_page_text, get_page_words
from ._helpers import _invalidate_book_cache  # re-exported for library.py

router = APIRouter(prefix="/books", tags=["books"])

# Browsing the whole book library is blocked for guests; reading an individual
# book shared into their campaign (by id) is not.
router.add_api_route(
    "", list_books, methods=["GET"], summary="List books",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route("/{book_id}", get_book, methods=["GET"], summary="Get a book")
router.add_api_route("/{book_id}", update_book, methods=["PATCH"], summary="Update book metadata")
router.add_api_route(
    "/{book_id}/file", serve_book_file, methods=["GET"], summary="Download book file"
)
router.add_api_route(
    "/{book_id}/thumbnail", serve_book_thumbnail, methods=["GET"], summary="Book cover thumbnail"
)
router.add_api_route(
    "/{book_id}/toc", get_book_toc, methods=["GET"], summary="PDF table of contents"
)
router.add_api_route(
    "/{book_id}/page/{page_num}",
    serve_book_page,
    methods=["GET"],
    summary="Render a PDF page as WebP",
)
router.add_api_route(
    "/{book_id}/page/{page_num}/text", get_page_text, methods=["GET"], summary="Get page text"
)
router.add_api_route(
    "/{book_id}/page/{page_num}/words",
    get_page_words,
    methods=["GET"],
    summary="Get page word bounding boxes",
)
