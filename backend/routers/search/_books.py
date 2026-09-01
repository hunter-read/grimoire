"""Book metadata matching for the search API (issue #343).

Complements the FTS5 page-text search in ``core.py``. Where that answers "which
page mentions this?", this answers "do I own this?" — matching a book's own
title, authors, publisher, system, category, tags, and identifiers rather than
the text inside it.

The two run side by side on every unscoped search: a bare query matches titles
*and* page text, and title matches are returned separately so the client can pin
them above the page hits. A ``field:`` filter suppresses the text half entirely
(see ``_query.ParsedQuery.content_query``).
"""
from __future__ import annotations

from typing import Any, Optional

from sqlalchemy import String, cast, or_
from sqlalchemy.orm import Session

from ...models import Book, GameSystem, ResourceTag, Tag
from ...services import access_control, tag_service, variants
from ._query import BOOK_FIELDS, ParsedQuery, year_bounds

# Ceiling on title-match rows. Generous relative to what a person reads, but
# bounded so a one-letter filter (``language:e``) cannot select the library.
TITLE_MATCH_LIMIT = 50


def _tagged_book_ids(db: Session, terms: list[str]) -> set[str]:
    """Book ids carrying a tag matching any of ``terms`` (substring, ILIKE)."""
    clauses = []
    for term in terms:
        like = f"%{term}%"
        clauses.append(or_(Tag.display.ilike(like), Tag.internal.ilike(like)))
    if not clauses:
        return set()
    rows = (
        db.query(ResourceTag.resource_id)
        .join(Tag, Tag.id == ResourceTag.tag_id)
        .filter(ResourceTag.resource_type == "book", or_(*clauses))
        .all()
    )
    return {r[0] for r in rows}


def _json_list_clause(column: Any, term: str) -> Any:
    """Substring match against a JSON list column (``authors``, ``artists``).

    These are stored as JSON arrays rather than a join table, so the match is a
    cast-to-text ILIKE. It can in principle match JSON punctuation, but a term
    of ``["`` is not a search anyone runs, and the alternative — a join table
    migration for two rarely-filtered fields — is not worth the cost.
    """
    return cast(column, String).ilike(f"%{term}%")


def _any_of(column_clause_builder: Any, terms: list[str]) -> Any:
    """OR together one clause per value of a repeated field."""
    return or_(*[column_clause_builder(t) for t in terms])


def _apply_field_filters(db: Session, query: Any, parsed: ParsedQuery) -> Optional[Any]:
    """AND every recognised book filter onto ``query``.

    Returns ``None`` when a filter cannot possibly match a book (a ``year:``
    range that is empty, say), so the caller can skip the query entirely rather
    than run one guaranteed to return nothing.
    """
    for field_name, values in parsed.filters.items():
        if field_name == "text":
            continue  # handled by FTS, not here
        elif field_name == "title":
            query = query.filter(_any_of(lambda t: Book.title.ilike(f"%{t}%"), values))
        elif field_name == "author":
            query = query.filter(_any_of(lambda t: _json_list_clause(Book.authors, t), values))
        elif field_name == "artist":
            query = query.filter(_any_of(lambda t: _json_list_clause(Book.artists, t), values))
        elif field_name == "publisher":
            query = query.filter(_any_of(lambda t: Book.publisher.ilike(f"%{t}%"), values))
        elif field_name == "category":
            query = query.filter(_any_of(lambda t: Book.category.ilike(f"%{t}%"), values))
        elif field_name == "isbn":
            query = query.filter(_any_of(lambda t: Book.isbn.ilike(f"%{t}%"), values))
        elif field_name == "language":
            query = query.filter(_any_of(lambda t: Book.language.ilike(f"%{t}%"), values))
        elif field_name == "description":
            query = query.filter(_any_of(lambda t: Book.description.ilike(f"%{t}%"), values))
        elif field_name == "filename":
            query = query.filter(_any_of(lambda t: Book.filename.ilike(f"%{t}%"), values))
        elif field_name == "system":
            # Match the system by name or slug. A subquery rather than a join so
            # repeated filters stay composable and books with no system simply
            # fail the IN rather than dropping out of a join.
            sub = db.query(GameSystem.id).filter(
                _any_of(
                    lambda t: or_(GameSystem.name.ilike(f"%{t}%"), GameSystem.slug.ilike(f"%{t}%")),
                    values,
                )
            )
            query = query.filter(Book.game_system_id.in_(sub))
        elif field_name == "tag":
            ids = _tagged_book_ids(db, values)
            if not ids:
                return None
            query = query.filter(Book.id.in_(ids))
        elif field_name == "year":
            low, high = year_bounds(values)
            if low is not None and high is not None and low > high:
                return None
            if low is not None:
                query = query.filter(Book.year >= low)
            if high is not None:
                query = query.filter(Book.year <= high)
    return query


def _free_text_clause(term: str) -> Any:
    """What a bare (unprefixed) query matches on a book row.

    Title first and foremost — that is what someone typing "Avatar" means — plus
    the filename, so a book whose title never got cleaned up is still findable
    by the name on disk.
    """
    like = f"%{term}%"
    return or_(Book.title.ilike(like), Book.filename.ilike(like))


def search_book_metadata(
    db: Session,
    parsed: ParsedQuery,
    user: Any,
    *,
    system_id: Optional[str] = None,
    limit: int = TITLE_MATCH_LIMIT,
) -> list[dict]:
    """Books whose own metadata matches the query, best match first.

    Access-restricted books are filtered inside the query via
    ``access_control.visible_books`` rather than afterwards, for the same reason
    the FTS branches do it: the LIMIT runs first, so a post-filter would return a
    short page whose length leaks how many restricted books matched.
    """
    # A filter naming only media fields (``album:``, ``artist:``) describes
    # nothing a book has. Returning an unfiltered book list would answer a
    # question nobody asked — and, since the filter loop below simply skips
    # fields it does not handle, that is exactly what an unguarded query does.
    if parsed.has_filters and not (parsed.metadata_fields & BOOK_FIELDS):
        return []

    query = db.query(Book).filter(variants.parent_filter(Book))
    if system_id:
        query = query.filter(Book.game_system_id == system_id)

    if parsed.has_filters:
        filtered = _apply_field_filters(db, query, parsed)
        if filtered is None:
            return []
        query = filtered
        # A filtered query may still carry free text ("title:avatar legends"):
        # treat the leftovers as an additional title constraint rather than
        # dropping them, which would silently widen the search.
        if parsed.free_text and parsed.metadata_fields:
            query = query.filter(_free_text_clause(parsed.free_text))
    elif parsed.free_text:
        query = query.filter(_free_text_clause(parsed.free_text))
    else:
        return []

    query = access_control.visible_books(db, query, user)
    books = query.limit(limit).all()

    ranked = sorted(books, key=lambda b: _title_rank(b, parsed))
    return _serialize(db, ranked)


def _title_rank(book: Book, parsed: ParsedQuery) -> tuple:
    """Sort key: exact title, then prefix, then substring, then alphabetical.

    A search for "Avatar" should put "Avatar Legends" above "The Art of Avatar",
    and an exact title above both.
    """
    needle = " ".join(parsed.values("title")) or parsed.free_text
    title = (book.title or "").lower()
    n = needle.lower().strip()
    if not n:
        return (3, title)
    if title == n:
        return (0, title)
    if title.startswith(n):
        return (1, title)
    return (2, title)


def _serialize(db: Session, books: list[Book]) -> list[dict]:
    ids = [b.id for b in books]
    tags = tag_service.display_tags_for_resources(db, "book", ids)
    system_ids = {b.game_system_id for b in books if b.game_system_id}
    systems = (
        {s.id: s.name for s in db.query(GameSystem).filter(GameSystem.id.in_(system_ids)).all()}
        if system_ids
        else {}
    )
    return [
        {
            "id": b.id,
            "title": b.title,
            "game_system": systems.get(b.game_system_id or "", ""),
            "game_system_id": b.game_system_id or "",
            "category": b.category,
            "authors": list(b.authors or []),
            "publisher": b.publisher or "",
            "year": b.year,
            "page_count": b.page_count or 0,
            "has_thumbnail": bool(b.has_thumbnail),
            "tags": tags.get(b.id, []),
        }
        for b in books
    ]
