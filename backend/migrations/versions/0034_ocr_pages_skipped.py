"""ocr pages skipped: count of pages OCR gave up on

Adds ``ocr_pages_skipped`` to books — pages abandoned because they exceeded
``OCR_PAGE_TIMEOUT`` or crashed the isolated worker. Such a book is still marked
indexed (one bad page must not stall it forever), so without this counter a book
whose text is mostly missing is indistinguishable from one that read cleanly.
See issue #450.

Existing rows default to 0: pages skipped before this column existed were never
recorded, so the honest starting point is "no known skips" rather than a guess.
Re-reading a book repopulates it.

Revision ID: e4b81f60a9c2
Revises: a1c7e93d5b60
Create Date: 2026-09-16 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e4b81f60a9c2"
down_revision: Union[str, None] = "a1c7e93d5b60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _books_columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("books")}


def upgrade() -> None:
    # Plain in-place ALTER (no batch_alter_table rebuild): adding a column with a
    # server default needs no table copy, so there is no _alembic_tmp_books to
    # leave behind if interrupted. Guarded so a retried/partial run is a no-op.
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_books")
    if "ocr_pages_skipped" not in _books_columns():
        op.add_column(
            "books",
            sa.Column(
                "ocr_pages_skipped",
                sa.Integer(),
                nullable=True,
                server_default=sa.text("0"),
            ),
        )


def downgrade() -> None:
    if "ocr_pages_skipped" in _books_columns():
        op.drop_column("books", "ocr_pages_skipped")
