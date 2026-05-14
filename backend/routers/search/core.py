"""Full-text search endpoint handlers."""
from typing import Optional

from fastapi import Query
from sqlalchemy import text

from ...config import SessionLocal
from ...models import Book, GameSystem
from ._helpers import _CATEGORY_PRIORITY, _search_maps, _search_tokens


def search_library(
    q: str = Query(..., min_length=2),
    limit: int = Query(50, le=200),
    book_id: Optional[str] = None,
    system_id: Optional[str] = None,
):
    db = SessionLocal()
    try:
        if book_id:
            sql = text(
                """
                SELECT book_id, page_number,
                       snippet(book_search, 2, '<mark>', '</mark>', '...', 40) as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query AND book_id = :book_id
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(sql, {"query": q, "book_id": book_id, "limit": limit}).fetchall()
        elif system_id:
            sql = text(
                """
                SELECT book_id, page_number,
                       snippet(book_search, 2, '<mark>', '</mark>', '...', 40) as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query
                  AND book_id IN (SELECT id FROM books WHERE game_system_id = :system_id)
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(sql, {"query": q, "system_id": system_id, "limit": limit}).fetchall()
        else:
            sql = text(
                """
                SELECT book_id, page_number,
                       snippet(book_search, 2, '<mark>', '</mark>', '...', 40) as snippet,
                       rank
                FROM book_search
                WHERE content MATCH :query
                ORDER BY rank
                LIMIT :limit
            """
            )
            rows = db.execute(sql, {"query": q, "limit": limit}).fetchall()

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
                    {**book_cache[bid], "page_number": row[1], "snippet": row[2], "_rank": row[3]}
                )

        # Re-sort: category priority first, then BM25 rank (more negative = better match)
        enriched.sort(key=lambda r: (_CATEGORY_PRIORITY.get(r["category"], 99), r["_rank"]))
        for r in enriched:
            del r["_rank"]

        maps = []
        tokens = []
        if not book_id and not system_id:
            maps = _search_maps(db, q)
            tokens = _search_tokens(db, q)

        return {
            "query": q,
            "total": len(enriched) + len(maps) + len(tokens),
            "results": enriched,
            "maps": maps,
            "tokens": tokens,
        }
    finally:
        db.close()
