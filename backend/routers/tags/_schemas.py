"""Pydantic schemas for the tags API (issue #235)."""
from typing import Annotated, Literal, Optional, Union

from pydantic import BaseModel, Field, field_validator

from ...services import tag_service
from .._json_list_coercion import PublisherRef, coerce_publisher_list


def _reject_forbidden_chars(v: str) -> str:
    """Block a tag value the API could not address afterwards (issue #430)."""
    problem = tag_service.validate_tag_value(v)
    if problem:
        raise ValueError(problem)
    return v


class TagDisplayUpdate(BaseModel):
    """Rename a tag's human-facing display value.

    The internal key follows the new display when its normalized form changes,
    so the new value has to be addressable too — which is what lets a tag that
    already contains a slash be renamed out of trouble.
    """

    display: str

    _check_display = field_validator("display")(_reject_forbidden_chars)


class TagMerge(BaseModel):
    """Merge this tag into another, re-pointing all its resource links."""

    into: str  # target tag's internal key (or any casing of it)

    # Only the *target* is checked: merging is a way out of a slashed tag, so
    # the source is deliberately left alone.
    _check_into = field_validator("into")(_reject_forbidden_chars)


class TagCreate(BaseModel):
    """Create a tag up-front (optional; tags are also created on first use)."""

    value: str
    display: Optional[str] = None

    _check_value = field_validator("value")(_reject_forbidden_chars)


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


class TaggedModelItem(BaseModel):
    item_type: Literal["model"]
    item_id: str
    filename: str
    has_thumbnail: Optional[bool] = None
    file_size: Optional[int] = None
    triangle_count: Optional[int] = None
    # Derived from the tri-state is_supported column — see Model3DOut.
    is_presupported: bool = False
    is_unsupported: bool = False


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
        TaggedModelItem,
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
