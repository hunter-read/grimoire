"""A system's shelf, browsed a page at a time (issue #221).

``GET /systems/{id}`` used to carry every book in the system, and the detail
view filtered, sorted, and grouped them by category and subfolder in the
browser. A system holding tens of thousands of books made that a 20+ MB
response before anything rendered. The shelf is now three requests that share
one set of filters:

* ``/book-groups`` - the categories and subfolders holding matching books, with
  counts, which is enough to draw the collapsed shelf;
* ``/books`` - one page of books: of one folder (``category`` + ``folder``), or
  of the whole flat list;
* ``/book-facets`` - the values the filter menus offer (tags, genres, product
  code prefixes, categories), drawn from the whole unfiltered shelf.

A book's subfolder is the part of its path below the category directory - the
same rule as ``getBookSubfolderPath`` in the frontend - so ``folder`` here and
a folder in the client's tree always name the same books.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Literal, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy import exists, func, literal_column, nullslast, or_, select
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Book, Favorite, GameSystem, ResourceTag, Tag, User
from ...models.browse import natural_key
from ...services import access_control, tag_service, variants
from ...services.browse.paths import relative_folder
from ...services.browse.tag_query import FILTER_ANY, FILTER_NONE, TagMatcher
from ...services.search_query import parse_query
from .._browse import parse_tags_param
from ..search._books import _apply_field_filters, _free_text_clause
from ._serializers import _category_depth, serialize_book

BOOK_SORTS = frozenset({"title", "year", "page_count", "size", "product_code", "added_at"})

# Sorts whose folder stand-in is a column value (see ``ShelfBrowser.groups``).
_SORT_COLUMNS = {
    "year": Book.year,
    "page_count": Book.page_count,
    "size": Book.file_size,
    "added_at": Book.added_at,
}


@dataclass
class BookBrowse:
    """What the shelf is showing: its filters and its order."""

    q: str = ""
    tags: list = field(default_factory=list)
    favorites: bool = False
    added_since: Optional[datetime] = None
    explicit: Optional[bool] = None
    genre: Optional[str] = None
    product_code: Optional[str] = None
    category: Optional[str] = None
    # Subfolder below the category directory ("" for the category root); only
    # with ``category``.
    folder: Optional[str] = None
    sort: str = "title"
    order: str = "asc"


def book_browse_params(
    q: str = Query(
        "",
        description=(
            "Search text: title, filename or product code, plus the search page's "
            "`field:value` prefixes (`author:`, `year:`, `tag:`, `code:`, `publisher:`...)."
        ),
    ),
    tags: Optional[str] = Query(
        None,
        description=(
            "Tag filter as JSON: `{mode, tags}` groups or a flat list (see the media "
            "list endpoints). Matches the book's own tags."
        ),
    ),
    favorites: bool = Query(False, description="Only the caller's favorites."),
    added_since: Optional[datetime] = Query(None),
    explicit: Optional[bool] = Query(None, description="Only explicit (true) or not (false)."),
    genre: Optional[str] = Query(
        None, description="A genre, or `__grim:none__`/`__grim:any__`."
    ),
    product_code: Optional[str] = Query(
        None,
        description="A product-code prefix (`PZO`), or `__grim:none__`/`__grim:any__`.",
    ),
    category: Optional[str] = Query(None, description="Only this category."),
    folder: Optional[str] = Query(
        None,
        description=(
            "Only books directly in this subfolder of `category` (`\"\"` for the "
            "category's own directory)."
        ),
    ),
    sort: str = Query("title", description=f"One of: {', '.join(sorted(BOOK_SORTS))}."),
    order: Literal["asc", "desc"] = Query("asc"),
) -> BookBrowse:
    if sort not in BOOK_SORTS:
        raise HTTPException(422, f"sort must be one of: {', '.join(sorted(BOOK_SORTS))}")
    if folder is not None and category is None:
        raise HTTPException(400, "folder needs a category")
    return BookBrowse(
        q=q,
        tags=parse_tags_param(tags),
        favorites=favorites,
        added_since=added_since,
        explicit=explicit,
        genre=genre,
        product_code=product_code,
        category=category,
        folder=folder,
        sort=sort,
        order=order,
    )


def _escape_like(text: str) -> str:
    return text.replace("!", "!!").replace("%", "!%").replace("_", "!_")


def _is_blank(column: Any) -> Any:
    return or_(column.is_(None), column == "")


class ShelfBrowser:
    """Builds the browse queries for one system's shelf and one user."""

    def __init__(self, db: Session, system: GameSystem, current_user: CurrentUser):
        self.db = db
        self.system = system
        self.access_user = access_control.load_user(db, current_user)
        self.user_id = current_user.id
        row = db.query(User.allow_explicit).filter(User.id == current_user.id).first()
        self.see_explicit = bool(row[0]) if row and row[0] is not None else True
        # Index of the category directory in the book's path segments.
        self.depth = _category_depth(system)

    def base(self, columns: Optional[list] = None) -> Any:
        """Every book on this shelf the user may see, before any filter."""
        q = self.db.query(*columns) if columns else self.db.query(Book)
        q = q.filter(Book.game_system_id == self.system.id, variants.parent_filter(Book))
        if not self.see_explicit:
            q = q.filter(Book.is_explicit != True)  # noqa: E712
        return access_control.visible_books(self.db, q, self.access_user)

    def subfolder(self, folder_path: Optional[str]) -> str:
        """A stored ``folder_path`` as the subfolder below its category directory."""
        return relative_folder(folder_path or "", self.depth + 1)

    def _genre_clause(self, genre: str) -> Any:
        empty = or_(Book.genres.is_(None), func.json_array_length(Book.genres) == 0)
        if genre == FILTER_NONE:
            return empty
        if genre == FILTER_ANY:
            return ~empty
        entries = func.json_each(Book.genres).table_valued("value")
        return exists(
            select(literal_column("1"))
            .select_from(entries)
            .where(func.lower(entries.c.value) == genre.strip().lower())
        )

    def _code_clause(self, prefix: str) -> Any:
        if prefix == FILTER_NONE:
            return _is_blank(Book.product_code)
        if prefix == FILTER_ANY:
            return ~_is_blank(Book.product_code)
        # LIKE is case-insensitive for ASCII, matching the client's upper-cased
        # prefix comparison.
        return Book.product_code.like(f"{_escape_like(prefix)}%", escape="!")

    def _folders_in_category(self, category: str, sub: str) -> list[str]:
        """The stored folders of ``category`` whose subfolder is exactly ``sub``."""
        rows = (
            self.db.query(Book.folder_path)
            .filter(
                Book.game_system_id == self.system.id,
                variants.parent_filter(Book),
                Book.category == category,
            )
            .distinct()
            .all()
        )
        wanted = sub.strip("/")
        return [f or "" for (f,) in rows if self.subfolder(f) == wanted]

    def query(self, params: BookBrowse, columns: Optional[list] = None) -> Any:
        """The filtered books (unordered), or ``columns`` of them."""
        q = self.base(columns)
        if params.explicit is not None:
            q = q.filter(Book.is_explicit == params.explicit)
        if params.favorites:
            favs = select(Favorite.item_id).where(
                Favorite.user_id == self.user_id, Favorite.item_type == "book"
            )
            q = q.filter(Book.id.in_(favs))
        if params.added_since is not None:
            since = params.added_since
            if since.tzinfo is not None:
                since = since.astimezone(timezone.utc).replace(tzinfo=None)
            q = q.filter(Book.added_at >= since)
        if params.genre:
            q = q.filter(self._genre_clause(params.genre))
        if params.product_code:
            q = q.filter(self._code_clause(params.product_code))
        if params.tags:
            q = q.filter(TagMatcher(self.db, "book", Book, folder_tags=False).clause(params.tags))
        if params.q and params.q.strip():
            parsed = parse_query(params.q)
            if parsed.free_text:
                # Title, filename or product code - what the search page's bare
                # text matches on a book, so the shelf finds the same books.
                q = q.filter(_free_text_clause(parsed.free_text))
            if parsed.metadata_fields:
                filtered = _apply_field_filters(self.db, q, parsed)
                q = filtered if filtered is not None else q.filter(literal_column("0") == 1)
        if params.category is not None:
            q = q.filter(Book.category == params.category)
        if params.folder is not None and params.category is not None:
            folders = self._folders_in_category(params.category, params.folder)
            q = q.filter(Book.folder_path.in_(folders) if folders else literal_column("0") == 1)
        return q

    def order_by(self, params: BookBrowse) -> list:
        """ORDER BY for ``params.sort``; ties fall back to title, then id.

        Mirrors ``bookComparator`` in the frontend: books with no year or date
        sort last whichever way the list runs.
        """
        desc = params.order == "desc"

        def directed(column: Any) -> Any:
            return column.desc() if desc else column.asc()

        tail = [directed(Book.sort_title), directed(Book.id)]
        if params.sort == "title":
            return tail
        column = _SORT_COLUMNS.get(params.sort)
        if column is None:
            return tail
        if params.sort in ("year", "added_at"):
            return [nullslast(directed(column)), *tail]
        return [directed(func.coalesce(column, 0)), *tail]

    def page(self, params: BookBrowse, limit: int, offset: int) -> tuple[int, list[Book]]:
        """``(total, books)``: the matching count and one ordered page."""
        q = self.query(params)
        total = q.order_by(None).count()
        if params.sort == "product_code":
            return total, self._page_by_code(q, params, limit, offset)
        return total, q.order_by(*self.order_by(params)).offset(offset).limit(limit).all()

    def _page_by_code(self, q: Any, params: BookBrowse, limit: int, offset: int) -> list[Book]:
        """A page in product-code order: natural ("PZO9001" before "PZO10000").

        SQLite cannot order naturally, so the codes of the matching books (a
        narrow query - id, code, title) are sorted here, then the page's rows
        fetched. Books with no code come after those with one, either way.
        """
        rows = q.with_entities(Book.id, Book.product_code, Book.sort_title).all()
        coded = [r for r in rows if r[1]]
        blank = [r for r in rows if not r[1]]
        reverse = params.order == "desc"
        coded.sort(key=lambda r: (natural_key(r[1]), r[2] or "", r[0]), reverse=reverse)
        blank.sort(key=lambda r: (r[2] or "", r[0]), reverse=reverse)
        ids = [r[0] for r in (coded + blank)[offset : offset + limit]]
        found = {b.id: b for b in self.db.query(Book).filter(Book.id.in_(ids))}
        return [found[i] for i in ids if i in found]

    def groups(self, params: BookBrowse) -> tuple[int, list[dict]]:
        """``(total, folders)``: every (category, subfolder) holding matches.

        Each entry is one stored directory: ``{category, path, dir, count,
        first}``. ``path`` is the subfolder below the category directory ("" for
        books directly in it) and ``dir`` the library-relative directory, which
        the client uses for rescan scopes. Two directories can map to the same
        ``(category, path)`` - a category spread over two category folders - and
        are returned separately for the client to merge.

        ``first`` is the active sort's value for the first book of the folder
        under that sort, which is what a folder sorts by when folders are mixed
        in among books (``orderedEntries`` in the frontend). ``None`` for the
        title sort, where a folder sorts by its own name.
        """
        cols = [Book.category, Book.folder_path, func.count(literal_column("*"))]
        column = _SORT_COLUMNS.get(params.sort)
        desc = params.order == "desc"
        if column is not None:
            cols.append(func.max(column) if desc else func.min(column))
        rows = self.query(params, columns=cols).group_by(Book.category, Book.folder_path).all()

        firsts: dict[tuple, Any] = {}
        if params.sort == "product_code":
            firsts = self._first_codes(params, desc)

        out = []
        for row in rows:
            category, folder, count = row[0], row[1], row[2]
            first = row[3] if column is not None else firsts.get((category, folder))
            if isinstance(first, datetime):
                first = first.replace(tzinfo=timezone.utc).isoformat()
            out.append(
                {
                    "category": category or "core",
                    "path": self.subfolder(folder),
                    "dir": (folder or "").rstrip("/"),
                    "count": count,
                    "first": first,
                }
            )
        out.sort(key=lambda g: (g["category"], g["path"].lower(), g["dir"]))
        return sum(g["count"] for g in out), out

    def _first_codes(self, params: BookBrowse, desc: bool) -> dict[tuple, Optional[str]]:
        """Per stored folder, the code that sorts first naturally (None if none)."""
        rows = self.query(
            params, columns=[Book.category, Book.folder_path, Book.product_code]
        ).filter(~_is_blank(Book.product_code))
        best: dict[tuple, tuple] = {}
        for category, folder, code in rows:
            key = (category, folder)
            nat = natural_key(code)
            if key not in best or (nat > best[key][0] if desc else nat < best[key][0]):
                best[key] = (nat, code)
        return {k: v[1] for k, v in best.items()}

    def facets(self) -> dict:
        """The filter menus' options, over the whole visible shelf."""
        categories = sorted(
            {c for (c,) in self.base([Book.category]).distinct() if c}
        )
        genres: set[str] = set()
        for (raw,) in self.base([Book.genres]).distinct():
            values = raw
            if isinstance(raw, str):
                try:
                    values = json.loads(raw)
                except ValueError:
                    values = [raw]
            for g in values or []:
                if isinstance(g, str) and g.strip():
                    genres.add(g.strip())
        prefixes: set[str] = set()
        for (code,) in self.base([Book.product_code]).filter(~_is_blank(Book.product_code)).distinct():
            lead = ""
            for ch in code:
                if not ch.isalpha() or not ch.isascii():
                    break
                lead += ch
            if lead:
                prefixes.add(lead.upper())
        ids = self.base([Book.id]).subquery()
        tags = sorted(
            {
                d
                for (d,) in self.db.query(Tag.display)
                .join(ResourceTag, ResourceTag.tag_id == Tag.id)
                .filter(
                    ResourceTag.resource_type == "book",
                    ResourceTag.resource_id.in_(select(ids.c.id)),
                )
                .distinct()
            },
            key=str.lower,
        )
        return {
            "categories": categories,
            "genres": sorted(genres, key=str.lower),
            "product_code_prefixes": sorted(prefixes),
            "tags": tags,
        }


def _load_system(db: Session, system_id: str, current_user: CurrentUser) -> GameSystem:
    """The system, or 404 when it is missing or hidden from this user."""
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    user = db.query(User).filter_by(id=current_user.id).first()
    see_explicit = bool(user.allow_explicit) if user and user.allow_explicit is not None else True
    if system.is_explicit and not see_explicit:
        raise HTTPException(404, "System not found")
    if not access_control.can_access_system(db, user, system):
        raise HTTPException(404, "System not found")
    return system


def list_system_books(
    system_id: str,
    limit: int = Query(100, ge=1, le=500),
    offset: int = Query(0, ge=0),
    params: BookBrowse = Depends(book_browse_params),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One page of the system's books matching the filters."""
    system = _load_system(db, system_id, current_user)
    total, books = ShelfBrowser(db, system, current_user).page(params, limit, offset)
    ids = [b.id for b in books]
    book_tags = tag_service.display_tags_for_resources(db, "book", ids)
    vcounts = variants.variant_counts(db, Book, ids)
    return {
        "total": total,
        "books": [
            serialize_book(b, tags=book_tags.get(b.id, []), variant_count=vcounts.get(b.id, 0))
            for b in books
        ],
    }


def list_system_book_groups(
    system_id: str,
    params: BookBrowse = Depends(book_browse_params),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every category and subfolder holding matching books, with counts."""
    system = _load_system(db, system_id, current_user)
    total, groups = ShelfBrowser(db, system, current_user).groups(params)
    return {"total": total, "groups": groups}


def list_system_book_facets(
    system_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The values the shelf's filter menus offer, over every visible book."""
    system = _load_system(db, system_id, current_user)
    return ShelfBrowser(db, system, current_user).facets()

