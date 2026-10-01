"""reindex moved books: re-queue books a move left with no search text (#503)

Moving a book - in the app, or on disk where the scan detected the move - deleted
its ``book_search`` rows but left it marked ``indexed``. The scan only indexes
books that are not, so the text was never rebuilt and the book silently dropped
out of full-text search. Moves now keep the rows; this repairs the books earlier
moves already emptied.

A book is reset when it is marked indexed, has nothing outstanding (no OCR
queued, no failure), and has no search rows at all. Clearing its flags hands it
back to the next scan, which re-reads its text layer or queues it for OCR, the
same as a new book.

Two states are left alone because they legitimately have no rows:
``index_error = 'image-only'`` (a scanned book with text recognition off) and
``'no-text'`` (a text document with nothing in it). Re-queuing them would only
re-reach the same answer. A book whose OCR found no text on any page is not
distinguishable from one emptied by a move, so it is read again once.

Data-only and idempotent: once a book is re-indexed it has rows and no longer
matches.

Revision ID: 7d2e9b4f1a63
Revises: c4e8a2f6d913
Create Date: 2026-10-01 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "7d2e9b4f1a63"
down_revision: Union[str, None] = "c4e8a2f6d913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    tables = set(inspect(bind).get_table_names())
    # A fresh database has no books, and ``book_search`` is created after the
    # migrations run, so there is nothing to repair.
    if "books" not in tables or "book_search" not in tables:
        return

    bind.execute(
        text(
            "UPDATE books SET "
            "indexed = 0, index_failed = 0, index_error = '', "
            "ocr_pending = 0, ocr_pages_done = 0, ocr_pages_skipped = 0 "
            "WHERE indexed = 1 "
            "AND COALESCE(index_failed, 0) = 0 "
            "AND COALESCE(ocr_pending, 0) = 0 "
            "AND COALESCE(index_error, '') NOT IN ('image-only', 'no-text') "
            "AND id NOT IN (SELECT DISTINCT book_id FROM book_search)"
        )
    )


def downgrade() -> None:
    # The reset only hands books back to the indexer; there is nothing to undo.
    pass
