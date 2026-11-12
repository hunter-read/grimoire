"""PostgreSQL search: index the words either side of a slash, a full stop and the like

PostgreSQL's text search parser reads ``sword/shield`` as a file path,
``lance.The`` as a host name, ``orc@example.com`` as an email address and ``-2``
as a signed number, and indexes each as one token, where SQLite's FTS5 tokenizer
splits on the punctuation and indexes the words. So ``shield``, ``lance`` or
``2`` found the page on SQLite but not on PostgreSQL - and a full stop with no
space after it is common in text extracted from a PDF. The generated ``tsvector``
columns ``book_pages.search`` and ``content_search.search`` now read those
characters as spaces too (``SPLIT_CHARS`` in backend/models/postgres.py), as do
the search terms.

As in 0066, each column is dropped and added again with its GIN index, which
recomputes it for every row from the text already stored - no book is re-read -
in one pass over the table.

Nothing to do on SQLite. Skipped where the columns already read this way (a
database created at this revision or later).

Revision ID: 9b2f6d4e8c17
Revises: 3e7a1c5b9d24
Create Date: 2026-11-12 00:00:00.000000+00:00

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


revision: str = "9b2f6d4e8c17"
down_revision: Union[str, None] = "3e7a1c5b9d24"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

logger = logging.getLogger("grimoire.db")

# The expressions as they stand before and after this revision, frozen here.
_BEFORE = "<&"
_AFTER = "<&/.@\\_~+-:"
_PAGES = "left(content, 250000)"
_CATALOGUE = "left(coalesce(name, '') || ' ' || coalesce(body, ''), 250000)"
_COLUMNS = (
    # (table, GIN index, indexed text)
    ("book_pages", "ix_book_pages_search", _PAGES),
    ("content_search", "ix_content_search_search", _CATALOGUE),
)


def _rebuild(old: str, new: str) -> None:
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
        if current is None or f"'{old}'" not in current:
            continue
        logger.info("Rebuilding the PostgreSQL search index on %s ...", table)
        op.execute(f"DROP INDEX IF EXISTS {index}")
        op.execute(f"ALTER TABLE {table} DROP COLUMN search")
        op.execute(
            f"ALTER TABLE {table} ADD COLUMN search tsvector GENERATED ALWAYS AS "
            f"(to_tsvector('grimoire'::regconfig, "
            f"translate({indexed}, '{new}', '{' ' * len(new)}'))) STORED"
        )
        op.execute(f"CREATE INDEX {index} ON {table} USING GIN (search)")


def upgrade() -> None:
    _rebuild(_BEFORE, _AFTER)


def downgrade() -> None:
    _rebuild(_AFTER, _BEFORE)
