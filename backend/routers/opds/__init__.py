"""OPDS catalog package — public feed endpoints authenticated by per-user token."""
from fastapi import APIRouter
from fastapi.responses import Response

from .core import catalog, catalog_all, book_entry, download_book

router = APIRouter(prefix="/opds", tags=["opds"])

# The feed handlers build their own Atom `Response` (with the OPDS media type)
# and return it directly, so FastAPI passes it through untouched. `response_class`
# only drives the documented content type here — it must be a Response subclass,
# since passing None breaks OpenAPI schema generation for the whole app (#276).
router.add_api_route(
    "/{token}",
    catalog,
    methods=["GET"],
    summary="OPDS root catalog",
    response_class=Response,
)
router.add_api_route(
    "/{token}/all",
    catalog_all,
    methods=["GET"],
    summary="OPDS all-books feed",
    response_class=Response,
)
router.add_api_route(
    "/{token}/entry/{book_id}",
    book_entry,
    methods=["GET"],
    summary="OPDS single book entry",
    response_class=Response,
)
router.add_api_route(
    "/{token}/download/{book_id}",
    download_book,
    methods=["GET"],
    summary="Download a book via OPDS token",
)
