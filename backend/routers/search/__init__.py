"""Search package — FTS5 full-text search across the library."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import search_fields, search_library
from ._schemas import SearchFieldsResponse, SearchResponse

router = APIRouter(tags=["search"])
router.add_api_route(
    "/search",
    search_library,
    methods=["GET"],
    summary="Full-text search",
    dependencies=[Depends(require_not_guest)],
    response_model=SearchResponse,
    description=(
        "Searches indexed book pages using SQLite FTS5, and books, maps, tokens "
        "and audio by their own metadata. Optionally scope to a single book "
        "(`book_id`) or game system (`system_id`). Supports `field:value` "
        "filters (`title:avatar`, `author:\"Ben Robbins\"`, `tag:dungeon`); a "
        "metadata filter suppresses page-text search, and `text:` forces it. "
        "Returns snippets with HTML `<mark>` highlights."
    ),
)
router.add_api_route(
    "/search/fields",
    search_fields,
    methods=["GET"],
    summary="Searchable fields",
    dependencies=[Depends(require_not_guest)],
    response_model=SearchFieldsResponse,
    description=(
        "The `field:` prefixes the search box accepts, with their aliases. "
        "Powers the in-app search help popover."
    ),
)
