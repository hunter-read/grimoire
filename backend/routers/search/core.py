"""Full-text search endpoint handlers."""
from typing import Optional

from fastapi import Depends, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Book, GameSystem
from ...services import access_control
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
            sql, {"query": q, "book_id": book_id, "limit": limit, **access_params}
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
            sql, {"query": q, "system_id": system_id, "limit": limit, **access_params}
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
        rows = db.execute(sql, {"query": q, "limit": limit, **access_params}).fetchall()

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

    maps = []
    tokens = []
    audio = []
    if not book_id and not system_id:
        maps = _search_maps(db, q)
        tokens = _search_tokens(db, q)
        audio = _search_audio(db, q)

    return {
        "query": q,
        "total": len(enriched) + len(maps) + len(tokens) + len(audio),
        "results": enriched,
        "maps": maps,
        "tokens": tokens,
        "audio": audio,
    }
