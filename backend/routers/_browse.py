"""Query parameters shared by the paged browse endpoints (issue #221).

The media galleries, a system's book shelf, and the tags view all filter, sort
and group on the server now, and take the same filter vocabulary the frontend's
sort/filter bar produces. Declared once here so each list endpoint and its
``/groups`` companion read them identically - a folder's count and the items
that opening it lists must come from the same filters.
"""
from datetime import datetime
from typing import Literal, Optional

from fastapi import HTTPException, Query
from pydantic import BaseModel

from ..services.browse.media import SORTS, MediaBrowse
from ..services.browse.tag_query import parse_tag_groups


def parse_tags_param(tags: Optional[str]) -> list[dict]:
    """The ``tags`` JSON parameter as filter groups, or a 400 naming the problem."""
    try:
        return parse_tag_groups(tags)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


def media_browse_params(
    q: str = Query(
        "",
        description=(
            "Search text. Matches the name, folder path, and tags; accepts the search "
            "page's `field:value` prefixes (`tag:`, `title:`, `filename:`, `artist:`, "
            "`album:`)."
        ),
    ),
    tags: Optional[str] = Query(
        None,
        description=(
            "Tag filter as JSON: a list of `{mode: include|exclude, tags: [...]}` groups "
            "(tags OR'd within a group, groups AND'd), or a flat list of tags that must "
            "all match. Folder tags count for everything beneath the folder. "
            "`__grim:none__`/`__grim:any__` match items with no tags / any tag."
        ),
    ),
    favorites: bool = Query(False, description="Only the caller's favorites."),
    added_since: Optional[datetime] = Query(
        None, description="Only items added at or after this time (undated items never match)."
    ),
    folder: Optional[str] = Query(
        None,
        description=(
            "Only items directly in this folder (collection-relative, `\"\"` for the root). "
            "Omit for the whole collection."
        ),
    ),
    sort: str = Query(
        "path",
        description=f"One of: {', '.join(sorted(SORTS))}. `path` is folder order.",
    ),
    order: Literal["asc", "desc"] = Query("asc"),
) -> MediaBrowse:
    if sort not in SORTS:
        raise HTTPException(422, f"sort must be one of: {', '.join(sorted(SORTS))}")
    return MediaBrowse(
        q=q,
        tags=parse_tags_param(tags),
        favorites=favorites,
        added_since=added_since,
        folder=folder,
        sort=sort,
        order=order,
    )


class FolderGroup(BaseModel):
    """One folder holding matching items."""

    path: str
    count: int


class FolderGroupsResponse(BaseModel):
    """Every folder holding items that match the filters, with counts."""

    total: int
    groups: list[FolderGroup]
