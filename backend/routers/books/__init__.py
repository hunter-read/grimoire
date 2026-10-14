"""Books package — registers all book routes on a single router."""
from fastapi import APIRouter, Depends

from ... import api_keys
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
from .export import detect_book_page_shapes, export_book, get_book_page_size, save_book_export
from ._helpers import _invalidate_book_cache  # re-exported for library.py
from .._bulk_schemas import BulkResult, BulkTagResult
from .._page_export import DetectShapesResponse, PageSizeResponse, SaveExportResponse
from .._metadata_lookup import (
    MetadataFetchResponse,
    MetadataSearchResponse,
    MetadataSourcesResponse,
)
from ._schemas import (
    BookDetail,
    BookListResponse,
    PageTextResponse,
    PageWordsResponse,
    ReindexResponse,
    StatusResponse,
    TocResponse,
)

router = APIRouter(prefix="/books", tags=["books"])

__all__ = ["router", "_invalidate_book_cache"]

# Browsing the whole book library is blocked for guests. Reading an individual
# book by id is allowed, but the file/thumbnail/page/toc/text/words handlers each
# enforce access themselves (via _assert_book_access): guests are limited to books
# shared into their campaign, and explicit books are gated on allow_explicit.
router.add_api_route(
    "", list_books, methods=["GET"], summary="List books",
    description=(
        "Pages through the books the caller can see. `sort=added_at` lists newest "
        "first (pass `order=asc` for oldest first) and `added_since` (ISO-8601, "
        "UTC if no offset) keeps only books added at or after that moment - poll "
        "with both to find new additions. Books added before dates were tracked "
        "have a null `added_at`, sort last, and never match `added_since`."
    ),
    dependencies=[Depends(require_not_guest)],
    response_model=BookListResponse,
)
router.add_api_route(
    "/{book_id}", get_book, methods=["GET"], summary="Get a book", response_model=BookDetail
)
router.add_api_route(
    "/{book_id}",
    update_book,
    methods=["PATCH"],
    summary="Update book metadata",
    response_model=StatusResponse,
)
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
    response_model=BulkResult,
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
    response_model=BulkTagResult,
)
router.add_api_route(
    "/{book_id}/reindex",
    reindex_book,
    methods=["POST"],
    summary="Re-run OCR on a book (optional DPI override)",
    response_model=ReindexResponse,
)
router.add_api_route(
    "/{book_id}/rescan",
    rescan_book,
    methods=["POST"],
    summary="Re-read a book from disk and rebuild its search index",
    response_model=StatusResponse,
)
router.add_api_route(
    "/{book_id}/file", serve_book_file, methods=["GET"], summary="Download book file"
)
router.add_api_route(
    "/{book_id}/thumbnail", serve_book_thumbnail, methods=["GET"], summary="Book cover thumbnail"
)
router.add_api_route(
    "/{book_id}/toc", get_book_toc, methods=["GET"], summary="PDF table of contents",
    response_model=TocResponse,
)
router.add_api_route(
    "/{book_id}/page/{page_num}",
    serve_book_page,
    methods=["GET"],
    summary="Render a PDF page as WebP",
)
router.add_api_route(
    "/{book_id}/page/{page_num}/text", get_page_text, methods=["GET"], summary="Get page text",
    response_model=PageTextResponse,
)
router.add_api_route(
    "/{book_id}/page/{page_num}/words",
    get_page_words,
    methods=["GET"],
    summary="Get page word bounding boxes",
    response_model=PageWordsResponse,
)

# Page export (issue #207): whole pages as a PDF or images, or areas cut out of
# pages, streamed as a download. Saving into the library is the admin-only twin.
router.add_api_route(
    "/{book_id}/page/{page_num}/size",
    get_book_page_size,
    methods=["GET"],
    summary="Get a page's size",
    description="The page's width and height in PDF points (1/72 inch).",
    response_model=PageSizeResponse,
)
router.add_api_route(
    "/{book_id}/page/{page_num}/shapes",
    detect_book_page_shapes,
    methods=["GET"],
    summary="Suggest cut-outs on a page",
    description=(
        "Finds the separate pictures on a page - embedded images and circular "
        "vector frames, as token and card sheets are built - and returns each as "
        "a `rect` or `ellipse` with `x`/`y`/`w`/`h` as fractions of the page. "
        "A page that is one flat picture (a flattened token sheet, a scan) is "
        "read by its pixels instead, against its plain background colour."
    ),
    response_model=DetectShapesResponse,
)
router.add_api_route(
    "/{book_id}/export",
    export_book,
    methods=["POST"],
    summary="Export pages or cut-outs",
    description=(
        "`kind: pages` exports a page list (`pages`, e.g. `\"12-15, 20\"`) as one "
        "PDF or as one image per page (`format` png/jpeg/webp at `dpi` 36-600; "
        "`join_spreads` joins facing pages, paired by `spread_offset`). "
        "`kind: regions` cuts out each of `regions` - `pages` (one page, or two "
        "consecutive pages for an area across a spread), `shape` rect/ellipse and "
        "`x`/`y`/`w`/`h` as fractions of those pages laid side by side - as its "
        "own file; ellipses are transparent outside the circle, so not PDF. One "
        "file is returned as itself, several as a zip. Never writes to the library."
    ),
    # POST only to carry a body; changes nothing, so an API key's Read covers it.
    openapi_extra=api_keys.READ_ONLY,
)
router.add_api_route(
    "/{book_id}/export/save",
    save_book_export,
    methods=["POST"],
    summary="Save an export into the library",
    description=(
        "Runs the same export as `POST /books/{id}/export` and writes each file "
        "(never a zip) into the library folder `destination`, renaming rather than "
        "overwriting. Refused on a read-only library and for file types the "
        "destination does not index. Admin role required."
    ),
    response_model=SaveExportResponse,
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
    response_model=MetadataSourcesResponse,
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
    response_model=MetadataSearchResponse,
    # POST only to carry a body; changes nothing, so an API key's Read covers it.
    openapi_extra=api_keys.READ_ONLY,
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
    response_model=MetadataFetchResponse,
    # POST only to carry a body; changes nothing, so an API key's Read covers it.
    openapi_extra=api_keys.READ_ONLY,
)
