"""Response models for the token frame endpoints."""
from typing import Optional

from pydantic import BaseModel


class FrameOut(BaseModel):
    """One user-supplied frame image discovered under a ``.frames-container`` directory."""

    id: str
    name: str
    group: str = ""
    format: str
    # The ``Token`` row for the same file, when the indexer has reached it.
    # Frames are ordinary library images, so a frame is favourited by starring
    # its token — this is the join that lets the picker surface favourites
    # without a second favourite type keyed to the opaque frame id. ``None`` for
    # a frame dropped in since the last scan, which simply cannot be favourited
    # yet; the picker treats that as "not favourited" rather than an error.
    token_id: Optional[str] = None


class FrameListResponse(BaseModel):
    frames: list[FrameOut]
