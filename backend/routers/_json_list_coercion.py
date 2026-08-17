"""Coercion helpers for the free-form JSON list columns (issue #356).

``books.authors``/``artists``/``genres``/``urls`` and the game-system equivalents
are plain ``JSON`` columns, so SQLite will hand back whatever was written. Every
write path in the app produces the declared shape — ``list[str]`` for the name
lists, ``{label, url}`` for link lists, ``{name, url}`` for publishers — but the
column itself does not enforce that, and a row written by an older build, a
community add-on, or a direct DB edit can hold something else.

The response models declare the real element types so generated clients get a
usable shape instead of an untyped node. These validators run ``mode="before"``
so an off-shape legacy row is normalized on the way out rather than raising and
turning a plain ``GET`` into a 500.
"""
from typing import Any

from pydantic import BaseModel


class PublisherRef(BaseModel):
    """A publisher on a game system: a name with an optional link.

    Mirrors ``systems._schemas.PublisherEntry`` (the request-side model) for use
    by the response models that surface the ``publishers`` column.
    """

    name: str = ""
    url: str = ""


def coerce_str_list(v: Any) -> Any:
    """Normalize a value from a ``list[str]``-shaped JSON column.

    Drops nulls and blanks, and stringifies scalars so a row holding e.g. a bare
    number still serializes. A non-list is treated as a single element.
    """
    if v is None:
        return []
    items = v if isinstance(v, list) else [v]
    out: list[str] = []
    for item in items:
        if item is None or isinstance(item, (dict, list)):
            # No meaningful string form — a stringified dict is worse than a drop.
            continue
        text = str(item).strip()
        if text:
            out.append(text)
    return out


def coerce_link_list(v: Any) -> Any:
    """Normalize a value from a ``list[LinkEntry]``-shaped JSON column.

    A bare string becomes ``{"label": "", "url": <string>}``, which is how the
    0004 migration already folded the legacy single-value URL columns in.
    """
    return _coerce_entry_list(v, "url")


def coerce_publisher_list(v: Any) -> Any:
    """Normalize a value from a ``list[PublisherEntry]``-shaped JSON column.

    A bare string becomes ``{"name": <string>, "url": ""}``, matching what the
    scanner writes when it infers a publisher from the folder structure.
    """
    return _coerce_entry_list(v, "name")


def _coerce_entry_list(v: Any, text_key: str) -> Any:
    """Shared body for the two object-list coercions.

    ``text_key`` is the field a bare string maps onto; the entry model supplies
    the default for the other one.
    """
    if v is None:
        return []
    items = v if isinstance(v, list) else [v]
    out: list[Any] = []
    for item in items:
        if isinstance(item, dict):
            # Already the right shape (or close enough for the model to judge).
            out.append(item)
            continue
        if item is None or isinstance(item, list):
            continue
        text = str(item).strip()
        if text:
            out.append({text_key: text})
    return out
