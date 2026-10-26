"""books.text_pages: how many pages a book's own text layer covers

Adds ``books.text_pages``, the number of pages that yielded text from the book's
own text layer when it was indexed. Re-OCR is offered for a book whose text
covers less than ``OCR_MIN_TEXT_COVERAGE`` of its pages, and working that out
from ``book_search`` means a full scan of the search index for every book - the
FTS table cannot index ``book_id``.

Backfilled for books indexed from their own text layer with one pass over the
search index (seconds on a large library), so existing books are judged
straight away. Books OCR'd or not yet indexed stay NULL: the first are
re-OCR-able anyway, and the indexer fills the rest in. Idempotent.

Revision ID: 5d1e8a3c7b20
Revises: 2369ce04d145
Create Date: 2026-10-26 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "5d1e8a3c7b20"
down_revision: Union[str, None] = "2369ce04d145"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in inspect(bind).get_columns("books")}
    if "text_pages" not in columns:
        op.add_column("books", sa.Column("text_pages", sa.Integer(), nullable=True))
    if not inspect(bind).has_table("book_search"):
        return
    # Counted once into a temp table: a correlated count per book would scan the
    # whole search index once per book.
    op.execute("DROP TABLE IF EXISTS _text_pages")
    op.execute(
        "CREATE TEMP TABLE _text_pages AS "
        "SELECT book_id, COUNT(*) AS pages FROM book_search GROUP BY book_id"
    )
    op.execute("CREATE INDEX _text_pages_book ON _text_pages (book_id)")
    op.execute(
        "UPDATE books SET text_pages = COALESCE("
        " (SELECT pages FROM _text_pages t WHERE t.book_id = books.id), 0"
        ") WHERE text_pages IS NULL AND indexed = 1 AND COALESCE(index_error, '') = ''"
        " AND mime_type = 'application/pdf'"
    )
    op.execute("DROP TABLE _text_pages")


def downgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("books")}
    if "text_pages" in columns:
        op.execute("ALTER TABLE books DROP COLUMN text_pages")
