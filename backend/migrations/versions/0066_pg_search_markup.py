"""PostgreSQL search: index the words in text that looks like markup

PostgreSQL's text search parser takes ``<goblin king>`` for an XML tag and
``&amp;`` for an entity, and indexes nothing of either, where SQLite's FTS5
tokenizer splits on the punctuation and indexes the words. So page text inside
angle brackets was found on SQLite but not on PostgreSQL. The generated
``tsvector`` columns ``book_pages.search`` and ``content_search.search`` now
read ``<`` and ``&`` as spaces (``MARKUP_CHARS`` in backend/models/postgres.py),
as do the search terms.

PostgreSQL before 17 cannot change a generated column's expression, so each
column is dropped and added again with its GIN index. That recomputes it for
every row from the text already stored - no book is re-read - in one pass over
the table, which on a large library takes a few minutes, once.

Nothing to do on SQLite. Skipped where the columns already read this way (a
database created at this revision or later).

Revision ID: a8c49886038e
Revises: 4c8d2e6f1a93
Create Date: 2026-11-09 00:00:00.000000+00:00

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "a8c49886038e"
down_revision: Union[str, None] = "4c8d2e6f1a93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("grimoire.db")

# The expressions as they stand before and after this revision, frozen here.
_PAGES = "left(content, 250000)"
_CATALOGUE = "left(coalesce(name, '') || ' ' || coalesce(body, ''), 250000)"
_COLUMNS = (
    # (table, GIN index, indexed text)
    ("book_pages", "ix_book_pages_search", _PAGES),
    ("content_search", "ix_content_search_search", _CATALOGUE),
)


def _expression(indexed: str, markup_as_words: bool) -> str:
    if markup_as_words:
        indexed = f"translate({indexed}, '<&', '  ')"
    return f"to_tsvector('grimoire'::regconfig, {indexed})"


def _rebuild(markup_as_words: bool) -> None:
    bind = op.get_bind()
    if bind.dialect.name != "postgresql":
        return
    for table, index, indexed in _COLUMNS:
        current = bind.execute(
            text(
                "SELECT generation_expression FROM information_schema.columns "
                "WHERE table_schema = current_schema() AND table_name = :t "
                "AND column_name = 'search'"
            ),
            {"t": table},
        ).scalar()
        if current is None or ("translate(" in current) == markup_as_words:
            continue
        logger.info("Rebuilding the PostgreSQL search index on %s ...", table)
        op.execute(f"DROP INDEX IF EXISTS {index}")
        op.execute(f"ALTER TABLE {table} DROP COLUMN search")
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN search tsvector GENERATED ALWAYS AS "
            f"({_expression(indexed, markup_as_words)}) STORED"
        )
        op.execute(f"CREATE INDEX {index} ON {table} USING GIN (search)")


def upgrade() -> None:
    _rebuild(markup_as_words=True)


def downgrade() -> None:
    _rebuild(markup_as_words=False)
