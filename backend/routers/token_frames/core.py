"""Handlers for listing and serving user-supplied token frames.

Only *user* frames are served here. The three defaults (PC, NPC, Opponent) are
bundled with the frontend and served as static assets, so the editor still has
frames when the library is empty, unreadable, or not yet mounted.
"""

from fastapi import Depends, Request
from fastapi.responses import Response
from sqlalchemy.orm import Session

from ...config import get_db
from ...file_cache import cached_file_response
from ._helpers import (
    FRAME_MEDIA_TYPES,
    attach_token_ids,
    cached_user_frames,
    frame_response_headers,
    resolve_frame_path,
)


def list_token_frames(db: Session = Depends(get_db)) -> dict:
    """List every frame image found in a ``.frames-container`` folder under ``tokens/``."""
    frames = cached_user_frames()
    return {"frames": attach_token_ids(db, frames)}


def serve_token_frame(frame_id: str, request: Request) -> Response:
    """Serve one frame file by its opaque id."""
    path = resolve_frame_path(frame_id)
    return cached_file_response(
        request,
        str(path),
        media_type=FRAME_MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers=frame_response_headers(path),
    )
