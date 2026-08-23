"""Rows that point at a library record but no foreign key will clean up.

Deleting a book, map, token, or audio row leaves behind everything that
referenced it by id. Nothing in the schema removes those rows for us:

* ``Bookmark.book_id`` is a real foreign key with no ``ondelete``, and
  connections run ``PRAGMA foreign_keys=ON`` (``models/db.py``), so deleting a
  bookmarked book *raises IntegrityError* rather than cascading.
* ``Favorite``, ``ResourceTag``, and ``CampaignResource`` are polymorphic —
  ``item_type``/``resource_type`` plus a bare id — so they carry no foreign key
  at all and their rows are simply orphaned.
* ``book_search`` is an FTS5 virtual table holding a soft ``book_id``.

This module is the single place that knows the full list. It was previously
open-coded in two places that each knew a different subset: the cleanup sweep in
``routers/maintenance/_helpers`` (books only) and migration 0024. The media
cleanup loops knew none of it, so every cleanup run orphaned favorites and tags
for missing maps, tokens, and audio.
"""
from typing import Any

from sqlalchemy import text
from sqlalchemy.orm import Session

from ...models import Book, CampaignResource, Favorite, ResourceTag
from ...models.users import Bookmark
from .moves import _section_for_model

# The polymorphic discriminator each collection uses in `favorites.item_type`,
# `resource_tags.resource_type`, and `campaign_resources.resource_type`. These
# are singular where the library folders (and `COLLECTIONS`) are plural, so the
# mapping cannot just reuse the section name.
_ITEM_TYPES: dict[str, str] = {
    "books": "book",
    "maps": "map",
    "tokens": "token",
    "audio": "audio",
}


def item_type_for(model: Any) -> str:
    """The polymorphic type string for ``model``, or "" when it has none."""
    return _ITEM_TYPES.get(_section_for_model(model), "")


def purge_references(db: Session, model: Any, record_id: str) -> None:
    """Delete every row pointing at ``record_id`` that no foreign key removes.

    Deliberately does **not** commit: a delete that is later rolled back must not
    have already destroyed the user's bookmarks. The caller owns the transaction.

    Safe to call for a record that has no references — every query is a no-op
    delete — so callers do not need to know what a given record accumulated.
    """
    item_type = item_type_for(model)
    if not item_type:
        return

    if model is Book:
        # Soft reference: book_search is an FTS5 virtual table, so no constraint
        # ties these rows to the book and nothing else will ever collect them.
        db.execute(text("DELETE FROM book_search WHERE book_id = :id"), {"id": record_id})
        db.query(Bookmark).filter_by(book_id=record_id).delete(synchronize_session=False)

    db.query(Favorite).filter_by(item_type=item_type, item_id=record_id).delete(
        synchronize_session=False
    )
    db.query(ResourceTag).filter_by(resource_type=item_type, resource_id=record_id).delete(
        synchronize_session=False
    )

    # ORM delete per row rather than a bulk delete: CampaignResourceShare hangs
    # off CampaignResource through a relationship cascade, not a DB constraint,
    # so a bulk delete would leave the shares stranded.
    for resource in (
        db.query(CampaignResource)
        .filter_by(resource_type=item_type, resource_id=record_id)
        .all()
    ):
        db.delete(resource)


def reference_counts(db: Session, model: Any, record_id: str) -> dict[str, int]:
    """How many rows of each kind point at ``record_id``.

    The read-only counterpart to :func:`purge_references`, over the same list.
    Deciding which of two duplicate files to keep turns almost entirely on this —
    "that copy has three bookmarks and two campaign links, this one has none" is
    invisible from the filesystem and is the question the compare view answers.
    """
    item_type = item_type_for(model)
    if not item_type:
        return {}

    counts = {
        "favorites": db.query(Favorite)
        .filter_by(item_type=item_type, item_id=record_id)
        .count(),
        "tags": db.query(ResourceTag)
        .filter_by(resource_type=item_type, resource_id=record_id)
        .count(),
        "campaigns": db.query(CampaignResource)
        .filter_by(resource_type=item_type, resource_id=record_id)
        .count(),
    }
    if model is Book:
        counts["bookmarks"] = db.query(Bookmark).filter_by(book_id=record_id).count()
    return counts
