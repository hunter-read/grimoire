"""Handlers for listing and serving user-supplied token frames.

Only *user* frames are served here. The three defaults (PC, NPC, Opponent) are
bundled with the frontend and served as static assets, so the editor still has
frames when the library is empty, unreadable, or not yet mounted.
"""

from fastapi import Request
from fastapi.responses import Response

from ...file_cache import cached_file_response
from ._helpers import (
    FRAME_MEDIA_TYPES,
    cached_user_frames,
    frame_response_headers,
    resolve_frame_path,
)


def list_token_frames() -> dict:
    """List every frame image found in a ``.frames-container`` folder under ``tokens/``."""
    frames = cached_user_frames()
    return {"frames": frames}


def serve_token_frame(frame_id: str, request: Request) -> Response:
    """Serve one frame file by its opaque id."""
    path = resolve_frame_path(frame_id)
    return cached_file_response(
        request,
        str(path),
        media_type=FRAME_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers=frame_response_headers(path),
    )
