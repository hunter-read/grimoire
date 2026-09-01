"""Full-text search endpoint handlers."""
from typing import Optional

from fastapi import Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Book, GameSystem
from ...services import access_control
from ._books import search_book_metadata
from ._query import FIELD_ALIASES, parse_query
from ._helpers import (
    SNIPPET_SQL,
    access_clause,
    VISIBLE_BOOKS_SQL,
    _CATEGORY_PRIORITY,
    _search_audio,
    _search_maps,
    _search_tokens,
    escape_snippet,
)


def search_library(
    q: str = Query(..., min_length=2),
    limit: int = Query(50, le=200),
    book_id: Optional[str] = None,
    system_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    # snippet() wraps matches in NUL sentinels, not literal <mark> tags; the
    # untrusted surrounding text is HTML-escaped and the sentinels swapped for
    # real <mark> tags in escape_snippet() below (the client renders the snippet
    # via dangerouslySetInnerHTML). See ._helpers.SNIPPET_SQL / escape_snippet.
    #
    # Access restrictions (issue #258) are applied *inside* each FTS query
    # rather than to its results: the LIMIT runs first, so filtering afterwards
    # would silently return a short page — and, worse, a page whose length tells
    # the user how many restricted books matched. Every branch below gets the
    # clause, including the book_id and system_id ones, so a restricted book
    # cannot be searched by naming it directly.
    user = access_control.load_user(db, current_user)
    excluded = access_control.restricted_book_ids(db, user)
    access_sql, access_params = access_clause(excluded)

    # Field-scoped query syntax (issue #343). ``title:avatar`` searches book
    # titles and stops there; a bare query still searches page text, but now
    # matches titles alongside it so "do I own this?" is answerable from the
    # global search box.
    parsed = parse_query(q)
    content_q = parsed.content_query

    rows = []
    if content_q:
        if book_id:
            sql = text(
                f"""
                SELECT book_id, page_number,
                       {SNIPPET_SQL} as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query AND book_id = :book_id
                  {access_sql}
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(
                sql, {"query": content_q, "book_id": book_id, "limit": limit, **access_params}
            ).fetchall()
        elif system_id:
            sql = text(
                f"""
                SELECT book_id, page_number,
                       {SNIPPET_SQL} as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query
                  AND book_id IN (
                      SELECT id FROM books
                      WHERE game_system_id = :system_id AND variant_parent_id IS NULL
                  )
                  {access_sql}
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(
                sql, {"query": content_q, "system_id": system_id, "limit": limit, **access_params}
            ).fetchall()
        else:
            sql = text(
                f"""
                SELECT book_id, page_number,
                       {SNIPPET_SQL} as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query
                  AND {VISIBLE_BOOKS_SQL}
                  {access_sql}
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(
                sql, {"query": content_q, "limit": limit, **access_params}
            ).fetchall()

    enriched = []
    book_cache = {}
    for row in rows:
        bid = row[0]
        if bid not in book_cache:
            book = db.query(Book).filter_by(id=bid).first()
            if book:
                system = (
                    db.query(GameSystem).filter_by(id=book.game_system_id).first()
                    if book.game_system_id
                    else None
                )
                book_cache[bid] = {
                    "id": book.id,
                    "title": book.title,
                    "game_system": system.name if system else "",
                    "game_system_id": book.game_system_id or "",
                    "category": book.category,
                }
        if bid in book_cache:
            enriched.append(
                {
                    **book_cache[bid],
                    "page_number": row[1],
                    "snippet": escape_snippet(row[2]),
                    "_rank": row[3],
                }
            )

    # Re-sort: category priority first, then BM25 rank (more negative = better match)
    enriched.sort(key=lambda r: (_CATEGORY_PRIORITY.get(r["category"], 99), r["_rank"]))
    for r in enriched:
        del r["_rank"]

    # Books whose own title/metadata match, returned separately so the client can
    # pin them above the page hits. Scoped to one book_id there is nothing to
    # pin — the user is already inside that book — so the lookup is skipped.
    book_matches = []
    if not book_id:
        book_matches = search_book_metadata(db, parsed, user, system_id=system_id)

    maps = []
    tokens = []
    audio = []
    if not book_id and not system_id:
        maps = _search_maps(db, parsed)
        tokens = _search_tokens(db, parsed)
        audio = _search_audio(db, parsed)

    return {
        "query": q,
        # Counts every distinct thing shown. A book matching by title *and* by
        # page text is one row in book_matches plus its page hits; both are
        # displayed, so both are counted.
        "total": len(enriched) + len(book_matches) + len(maps) + len(tokens) + len(audio),
        "results": enriched,
        "book_matches": book_matches,
        "maps": maps,
        "tokens": tokens,
        "audio": audio,
        # Echoed back so the client can show what it understood and, when a
        # filter is active, explain why the content section is empty.
        "fields": sorted(parsed.filters.keys()),
    }


def search_fields():
    """The field prefixes the search box accepts, for the in-app help popover.

    Served from the same table the parser uses, so the documented list cannot
    drift from the implemented one.
    """
    canonical: dict[str, list[str]] = {}
    for alias, field_name in FIELD_ALIASES.items():
        canonical.setdefault(field_name, []).append(alias)
    return {
        "fields": [
            {"field": name, "aliases": sorted(a for a in aliases if a != name)}
            for name, aliases in sorted(canonical.items())
        ]
    }
