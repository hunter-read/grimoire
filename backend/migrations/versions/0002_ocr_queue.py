"""ocr queue: ocr_pending + ocr_pages_done on books

Deferred-OCR support. Image-only (scanned) PDFs are no longer OCR'd inline
during the scan; they are queued via ``ocr_pending`` and drained by a dedicated
background worker that checkpoints ``ocr_pages_done`` so long books resume after
a restart instead of losing work.

Revision ID: a1f4c2e9b7d0
Revises: 96c733b7c205
Create Date: 2026-07-13 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "a1f4c2e9b7d0"
down_revision: Union[str, None] = "96c733b7c205"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _books_columns() -> set:
    bind = op.get_bind()
    return {c["name"] for c in inspect(bind).get_columns("books")}


def _books_indexes() -> set:
    bind = op.get_bind()
    return {i["name"] for i in inspect(bind).get_indexes("books")}


def upgrade() -> None:
    # Adding a nullable column with a constant default and creating an index are
    # both operations SQLite performs in place, so we issue plain ALTER/CREATE
    # statements rather than a batch_alter_table rebuild. The rebuild copies the
    # whole table through a temporary _alembic_tmp_books table; if it is
    # interrupted (OOM, container kill) it leaves that temp table behind and,
    # because the migration never committed, the next startup re-runs this
    # revision and dies with "table _alembic_tmp_books already exists". Plain
    # ALTERs create no temp table and each is idempotent below, so a retried or
    # partially-applied run recovers cleanly.
    #
    # Drop any stale temp table left by an earlier interrupted batch run of this
    # migration (from a prior release) before proceeding.
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_books")

    existing = _books_columns()
    if "ocr_pending" not in existing:
        op.add_column(
            "books",
            sa.Column("ocr_pending", sa.Boolean(), nullable=True, server_default=sa.text("0")),
        )
    if "ocr_pages_done" not in existing:
        op.add_column(
            "books",
            sa.Column("ocr_pages_done", sa.Integer(), nullable=True, server_default=sa.text("0")),
        )
    if "ix_books_ocr_pending" not in _books_indexes():
        op.create_index("ix_books_ocr_pending", "books", ["ocr_pending"], unique=False)


def downgrade() -> None:
    if "ix_books_ocr_pending" in _books_indexes():
        op.drop_index("ix_books_ocr_pending", table_name="books")
    existing = _books_columns()
    if "ocr_pages_done" in existing:
        op.drop_column("books", "ocr_pages_done")
    if "ocr_pending" in existing:
        op.drop_column("books", "ocr_pending")
