"""Pydantic schemas for the favorites API."""
from typing import Annotated, Any, Literal, Optional, Union

from pydantic import BaseModel, Field


class FavoriteIn(BaseModel):
    item_type: str
    item_id: str


class FavoriteRef(BaseModel):
    """Bare (type, id) pair — one per stored favorite row, including rows whose
    target has since been deleted and so has no entry in `items`."""

    item_type: str
    item_id: str


# The enriched `items` list is heterogeneous: each favorite kind carries its own
# fields, discriminated by `item_type`. Modelling it as a tagged union keeps the
# per-kind fields required (rather than collapsing to one all-Optional model)
# and emits a proper `oneOf` with a discriminator in the OpenAPI schema.
# Columns below that are declared `default=...` rather than `nullable=False` can
# still hold NULL (the default only applies at insert, and rows predating a
# column keep NULL), so they are Optional here. Declaring them strictly would
# make response_model validation raise on those legacy rows.
class FavoriteBookItem(BaseModel):
    item_type: Literal["book"]
    item_id: str
    title: str
    category: Optional[str] = None
    has_thumbnail: Optional[bool] = None
    page_count: Optional[int] = None
    indexed: Optional[bool] = None
    index_failed: Optional[bool] = None


class FavoriteMapItem(BaseModel):
    item_type: Literal["map"]
    item_id: str
    filename: str
    has_thumbnail: Optional[bool] = None
    file_size: Optional[int] = None
    tags: list[str]


class FavoriteTokenItem(BaseModel):
    item_type: Literal["token"]
    item_id: str
    filename: str
    has_thumbnail: Optional[bool] = None
    file_size: Optional[int] = None
    tags: list[str]


class FavoriteAudioItem(BaseModel):
    item_type: Literal["audio"]
    item_id: str
    filename: str
    # Handler coalesces these (`a.title or ""`, `a.duration or 0.0`).
    title: str
    duration: float
    has_artwork: bool
    file_size: Optional[int] = None
    tags: list[str]


class FavoriteSystemItem(BaseModel):
    item_type: Literal["system"]
    item_id: str
    name: str
    # Free-form JSON on the model, and in practice a list of
    # ``{"name": ..., "url": ...}`` objects (which is what the UI renders — see
    # `SystemFavorite.jsx` reading `p.name`). Typed `list[Any]` to match
    # `SystemSummary.publishers` rather than `list[str]`, which rejected every
    # real row and made the whole favorites response 500.
    publishers: list[Any]
    # Null for container folders (issues #261, #262), which own no books.
    cover_book_id: Optional[str] = None
    has_cover: bool
    container_kind: str


class FavoriteTagItem(BaseModel):
    item_type: Literal["tag"]
    item_id: str
    internal: str
    display: str
    count: int


FavoriteItem = Annotated[
    Union[
        FavoriteBookItem,
        FavoriteMapItem,
        FavoriteTokenItem,
        FavoriteAudioItem,
        FavoriteSystemItem,
        FavoriteTagItem,
    ],
    Field(discriminator="item_type"),
]


class FavoritesResponse(BaseModel):
    favorites: list[FavoriteRef]
    items: list[FavoriteItem]
