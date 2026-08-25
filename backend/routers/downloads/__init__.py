"""Downloads package — stream library content as zip / tar archives."""
from pathlib import Path

from fastapi import APIRouter

from ...config import LIBRARY_PATH

# Package-level constant — tests patch this attribute and ``_safe_filepath``
# reads it lazily on each call so the patch is honoured.
_LIBRARY_ROOT = Path(LIBRARY_PATH).resolve()

from ._helpers import _safe_arcname  # noqa: E402  re-exported for tests
from .core import download_archive  # noqa: E402

router = APIRouter(prefix="/downloads", tags=["downloads"])
router.add_api_route(
    "/archive",
    download_archive,
    methods=["GET"],
    summary="Download an archive of files",
    description=(
        "Stream a collection of files as a single archive. `fmt` controls the "
        "format: `zip` (default), `tar`, `tar.gz`, `tar.bz2`. `type` controls "
        "the scope: `system`, `system_category`, `book_folder`, `map_folder`, "
        "`token_folder`, `audio_folder`, or `library_folder` (admin-only; any "
        "folder as it sits on disk, indexed or not)."
    ),
)


__all__ = ["router", "_safe_arcname", "_LIBRARY_ROOT"]
