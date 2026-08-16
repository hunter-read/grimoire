"""Pydantic schemas for the tags API (issue #235)."""
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

from .._json_list_coercion import PublisherRef, coerce_publisher_list


class TagDisplayUpdate(BaseModel):
    """Rename a tag's human-facing display value (internal key is immutable)."""

    display: str


class TagMerge(BaseModel):
    """Merge this tag into another, re-pointing all its resource links."""

    into: str  # target tag's internal key (or any casing of it)


class TagCreate(BaseModel):
    """Create a tag up-front (optional; tags are also created on first use)."""

    value: str
    display: Optional[str] = None


class TagListItem(BaseModel):
    """One row of the tags listing, after folder tags are merged in.

    `category` comes from `tag_service.effective_category`, which always returns
    a string. A folder-only tag has no `Tag` row, so its entry is built from
    scratch by `_merge_folder_tags` — the same four keys either way, plus the
    `is_favorite` flag the handler stamps on every row before returning.
    """

    internal: str
    display: str
    category: str
    count: int
    is_favorite: bool


class TagsResponse(BaseModel):
    tags: list[TagListItem]


# Items carrying a tag are heterogeneous, discriminated by `item_type`. The
# shape is `_helpers.enrich_tagged_items`, which mirrors — but is not identical
# to — the favorites enrichment: no per-item `tags` list here, and systems carry
# only `cover_book_id`. Columns declared `default=...` rather than NOT NULL can
# still be NULL on rows predating the column, so they are Optional.
class TaggedBookItem(BaseModel):
    item_type: Literal["book"]
    item_id: str
    title: str
    category: Optional[str] = None
    has_thumbnail: Optional[bool] = None
    page_count: Optional[int] = None
    indexed: Optional[bool] = None
    index_failed: Optional[bool] = None


class TaggedMapItem(BaseModel):
    item_type: Literal["map"]
    item_id: str
    filename: str
    has_thumbnail: Optional[bool] = None
    file_size: Optional[int] = None


class TaggedTokenItem(BaseModel):
    item_type: Literal["token"]
    item_id: str
    filename: str
    has_thumbnail: Optional[bool] = None
    file_size: Optional[int] = None


class TaggedAudioItem(BaseModel):
    item_type: Literal["audio"]
    item_id: str
    filename: str
    # Coalesced by the enricher (`a.title or ""`, `a.duration or 0.0`, `bool(...)`).
    title: str
    duration: float
    has_artwork: bool
    file_size: Optional[int] = None


class TaggedSystemItem(BaseModel):
    item_type: Literal["system"]
    item_id: str
    name: str
    # Free-form JSON holding {"name", "url"} objects, not strings — same column
    # and same reasoning as `FavoriteSystemItem.publishers`.
    publishers: list[PublisherRef]
    # Null for container folders and for systems with no cover-worthy book.
    cover_book_id: Optional[str] = None

    _coerce_publishers = field_validator("publishers", mode="before")(
        coerce_publisher_list
    )


TaggedItem = Annotated[
    Union[
        TaggedBookItem,
        TaggedMapItem,
        TaggedTokenItem,
        TaggedAudioItem,
        TaggedSystemItem,
    ],
    Field(discriminator="item_type"),
]


class TaggedFolder(BaseModel):
    """A media folder carrying the tag, rendered with everything inside it."""

    resource_type: str
    path: str
    items: list[TaggedItem]


class TagItemsResponse(BaseModel):
    internal: str
    display: str
    category: str
    items: list[TaggedItem]
    folders: list[TaggedFolder]


class TagCreatedResponse(BaseModel):
    """A newly created tag. All three columns are NOT NULL."""

    internal: str
    display: str
    category: str


class TagRenamedResponse(BaseModel):
    """The result of a rename or merge — no `category` is returned by either."""

    internal: str
    display: str
