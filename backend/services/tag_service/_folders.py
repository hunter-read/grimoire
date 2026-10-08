"""Folder-level tags: media folders and book subcategory folders.

Split out of the former single-module ``tag_service`` (issue #235). Media
folders and book folders address their contents differently (see
``_FOLDER_SOURCES`` and ``_BOOK_RESOURCE_TYPE`` below), but both surface as tags
on the items they contain. Resolving a folder to those items lives in
:mod:`._folder_scopes`.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from ...models.collections import MEDIA_SINGULARS, iter_specs
from ...models import RESOURCE_TYPES, SHARED_CATEGORY, BookFolder, Tag
from ._catalog import (
    get_or_create_tag,
    normalize_internal,
)


_FOLDER_SOURCES = [
    (spec.folder_model, spec.model, spec.singular)
    for spec in iter_specs()
    if spec.singular in MEDIA_SINGULARS
]

# Book subcategory folders (issue #235 follow-up) use a different addressing
# scheme than media folders: a ``BookFolder.path`` is
# ``{system_id}/{category}/{subfolder…}`` and a book "lives under" it when its
# ``game_system_id`` + ``category`` match and its own subfolder path is at/below
# that folder's subfolder path. They're resolved separately from
# ``_FOLDER_SOURCES`` but surfaced as ``book``-type folder tags all the same.
_BOOK_RESOURCE_TYPE = "book"


def register_folder_tags(
    db: Session, raw_tags: Iterable[str], *, category: str = SHARED_CATEGORY
) -> list[str]:
    """Ensure a ``Tag`` catalog row exists for each folder tag, returning the
    de-duplicated **internal** keys to store on the folder record.

    Folder tags are stored on the ``*_folders``/``book_folders`` JSON columns as
    internal keys; their display casing lives in the catalog. A new tag is created
    with its entered casing as the default display; an existing tag keeps its
    display (never overwritten) and may be promoted to ``shared``. Callers own the
    transaction (no commit here).
    """
    seen: set[str] = set()
    internals: list[str] = []
    for raw in raw_tags or []:
        internal = normalize_internal(raw)
        if not internal or internal in seen:
            continue
        seen.add(internal)
        get_or_create_tag(db, raw, category=category)
        internals.append(internal)
    return internals


def upsert_folder_tags(
    db: Session, folder_model: type, path: str, raw_tags: Iterable[str], *, category: str
) -> list[str]:
    """Set a folder record's tags to the given list, registering catalog rows.

    Registers a ``Tag`` catalog row for each tag (see :func:`register_folder_tags`)
    and stores the resulting internal keys on the ``folder_model`` row at ``path``
    (creating it if absent). Returns the stored internal keys. Shared by the
    map/token/audio folder-tag update endpoints; callers own the transaction.
    """
    internals = register_folder_tags(db, raw_tags, category=category)
    folder = db.query(folder_model).filter_by(path=path).first()
    if folder is not None:
        folder.tags = internals
    else:
        db.add(folder_model(path=path, tags=internals))
    return internals


def folder_display_tags(db: Session, internals: Iterable[str]) -> list[str]:
    """Resolve a folder's stored internal keys to display strings for API reads.

    Folder JSON holds internal keys; their display casing comes from the catalog
    (falling back to the key itself when no ``Tag`` row exists yet). Order is
    preserved.
    """
    keys = [normalize_internal(i) for i in (internals or []) if normalize_internal(i)]
    if not keys:
        return []
    catalog = _catalog_display_map(db, set(keys))
    return [catalog.get(k, k) for k in keys]


def folder_types_for_tag(db: Session, internal: str) -> set[str]:
    """The resource types of every media folder whose tags include this key.

    Folder tags live as JSON on the ``*_folders`` tables and never touch a
    ``Tag`` row's stored ``category``, so this is how folder usage is factored
    into a tag's *effective* category (see :func:`effective_category`).
    """
    key = normalize_internal(internal)
    if not key:
        return set()
    types: set[str] = set()
    for folder_model, _item_model, rtype in _FOLDER_SOURCES:
        found = any(
            any(normalize_internal(raw) == key for raw in (f.tags or []))
            for f in db.query(folder_model).all()
        )
        if found:
            types.add(rtype)
    if any(
        any(normalize_internal(raw) == key for raw in (f.tags or []))
        for f in db.query(BookFolder).all()
    ):
        types.add(_BOOK_RESOURCE_TYPE)
    return types


def effective_category(stored: Optional[str], usage_types: Iterable[str]) -> str:
    """Reconcile a tag's stored category with the resource types it's used in.

    ``stored`` is the ``Tag.category`` (or ``None`` for a folder-only tag);
    ``usage_types`` is every resource type the tag actually appears on (direct
    links and/or folder tags). A tag used across more than one type is ``shared``;
    otherwise it's that single type. This makes book (direct) + map-folder usage
    resolve to ``shared`` even though folder tags never promote the stored row.
    """
    types = {t for t in usage_types if t in RESOURCE_TYPES}
    if stored and stored != SHARED_CATEGORY:
        types.add(stored)
    if stored == SHARED_CATEGORY:
        return SHARED_CATEGORY
    if len(types) > 1:
        return SHARED_CATEGORY
    if len(types) == 1:
        return next(iter(types))
    return stored or SHARED_CATEGORY


def _catalog_display_map(db: Session, internals: set[str]) -> dict[str, str]:
    """Map internal keys → the ``Tag`` catalog's display casing, for keys present.

    Folder tags store internal keys; their display comes from the catalog so a
    rename on the tags page (which updates the ``Tag`` row) is reflected in
    folder-derived listings and a ``tags.json`` rescan can't revert it.
    """
    if not internals:
        return {}
    return {
        t.internal: t.display
        for t in db.query(Tag).filter(Tag.internal.in_(internals)).all()
    }


def remove_tag_from_folders(db: Session, internal: str) -> int:
    """Strip the tag with the given internal key from every media folder's JSON
    ``tags`` list. Returns the number of folder rows changed.

    A rescan may reapply the tag from ``tags.json``; that's expected. Callers own
    the transaction (no commit here).
    """
    key = normalize_internal(internal)
    changed = 0
    folder_models = [m for m, _i, _r in _FOLDER_SOURCES] + [BookFolder]
    for folder_model in folder_models:
        for folder in db.query(folder_model).all():
            tags = folder.tags or []
            kept = [raw for raw in tags if normalize_internal(raw) != key]
            if len(kept) != len(tags):
                folder.tags = kept
                changed += 1
    return changed
