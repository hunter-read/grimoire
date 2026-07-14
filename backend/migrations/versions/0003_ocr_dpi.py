"""ocr dpi: per-book OCR resolution override on books

Adds a nullable ``ocr_dpi`` column so a specific scanned book can be re-OCR'd at
a higher resolution than the global ``OCR_DPI`` default (NULL = use the default).

Revision ID: b2e5d3f0c8a1
Revises: a1f4c2e9b7d0
Create Date: 2026-07-14 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "b2e5d3f0c8a1"
down_revision: Union[str, None] = "a1f4c2e9b7d0"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _books_columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("books")}


def upgrade() -> None:
    # Plain in-place ALTER (no batch_alter_table rebuild): adding a nullable
    # column needs no table copy, so there is no _alembic_tmp_books to leave
    # behind if interrupted. Guarded so a retried/partial run is a clean no-op.
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_books")
    if "ocr_dpi" not in _books_columns():
        op.add_column("books", sa.Column("ocr_dpi", sa.Integer(), nullable=True))


def downgrade() -> None:
    if "ocr_dpi" in _books_columns():
        op.drop_column("books", "ocr_dpi")
