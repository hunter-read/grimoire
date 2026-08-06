"""Books package — registers all book routes on a single router."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import (
    list_books,
    get_book,
    update_book,
    bulk_update_books,
    bulk_add_book_tags,
    reindex_book,
    rescan_book,
    serve_book_file,
    serve_book_thumbnail,
)
from .metadata import (
    fetch_metadata,
    list_metadata_sources,
    search_metadata,
)
from .pages import get_book_toc, serve_book_page, get_page_text, get_page_words
from ._helpers import _invalidate_book_cache  # re-exported for library.py

router = APIRouter(prefix="/books", tags=["books"])

__all__ = ["router", "_invalidate_book_cache"]

# Browsing the whole book library is blocked for guests. Reading an individual
# book by id is allowed, but the file/thumbnail/page/toc/text/words handlers each
# enforce access themselves (via _assert_book_access): guests are limited to books
# shared into their campaign, and explicit books are gated on allow_explicit.
router.add_api_route(
    "", list_books, methods=["GET"], summary="List books",
    dependencies=[Depends(require_not_guest)],
)
router.add_api_route("/{book_id}", get_book, methods=["GET"], summary="Get a book")
router.add_api_route("/{book_id}", update_book, methods=["PATCH"], summary="Update book metadata")
# Bulk routes (issue #270). Applying a selection one PATCH per item raced on tag
# creation and 500'd; these take the whole batch in one transaction.
router.add_api_route(
    "/bulk",
    bulk_update_books,
    methods=["POST"],
    summary="Bulk update books",
    description=(
        "Applies per-book edits for many books in one transaction. "
        "Body: {items: [{id, ...BookUpdate fields}]}. Unknown ids are reported in "
        "`errors` and skipped. GM or admin role required."
    ),
)
router.add_api_route(
    "/bulk/tags",
    bulk_add_book_tags,
    methods=["POST"],
    summary="Bulk add tags to books",
    description=(
        "Additively applies tags to many books in one transaction. "
        "Body: {ids: [...], tags: [...]}. GM or admin role required."
    ),
)
router.add_api_route(
    "/{book_id}/reindex",
    reindex_book,
    methods=["POST"],
    summary="Re-run OCR on a book (optional DPI override)",
)
router.add_api_route(
    "/{book_id}/rescan",
    rescan_book,
    methods=["POST"],
    summary="Re-read a book from disk and rebuild its search index",
)
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

# Add-on metadata lookup (issue #203).  Read-only — they report what a source
# offers and how it compares to the book's current values, never writing.
# Applying goes through PATCH /books/{id} above.
router.add_api_route(
    "/{book_id}/metadata-sources",
    list_metadata_sources,
    methods=["GET"],
    summary="List metadata sources",
    description=(
        "Returns installed, enabled add-ons that can supply book metadata. "
        "GM or admin role required."
    ),
)
router.add_api_route(
    "/{book_id}/metadata-search",
    search_metadata,
    methods=["POST"],
    summary="Search a metadata source",
    description=(
        "Returns ranked candidate matches for this book from one add-on. An "
        "empty query defaults to the book's title. GM or admin role required."
    ),
)
router.add_api_route(
    "/{book_id}/metadata-fetch",
    fetch_metadata,
    methods=["POST"],
    summary="Fetch metadata for review",
    description=(
        "Fetches one candidate's fields and diffs them against the book's "
        "current values. Writes nothing. GM or admin role required."
    ),
)
