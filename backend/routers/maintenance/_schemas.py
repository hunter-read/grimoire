"""Pydantic schemas for the maintenance API."""
from pydantic import BaseModel


class CleanupCounts(BaseModel):
    """Per-collection counts of DB rows removed for missing files."""

    books: int
    maps: int
    tokens: int
    audio: int
    systems: int


class CleanupResponse(BaseModel):
    removed: CleanupCounts
