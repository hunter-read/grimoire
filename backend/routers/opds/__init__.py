"""OPDS catalog package — public feed endpoints authenticated by per-user token."""
from fastapi import APIRouter
from fastapi.responses import Response

from .core import (
    book_cover,
    book_entry,
    book_entry_v2,
    catalog,
    catalog_all,
    catalog_all_v2,
    catalog_other_v2,
    catalog_system_v2,
    catalog_v2,
    download_book,
)

router = APIRouter(prefix="/opds", tags=["opds"])

# The feed handlers build their own Atom `Response` (with the OPDS media type)
# and return it directly, so FastAPI passes it through untouched. `response_class`
# only drives the documented content type here — it must be a Response subclass,
# since passing None breaks OpenAPI schema generation for the whole app (#276).

# v2 is registered first. Its paths share a shape with v1's
# (`/v2/{token}/all` against `/{token}/entry/{book_id}`...), and routes match in
# registration order, so v2 must get the first look at a `/opds/v2/...` path.
router.add_api_route(
    "/v2/{token}",
    catalog_v2,
    methods=["GET"],
    summary="OPDS v2 root catalog, by game system",
    response_class=Response,
)
router.add_api_route(
    "/v2/{token}/all",
    catalog_all_v2,
    methods=["GET"],
    summary="OPDS v2 all-books feed",
    response_class=Response,
)
router.add_api_route(
    "/v2/{token}/system/{system_id}",
    catalog_system_v2,
    methods=["GET"],
    summary="OPDS v2 feed of one game system's books",
    response_class=Response,
)
router.add_api_route(
    "/v2/{token}/other",
    catalog_other_v2,
    methods=["GET"],
    summary="OPDS v2 feed of books with no game system",
    response_class=Response,
)
router.add_api_route(
    "/v2/{token}/entry/{book_id}",
    book_entry_v2,
    methods=["GET"],
    summary="OPDS v2 single book entry",
    response_class=Response,
)
router.add_api_route(
    "/v2/{token}/download/{book_id}",
    download_book,
    methods=["GET"],
    summary="Download a book via OPDS v2 token",
)
router.add_api_route(
    "/v2/{token}/cover/{book_id}",
    book_cover,
    methods=["GET"],
    summary="A book's cover via OPDS v2 token",
)

# v1 — the original catalog, kept unchanged for readers already using it.
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
router.add_api_route(
    "/{token}/cover/{book_id}",
    book_cover,
    methods=["GET"],
    summary="A book's cover via OPDS token",
)
