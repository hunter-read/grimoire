"""Folder-level tags: media folders and book subcategory folders.

Split out of the former single-module ``tag_service`` (issue #235). Media
folders and book folders address their contents differently (see
``_FOLDER_SOURCES`` and ``_BOOK_RESOURCE_TYPE`` below), but both surface as tags
on the items they contain.
"""
from __future__ import annotations

from typing import Iterable, Optional

from sqlalchemy.orm import Session

from .. import variants
from ...models.collections import MEDIA_SINGULARS, iter_specs
from ...models import RESOURCE_TYPES, SHARED_CATEGORY, Book, BookFolder, Tag
from ._catalog import (
    default_display,
    get_or_create_tag,
    normalize_internal,
)
from ._paths import (
    _book_folder_ancestor_paths,
    _book_folder_display,
    system_category_depths,
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


def _ancestor_folder_paths(relative_path: str) -> set[str]:
    """Every folder path (collection-relative) an item lives under.

    ``relative_path`` is ``<collection>/<a>/<b>/<file>``; the item belongs to
    folders ``a`` and ``a/b`` (folder table paths are collection-relative). This
    mirrors the ``/<path>/`` containment used elsewhere but computed in Python so
    the whole set can be resolved from one item scan (no per-folder LIKE query).
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    segs = parts[1:-1]  # drop collection prefix and filename
    return {"/".join(segs[: i + 1]) for i in range(len(segs))}


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


def folder_tags_in_use(
    db: Session, resource_type: Optional[str] = None
) -> dict[str, dict]:
    """Folder-derived tags keyed by internal, with display + a de-duplicated set
    of the item refs they cover.

    Folder tags live as plain JSON on the ``*_folders`` tables and are not part of
    the shared-tag tables, but the media galleries treat them as tags on the items
    inside the folder. This resolves them the same way so the tags view can list
    them and show their items. Scoped to ``resource_type`` when given.

    Returns ``{internal: {"display": str, "refs": [{resource_type, resource_id}]}}``.
    The display is the first-seen casing across folders. Resolves everything from
    two bulk queries per type (all folders + all item id/paths) rather than a LIKE
    per folder, so the tags listing stays fast as libraries grow.
    """
    out: dict[str, dict] = {}
    for folder_model, item_model, rtype in _FOLDER_SOURCES:
        if resource_type is not None and rtype != resource_type:
            continue

        # folder path -> its tag list (skip untagged folders).
        folder_tags: dict[str, list] = {
            f.path: f.tags for f in db.query(folder_model).all() if f.tags
        }
        if not folder_tags:
            continue

        # For each item, attach its folders' tags via the item's ancestor paths.
        item_q = db.query(item_model.id, item_model.relative_path).filter(
            variants.parent_filter(item_model)
        )
        for item_id, rel in item_q.all():
            ancestors = _ancestor_folder_paths(rel)
            if not ancestors:
                continue
            for path in ancestors & folder_tags.keys():
                for raw in folder_tags[path]:
                    internal = normalize_internal(raw)
                    if not internal:
                        continue
                    entry = out.setdefault(
                        internal, {"display": default_display(raw) or internal, "refs": {}}
                    )
                    entry["refs"][(rtype, item_id)] = {
                        "resource_type": rtype,
                        "resource_id": item_id,
                    }

    # Book subcategory folders (distinct addressing — see _BOOK_RESOURCE_TYPE).
    if resource_type is None or resource_type == _BOOK_RESOURCE_TYPE:
        book_folder_tags = {f.path: f.tags for f in db.query(BookFolder).all() if f.tags}
        if book_folder_tags:
            depths = system_category_depths(db)
            books = (
                db.query(Book.id, Book.game_system_id, Book.category, Book.relative_path)
                .filter(variants.parent_filter(Book))
                .all()
            )
            for book_id, sys_id, category, rel in books:
                ancestors = _book_folder_ancestor_paths(
                    sys_id or "", category or "", rel, depths.get(sys_id or "", 2)
                )
                for path in ancestors & book_folder_tags.keys():
                    for raw in book_folder_tags[path]:
                        internal = normalize_internal(raw)
                        if not internal:
                            continue
                        entry = out.setdefault(
                            internal, {"display": default_display(raw) or internal, "refs": {}}
                        )
                        entry["refs"][(_BOOK_RESOURCE_TYPE, book_id)] = {
                            "resource_type": _BOOK_RESOURCE_TYPE,
                            "resource_id": book_id,
                        }

    # The catalog is authoritative for display casing (a rename updates the Tag
    # row); fall back to the JSON-derived default for keys with no Tag row yet.
    catalog = _catalog_display_map(db, set(out.keys()))
    return {
        internal: {
            "display": catalog.get(internal, v["display"]),
            "refs": list(v["refs"].values()),
        }
        for internal, v in out.items()
    }


def folders_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Folders carrying the given tag, each with the item refs they contain.

    Used by the tags view to show a folder tag as a folder group (like the media
    pages) listing everything inside the folder — even items that don't carry the
    tag themselves. Returns
    ``[{resource_type, path, items: [{resource_type, resource_id}]}]``, sorted by
    (resource_type, path).
    """
    key = normalize_internal(internal)
    result: list[dict] = []
    for folder_model, item_model, rtype in _FOLDER_SOURCES:
        if resource_type is not None and rtype != resource_type:
            continue
        # Folders whose tags include this key.
        paths = [
            f.path
            for f in db.query(folder_model).all()
            if any(normalize_internal(raw) == key for raw in (f.tags or []))
        ]
        if not paths:
            continue
        path_set = set(paths)
        # Bucket items into the matching folders via their ancestor paths.
        buckets: dict[str, list] = {p: [] for p in paths}
        item_q = db.query(item_model.id, item_model.relative_path).filter(
            variants.parent_filter(item_model)
        )
        for item_id, rel in item_q.all():
            for p in _ancestor_folder_paths(rel) & path_set:
                buckets[p].append({"resource_type": rtype, "resource_id": item_id})
        for p in paths:
            result.append({"resource_type": rtype, "path": p, "items": buckets[p]})

    # Book subcategory folders (distinct addressing — see _BOOK_RESOURCE_TYPE).
    if resource_type is None or resource_type == _BOOK_RESOURCE_TYPE:
        book_paths = [
            f.path
            for f in db.query(BookFolder).all()
            if any(normalize_internal(raw) == key for raw in (f.tags or []))
        ]
        if book_paths:
            path_set = set(book_paths)
            buckets = {p: [] for p in book_paths}
            depths = system_category_depths(db)
            books = (
                db.query(Book.id, Book.game_system_id, Book.category, Book.relative_path)
                .filter(variants.parent_filter(Book))
                .all()
            )
            for book_id, sys_id, category, rel in books:
                ancestors = _book_folder_ancestor_paths(
                    sys_id or "", category or "", rel, depths.get(sys_id or "", 2)
                )
                for p in ancestors & path_set:
                    buckets[p].append(
                        {"resource_type": _BOOK_RESOURCE_TYPE, "resource_id": book_id}
                    )
            for p in book_paths:
                # Show only the subfolder hierarchy (drop the system_id/category
                # prefix), so the folder title reads like the media pages.
                display_path = "/".join(p.split("/")[2:]) or _book_folder_display(p)
                result.append(
                    {"resource_type": _BOOK_RESOURCE_TYPE, "path": display_path, "items": buckets[p]}
                )
    result.sort(key=lambda f: (f["resource_type"], f["path"].lower()))
    return result


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
