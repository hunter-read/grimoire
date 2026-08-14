"""Search package — FTS5 full-text search across the library."""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import search_library
from ._schemas import SearchResponse

router = APIRouter(tags=["search"])
router.add_api_route(
    "/search",
    search_library,
    methods=["GET"],
    summary="Full-text search",
    dependencies=[Depends(require_not_guest)],
    response_model=SearchResponse,
    description=(
        "Searches indexed book pages using SQLite FTS5. Optionally scope to a "
        "single book (`book_id`) or game system (`system_id`). Returns "
        "snippets with HTML `<mark>` highlights."
    ),
)
