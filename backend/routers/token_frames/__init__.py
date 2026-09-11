"""Token frames package — overlay art for the in-app token editor.

Frames are read-only: this router discovers and serves images the operator has
placed in ``.frames-container`` folders under the token library. Nothing here
writes to the library. Frame images are still ordinary library files that the
scanner indexes as tokens — the marker adds a *use* for them rather than hiding
them — so each listed frame carries the id of its token row, which is how the
editor knows a frame has been favourited (see ``_helpers``).
"""
from fastapi import APIRouter, Depends

from ...auth import require_not_guest
from .core import list_token_frames, serve_token_frame
from ._schemas import FrameListResponse

router = APIRouter(tags=["token-frames"])

# Frames are library content, so guests — who have no access to the shared
# library at all — are blocked outright. Unlike tokens there is no per-item
# sharing story to honour, so a blanket dependency is both correct and simpler.
router.add_api_route(
    "/token-frames",
    list_token_frames,
    methods=["GET"],
    summary="List token frames",
    description=(
        "Returns every frame image found in a `.frames-container` folder under the token "
        "library. Built-in frames ship with the frontend and are not listed here."
    ),
    dependencies=[Depends(require_not_guest)],
    response_model=FrameListResponse,
)
router.add_api_route(
    "/token-frames/{frame_id}/file",
    serve_token_frame,
    methods=["GET"],
    summary="Serve a token frame image",
    description="Serves one frame by the opaque id returned from the listing.",
    dependencies=[Depends(require_not_guest)],
)
