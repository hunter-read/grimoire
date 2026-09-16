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
from typing import Any, Sequence

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from ...models.collections import iter_specs
from ...models import Book, CampaignResource, Favorite, GameSystem, ResourceTag
from ...models.users import Bookmark
from .moves import _section_for_model

# The polymorphic discriminator each collection uses in `favorites.item_type`,
# `resource_tags.resource_type`, and `campaign_resources.resource_type`. These
# are singular where the library folders (and `COLLECTIONS`) are plural, so the
# mapping cannot just reuse the section name.
# SQLite caps host variables per statement (999 by default); chunk below it.
_ID_CHUNK = 400

_ITEM_TYPES: dict[str, str] = {
    spec.section: spec.singular for spec in iter_specs()
}


def item_type_for(model: Any) -> str:
    """The polymorphic type string for ``model``, or "" when it has none.

    ``GameSystem`` is not a collection — it owns no files and has no folder table
    — but it *is* tagged and favorited under ``resource_type="system"``, so it
    needs the same cleanup as the collections. Left out, the cascade behind
    ``GameSystem.books`` deleted a whole shelf while every tag link on it and its
    books survived, which is what made a tag count rows that no longer existed
    (issue #445).
    """
    if model is GameSystem:
        return "system"
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


def purge_system_references(db: Session, system_id: str) -> None:
    """:func:`purge_references` for a system *and* every book it will cascade to.

    ``GameSystem.books`` is ``cascade="all, delete-orphan"``, so deleting a
    system deletes its books through the ORM rather than through the delete paths
    that know to clean up after them. Each book's references have to be collected
    here, before the cascade fires, or they outlive the row that explained them.
    """
    for (book_id,) in db.query(Book.id).filter(Book.game_system_id == system_id).all():
        purge_references(db, Book, book_id)
    purge_references(db, GameSystem, system_id)


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


def reference_counts_for(
    db: Session, model: Any, record_ids: Sequence[str]
) -> dict[str, dict[str, int]]:
    """:func:`reference_counts` for many records at once, keyed by record id.

    The duplicate review page asks for these counts for every member of every
    group on screen. Done one record at a time that is four COUNT queries each -
    a page of 200 groups issued well over a thousand of them, which is what made
    the list slow to come back. Four grouped queries answer the same question
    regardless of how many records are asked about.

    Every requested id is present in the result, so callers can index the return
    value directly; a record with no references maps to explicit zeros rather
    than to a missing key.
    """
    item_type = item_type_for(model)
    ids = list(dict.fromkeys(record_ids))
    if not item_type:
        # Mirrors reference_counts, which answers {} for a model with no
        # polymorphic type rather than inventing zeroed keys for it.
        return {rid: {} for rid in ids}
    if not ids:
        return {}

    keys = ["favorites", "tags", "campaigns"] + (["bookmarks"] if model is Book else [])
    counts: dict[str, dict[str, int]] = {rid: {k: 0 for k in keys} for rid in ids}

    def tally(key: str, rows: Any) -> None:
        for record_id, total in rows:
            if record_id in counts:
                counts[record_id][key] = total

    # Chunked to stay under SQLite's variable limit on a large page.
    for chunk in (ids[i : i + _ID_CHUNK] for i in range(0, len(ids), _ID_CHUNK)):
        tally(
            "favorites",
            db.query(Favorite.item_id, func.count())
            .filter(Favorite.item_type == item_type, Favorite.item_id.in_(chunk))
            .group_by(Favorite.item_id)
            .all(),
        )
        tally(
            "tags",
            db.query(ResourceTag.resource_id, func.count())
            .filter(
                ResourceTag.resource_type == item_type, ResourceTag.resource_id.in_(chunk)
            )
            .group_by(ResourceTag.resource_id)
            .all(),
        )
        tally(
            "campaigns",
            db.query(CampaignResource.resource_id, func.count())
            .filter(
                CampaignResource.resource_type == item_type,
                CampaignResource.resource_id.in_(chunk),
            )
            .group_by(CampaignResource.resource_id)
            .all(),
        )
        if model is Book:
            tally(
                "bookmarks",
                db.query(Bookmark.book_id, func.count())
                .filter(Bookmark.book_id.in_(chunk))
                .group_by(Bookmark.book_id)
                .all(),
            )
    return counts
