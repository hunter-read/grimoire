"""Schemas for books shown on more than one system's shelf (issue #446).

Shared by the books router (a book's links) and the systems router (a shelf's
linked books), so both name a system the same way.
"""
from pydantic import BaseModel, Field


class LinkedSystemRef(BaseModel):
    """A system a book is linked to, or the system a linked book lives in."""

    id: str
    name: str
    # "ttrpg" (books/) or "wargame" (armory/), for the link to the system page.
    game_type: str = "ttrpg"
    # One-page games keep raw folder names, which the client prettifies.
    is_one_page: bool = False


class BookSystemLinkCreate(BaseModel):
    """Link a book onto another system's shelf."""

    system_id: str = Field(..., min_length=1, max_length=36)
