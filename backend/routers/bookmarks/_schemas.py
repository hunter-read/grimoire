"""Pydantic schemas for the bookmarks API."""
from typing import Optional
from pydantic import BaseModel


class BookmarkCreate(BaseModel):
    book_id: str
    page_number: int
    label: Optional[str] = ""
    notes: Optional[str] = ""
    selected_text: Optional[str] = None


class BookmarkUpdate(BaseModel):
    label: str
    notes: Optional[str] = None


class BookmarkOut(BaseModel):
    """One bookmark, as built by `_helpers._serialize`."""

    id: str
    book_id: str
    page_number: int
    # `label` is `default=""` on the model rather than NOT NULL, so legacy rows
    # can hold NULL; `notes` is coalesced by the serializer but `selected_text`
    # is deliberately nullable (no text selection captured).
    label: Optional[str] = None
    notes: str
    selected_text: Optional[str] = None
    created_at: str


class StatusResponse(BaseModel):
    status: str
