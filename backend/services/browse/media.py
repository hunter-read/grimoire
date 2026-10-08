"""Paged, server-side browsing of the media galleries (issue #221).

Maps, tokens, audio and 3D models used to arrive whole - every row streamed to
the browser, which then filtered, sorted and grouped by folder. On a library of
a few hundred thousand files that is tens of megabytes before the search box
sees everything. Here the same filters, sorts and folder grouping run in SQL,
and the gallery asks for one folder's items, or one page of the flat list, at a
time.

One :class:`MediaBrowse` describes what the gallery is showing. ``query`` turns
it into the filtered row query, :func:`page` slices and orders it, and
:func:`groups` returns the folder structure with per-folder counts - all three
reading the same filters, so a folder's count always matches what opening it
lists.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional

from sqlalchemy import false, func, literal_column, nullslast, or_, select
from sqlalchemy.orm import Query, Session

from ...models import Favorite
from ...models.collections import COLLECTIONS
from ..search_query import MEDIA_FIELDS, parse_query
from .. import variants
from .paths import exact_clause, folder_column, folder_prefixes, relative_folder
from .tag_query import TagMatcher

# Accepted ``sort`` values. ``path`` is folder order (the grouped gallery's
# reading order); the rest are the gallery's sort menu.
SORTS = frozenset({"path", "name", "size", "added_at", "title", "duration"})


@dataclass
class MediaBrowse:
    """What a gallery is showing: its filters and its order."""

    q: str = ""
    tags: list = field(default_factory=list)
    favorites: bool = False
    added_since: Optional[datetime] = None
    # Exact folder, collection-relative ("" is the collection root); None for
    # the whole collection.
    folder: Optional[str] = None
    sort: str = "path"
    order: str = "asc"
    # Collection-specific clauses on top (the map list's ``map_type``).
    extra: list = field(default_factory=list)


def rowid(model: Any) -> Any:
    """``model``'s SQLite rowid, the implicit last column of every index."""
    return literal_column(f"{model.__tablename__}.rowid")


class MediaBrowser:
    """Builds the browse queries for one collection and one user."""

    def __init__(self, db: Session, resource_type: str, user_id: str, *, hide_explicit: bool):
        self.db = db
        self.resource_type = resource_type
        self.model = COLLECTIONS[resource_type].model
        self.user_id = user_id
        self.hide_explicit = hide_explicit
        self._prefixes: Optional[list[str]] = None
        self._tags: Optional[TagMatcher] = None

    # -- building blocks -----------------------------------------------------

    @property
    def prefixes(self) -> list[str]:
        """The collection's top-level directory as stored (``tokens/``, ``Tokens/``)."""
        if self._prefixes is None:
            self._prefixes = folder_prefixes(
                self.db, self.model, [variants.parent_filter(self.model)], 1
            )
        return self._prefixes

    @property
    def tag_matcher(self) -> TagMatcher:
        if self._tags is None:
            self._tags = TagMatcher(self.db, self.resource_type, self.model, folder_tags=True)
        return self._tags

    def _folders_matching(self, text: str) -> list[str]:
        """Stored folders whose collection-relative path contains ``text``.

        Matched against the distinct folder list in Python rather than with a
        LIKE over every row's path.
        """
        needle = text.lower()
        return [
            f for f in self.tag_matcher.all_folders() if needle in relative_folder(f, 1).lower()
        ]

    def _name_columns(self) -> list:
        """Columns a ``title:``/free-text search matches as the item's name."""
        cols = [self.model.filename]
        if hasattr(self.model, "title"):
            cols.append(self.model.title)
        return cols

    def _search_clause(self, raw: str) -> Any:
        """The search box, with the main search's ``field:value`` syntax.

        Bare text matches the name, the folder path, or a tag (own or a
        folder's) - what the gallery's client-side search matched. A field
        filter narrows to that field: ``tag:``, ``title:``/``filename:``, and
        ``artist:``/``album:`` where the collection has them. A book-only field
        (``author:``, ``year:``...) describes nothing a gallery item has, so it
        matches nothing rather than being ignored.
        """
        parsed = parse_query(raw)
        clauses = []
        if parsed.free_text:
            text = parsed.free_text
            like = f"%{text}%"
            any_of = [c.ilike(like) for c in self._name_columns()]
            folders = self._folders_matching(text)
            if folders:
                any_of.append(self.tag_matcher.in_folders(folders))
            any_of.append(self.tag_matcher.like(text))
            clauses.append(or_(*any_of))
        for name, values in parsed.filters.items():
            if name not in MEDIA_FIELDS:
                return false()
            if name in ("title", "filename"):
                columns = self._name_columns()
                clauses.append(or_(*[c.ilike(f"%{v}%") for v in values for c in columns]))
            elif name == "tag":
                clauses.append(or_(*[self.tag_matcher.like(v) for v in values]))
            else:  # artist / album
                column = getattr(self.model, name, None)
                if column is None:
                    return false()
                clauses.append(or_(*[column.ilike(f"%{v}%") for v in values]))
        return clauses

    # -- queries -------------------------------------------------------------

    def query(self, params: MediaBrowse, *, columns: Optional[list] = None) -> Query:
        """The filtered rows (unordered), or ``columns`` of them."""
        model = self.model
        q = self.db.query(*columns) if columns else self.db.query(model)
        q = q.filter(variants.parent_filter(model))
        if self.hide_explicit and hasattr(model, "is_explicit"):
            q = q.filter(model.is_explicit != True)  # noqa: E712
        if params.favorites:
            favs = select(Favorite.item_id).where(
                Favorite.user_id == self.user_id, Favorite.item_type == self.resource_type
            )
            q = q.filter(model.id.in_(favs))
        if params.added_since is not None:
            since = params.added_since
            if since.tzinfo is not None:
                since = since.astimezone(timezone.utc).replace(tzinfo=None)
            q = q.filter(model.added_at >= since)
        if params.tags:
            q = q.filter(self.tag_matcher.clause(params.tags))
        if params.q and params.q.strip():
            search = self._search_clause(params.q)
            q = q.filter(*search) if isinstance(search, list) else q.filter(search)
        if params.folder is not None:
            q = q.filter(exact_clause(model, self.prefixes, params.folder))
        if params.extra:
            q = q.filter(*params.extra)
        return q

    def order_by(self, params: MediaBrowse) -> list:
        """ORDER BY terms for ``params.sort``, ties broken to match an index.

        Every sort is made total (so pages never overlap or skip), and each
        tie-break follows the column order of the index that serves that sort -
        ``models/media.py``'s ``_browse_indexes``. Matching it exactly lets
        SQLite read a page straight off the index; a tie-break the index does
        not end in (the ``id``, say) makes it sort every preceding row instead,
        which at offset 150k cost a third of a second to two seconds. The size
        and date indexes end in ``sort_name`` and then, as every SQLite index
        does, the rowid.
        """
        model = self.model
        desc = params.order == "desc"

        def directed(*columns: Any) -> list:
            return [c.desc() if desc else c.asc() for c in columns]

        sort = params.sort if params.sort in SORTS else "path"
        folder = folder_column(model)
        if sort == "name":
            return directed(model.sort_name, folder, model.filename, model.id)
        if sort == "path":
            return directed(folder, model.sort_name, model.filename, model.id)
        tail = directed(model.sort_name, rowid(model))
        if sort == "added_at":
            # Undated items (added before tracking began) last either way.
            return [nullslast(*directed(model.added_at)), *tail]
        if sort == "title" and hasattr(model, "title"):
            title = func.coalesce(func.nullif(model.title, ""), model.filename)
            return [*directed(title.collate("NOCASE")), *tail]
        column = {"size": model.file_size, "duration": getattr(model, "duration", None)}.get(sort)
        if column is None:
            return directed(model.sort_name, folder, model.filename, model.id)
        return [*directed(column), *tail]

    def page(self, params: MediaBrowse, limit: int, offset: int) -> tuple[int, list]:
        """``(total, rows)``: the matching count and one ordered page of rows."""
        q = self.query(params)
        total = q.order_by(None).count()
        rows = q.order_by(*self.order_by(params)).offset(offset).limit(limit).all()
        return total, rows

    def groups(self, params: MediaBrowse) -> tuple[int, list[dict]]:
        """``(total, [{path, count}])``: every folder holding matching items.

        ``path`` is collection-relative, ``""`` for items at the collection
        root. Grouped from the indexed folder expression, then merged by
        relative path, since a library can hold the same tree under two casings
        of the top-level directory.
        """
        column = folder_column(self.model)
        rows = (
            self.query(params, columns=[column, func.count(literal_column("*"))])
            .group_by(column)
            .all()
        )
        merged: dict[str, int] = {}
        for folder, count in rows:
            path = relative_folder(folder or "", 1)
            merged[path] = merged.get(path, 0) + count
        groups = [{"path": p, "count": n} for p, n in sorted(merged.items())]
        return sum(merged.values()), groups
