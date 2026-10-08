"""Resolving folder tags to the items they cover, in SQL (issue #221).

A folder tag applies to everything at or below the folder carrying it. This used
to be worked out by loading every item's path in the library and walking its
ancestors in Python, on every tag listing - seconds per request on a library of
a few hundred thousand files, for an answer that is a handful of index range
counts. Here each tagged folder becomes a range on the indexed folder
expression (see ``services/browse/paths``), so a tag's coverage costs a query
per tagged folder rather than a pass over the library.

Media folders and book folders address their contents differently (a map
folder path is collection-relative; a book folder is
``{system_id}/{category}/{subfolder…}``), and :class:`FolderResolver` hides the
difference: callers ask it for a folder's scope, count, or ids by
``(resource_type, record path)``.
"""
from __future__ import annotations

from bisect import bisect_left
from dataclasses import dataclass
from itertools import accumulate
from typing import Any, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import variants
from ..browse.paths import folder_prefixes, relative_folder, subtree_clause
from ...models import Book, BookFolder
from ._catalog import default_display, normalize_internal
from ._folders import _BOOK_RESOURCE_TYPE, _FOLDER_SOURCES, _catalog_display_map
from ._paths import _book_folder_display, system_category_depths

_MEDIA_MODELS = {rtype: item_model for _folder_model, item_model, rtype in _FOLDER_SOURCES}


@dataclass(frozen=True)
class TaggedFolder:
    """A folder record that carries at least one tag."""

    resource_type: str
    path: str
    tags: tuple

    @property
    def display_path(self) -> str:
        """How the tags view titles the folder.

        Book folders drop their ``system_id/category`` prefix so the title reads
        like a media folder's.
        """
        if self.resource_type == _BOOK_RESOURCE_TYPE:
            return "/".join(self.path.split("/")[2:]) or _book_folder_display(self.path)
        return self.path

    def carries(self, internal: str) -> bool:
        return any(normalize_internal(raw) == internal for raw in self.tags)


def tagged_folders(db: Session, resource_type: Optional[str] = None) -> list[TaggedFolder]:
    """Every folder record with tags, optionally of one resource type.

    Folder tables hold one row per tagged folder - hundreds at most - so they
    are read whole.
    """
    out: list[TaggedFolder] = []
    for folder_model, _item_model, rtype in _FOLDER_SOURCES:
        if resource_type is not None and rtype != resource_type:
            continue
        for f in db.query(folder_model).all():
            if f.tags:
                out.append(TaggedFolder(rtype, f.path, tuple(f.tags)))
    if resource_type is None or resource_type == _BOOK_RESOURCE_TYPE:
        for f in db.query(BookFolder).all():
            if f.tags:
                out.append(TaggedFolder(_BOOK_RESOURCE_TYPE, f.path, tuple(f.tags)))
    return out


def outermost(paths: list[str]) -> list[str]:
    """``paths`` minus any that sit inside another one in the list.

    A tag on both ``Swamps`` and ``Swamps/Deep`` covers ``Swamps/Deep`` once;
    counting the outermost folders only is what keeps a union from being a sum.
    """
    kept: list[str] = []
    for path in sorted(set(paths)):
        if not any(path.startswith(k + "/") for k in kept):
            kept.append(path)
    return kept


class FolderResolver:
    """Turns folder records into SQL scopes, caching the prefix lookups.

    One resolver per request: the prefixes (``maps/``, or each
    ``books/{System}/{CategoryDir}/``) are looked up once per collection or
    system category, however many folders are resolved.
    """

    def __init__(self, db: Session):
        self.db = db
        self._media_prefixes: dict[str, list[str]] = {}
        self._book_prefixes: dict[tuple[str, str], list[str]] = {}
        self._depths: Optional[dict[str, int]] = None
        # Per collection: the item count of every stored folder, so many
        # folders' subtree counts cost one GROUP BY rather than a query each.
        self._media_hist: dict[str, tuple[list[str], list[int]]] = {}
        self._book_hist: Optional[dict[tuple[str, str], list[tuple[str, int]]]] = None

    def model(self, resource_type: str) -> Any:
        return Book if resource_type == _BOOK_RESOURCE_TYPE else _MEDIA_MODELS.get(resource_type)

    def media_prefixes(self, resource_type: str) -> list[str]:
        """The stored top-level directories of a media collection (``maps/``...)."""
        model = _MEDIA_MODELS[resource_type]
        if resource_type not in self._media_prefixes:
            self._media_prefixes[resource_type] = folder_prefixes(
                self.db, model, [variants.parent_filter(model)], 1
            )
        return self._media_prefixes[resource_type]

    def scope(self, resource_type: str, path: str) -> Optional[tuple[Any, list]]:
        """``(model, criteria)`` selecting the variant parents at or below a folder.

        ``None`` for a record that cannot address anything - an unknown type, or
        a book folder path too short to name a subfolder.
        """
        if resource_type == _BOOK_RESOURCE_TYPE:
            return self._book_scope(path)
        model = _MEDIA_MODELS.get(resource_type)
        if model is None:
            return None
        prefixes = self.media_prefixes(resource_type)
        return model, [variants.parent_filter(model), subtree_clause(model, prefixes, path)]

    def _book_scope(self, path: str) -> Optional[tuple[Any, list]]:
        parts = path.split("/", 2)
        if len(parts) < 3 or not parts[2].strip("/"):
            # A book folder record is always a *sub*folder of a category; a
            # bare system/category path addresses no book folder.
            return None
        system_id, category, sub = parts
        criteria = [
            Book.game_system_id == system_id,
            variants.parent_filter(Book),
            Book.category == category,
        ]
        key = (system_id, category)
        if key not in self._book_prefixes:
            if self._depths is None:
                self._depths = system_category_depths(self.db)
            depth = self._depths.get(system_id, 2)
            # ``books/{System}/{CategoryDir}`` is ``depth + 1`` segments.
            self._book_prefixes[key] = folder_prefixes(self.db, Book, criteria, depth + 1)
        return Book, criteria + [subtree_clause(Book, self._book_prefixes[key], sub)]

    def _media_histogram(self, resource_type: str) -> tuple[list[str], list[int]]:
        """Sorted stored folders of a collection, with running item totals.

        ``totals[i]`` is the number of items in the first ``i`` folders, so the
        items in any key range is a difference of two entries.
        """
        if resource_type not in self._media_hist:
            model = _MEDIA_MODELS[resource_type]
            rows = (
                self.db.query(model.folder_path, func.count())
                .filter(variants.parent_filter(model), model.folder_path.isnot(None))
                .group_by(model.folder_path)
                .order_by(model.folder_path)
                .all()
            )
            keys = [f for f, _n in rows]
            totals = [0, *accumulate(n for _f, n in rows)]
            self._media_hist[resource_type] = (keys, totals)
        return self._media_hist[resource_type]

    def _book_histogram(self) -> dict[tuple[str, str], list[tuple[str, int]]]:
        """``{(system_id, category): [(stored folder, item count)]}`` for every book."""
        if self._book_hist is None:
            rows = (
                self.db.query(Book.game_system_id, Book.category, Book.folder_path, func.count())
                .filter(variants.parent_filter(Book))
                .group_by(Book.game_system_id, Book.category, Book.folder_path)
                .all()
            )
            hist: dict[tuple[str, str], list[tuple[str, int]]] = {}
            for sid, category, folder, n in rows:
                hist.setdefault((sid or "", category or ""), []).append((folder or "", n))
            self._book_hist = hist
        return self._book_hist

    def count(self, resource_type: str, path: str) -> int:
        """Variant parents at or below a folder record, from the cached histograms.

        The same population :meth:`scope` selects, counted in Python: a media
        folder's subtree is a contiguous range of the sorted stored folders (the
        range :func:`subtree_clause` describes), and a book folder's is every
        folder of its system and category whose subfolder sits at or below it.
        """
        if resource_type == _BOOK_RESOURCE_TYPE:
            parts = path.split("/", 2)
            if len(parts) < 3 or not parts[2].strip("/"):
                return 0
            system_id, category, sub = parts
            sub = sub.strip("/")
            if self._depths is None:
                self._depths = system_category_depths(self.db)
            depth = self._depths.get(system_id, 2)
            total = 0
            for folder, n in self._book_histogram().get((system_id, category), []):
                rel = relative_folder(folder, depth + 1)
                if rel == sub or rel.startswith(sub + "/"):
                    total += n
            return total
        if resource_type not in _MEDIA_MODELS:
            return 0
        keys, totals = self._media_histogram(resource_type)
        total = 0
        sub = path.strip("/")
        for prefix in self.media_prefixes(resource_type):
            start = prefix + sub + "/" if sub else prefix
            lo = bisect_left(keys, start)
            hi = bisect_left(keys, start[:-1] + chr(ord("/") + 1))
            total += totals[hi] - totals[lo]
        return total

    def ids(self, resource_type: str, path: str) -> list[str]:
        scope = self.scope(resource_type, path)
        if scope is None:
            return []
        model, criteria = scope
        return [row[0] for row in self.db.query(model.id).filter(*criteria).all()]


def _group_by_tag(
    folders: list[TaggedFolder],
) -> tuple[dict[str, dict[str, list[str]]], dict[str, str]]:
    """``{internal: {resource_type: [paths]}}`` plus each tag's first-seen display."""
    by_tag: dict[str, dict[str, list[str]]] = {}
    display: dict[str, str] = {}
    for folder in folders:
        for raw in folder.tags:
            internal = normalize_internal(raw)
            if not internal:
                continue
            display.setdefault(internal, default_display(raw) or internal)
            by_tag.setdefault(internal, {}).setdefault(folder.resource_type, []).append(
                folder.path
            )
    return by_tag, display


def folder_tag_counts(db: Session, resource_type: Optional[str] = None) -> dict[str, dict]:
    """Folder-derived tags keyed by internal, with how many items each covers.

    Returns ``{internal: {"display", "count", "types", "by_type"}}``. ``count``
    is the number of distinct variant-parent items at or below any folder
    carrying the tag (``by_type`` splits it per resource type); ``types`` the
    resource types it reaches. A tag on folders that hold nothing is left out,
    as it was when this walked the items. The catalog is authoritative for
    display casing (a rename updates the ``Tag`` row); the folder JSON's casing
    is the fallback.

    The counts come from one GROUP BY per collection (see
    :meth:`FolderResolver.count`), so a library with hundreds of tagged folders
    still costs a handful of queries.
    """
    resolver = FolderResolver(db)
    by_tag, display = _group_by_tag(tagged_folders(db, resource_type))
    out: dict[str, dict] = {}
    for internal, per_type in by_tag.items():
        by_type: dict[str, int] = {}
        for rtype, paths in per_type.items():
            n = sum(resolver.count(rtype, path) for path in outermost(paths))
            if n:
                by_type[rtype] = n
        if by_type:
            out[internal] = {
                "display": display[internal],
                "count": sum(by_type.values()),
                "types": set(by_type),
                "by_type": by_type,
            }
    catalog = _catalog_display_map(db, set(out))
    for internal, entry in out.items():
        entry["display"] = catalog.get(internal, entry["display"])
    return out


def folder_tags_in_use(db: Session, resource_type: Optional[str] = None) -> dict[str, dict]:
    """Folder-derived tags keyed by internal, with the item refs they cover.

    Returns ``{internal: {"display": str, "refs": [{resource_type, resource_id}]}}``.
    Materialises every covered id, so the listings use :func:`folder_tag_counts`
    instead; this remains for callers that need the items themselves.
    """
    resolver = FolderResolver(db)
    by_tag, display = _group_by_tag(tagged_folders(db, resource_type))
    out: dict[str, dict] = {}
    for internal, per_type in by_tag.items():
        refs: list[dict] = []
        for rtype, paths in per_type.items():
            for path in outermost(paths):
                refs.extend(
                    {"resource_type": rtype, "resource_id": rid}
                    for rid in resolver.ids(rtype, path)
                )
        if refs:
            out[internal] = {"display": display[internal], "refs": refs}
    catalog = _catalog_display_map(db, set(out))
    for internal, entry in out.items():
        entry["display"] = catalog.get(internal, entry["display"])
    return out


def folder_groups_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Folders carrying the tag, each with how many items it holds.

    Returns ``[{resource_type, path, key, count}]`` sorted by (type, path):
    ``path`` is the display path and ``key`` the record path that
    :class:`FolderResolver` takes to list the folder's items a page at a time.
    Every folder carrying the tag is listed, nested ones included - each is its
    own group in the tags view, as before.
    """
    key = normalize_internal(internal)
    resolver = FolderResolver(db)
    out = [
        {
            "resource_type": f.resource_type,
            "path": f.display_path,
            "key": f.path,
            "count": resolver.count(f.resource_type, f.path),
        }
        for f in tagged_folders(db, resource_type)
        if f.carries(key)
    ]
    out.sort(key=lambda g: (g["resource_type"], g["path"].lower()))
    return out


def folders_for_tag(
    db: Session, internal: str, *, resource_type: Optional[str] = None
) -> list[dict]:
    """Folders carrying the tag, each with every item ref it contains.

    Returns ``[{resource_type, path, items: [{resource_type, resource_id}]}]``.
    For the tag archive download, which needs every file; the tags view pages
    through :func:`folder_groups_for_tag` instead.
    """
    key = normalize_internal(internal)
    resolver = FolderResolver(db)
    out = [
        {
            "resource_type": f.resource_type,
            "path": f.display_path,
            "items": [
                {"resource_type": f.resource_type, "resource_id": rid}
                for rid in resolver.ids(f.resource_type, f.path)
            ],
        }
        for f in tagged_folders(db, resource_type)
        if f.carries(key)
    ]
    out.sort(key=lambda g: (g["resource_type"], g["path"].lower()))
    return out
