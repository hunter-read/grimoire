"""Response models for the token frame endpoints."""
from pydantic import BaseModel


class FrameOut(BaseModel):
    """One user-supplied frame image discovered under a ``.frames-container`` directory."""

    id: str
    name: str
    group: str = ""
    format: str


class FrameListResponse(BaseModel):
    frames: list[FrameOut]
