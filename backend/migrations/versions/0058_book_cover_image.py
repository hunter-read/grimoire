"""books.cover_image: a cover uploaded for one book

Adds ``books.cover_image``, the bare filename of a cover an admin uploaded for
a single book, stored under ``DATA_PATH/book_covers/``. It replaces the
generated first-page thumbnail wherever the book's cover is shown or sent -
for the books whose first page makes a poor cover (a fixed-layout EPUB that
renders blank, a wraparound dust jacket, a rotated scan).

Nullable and defaulted to "", so upgrading changes nothing for existing rows.
Idempotent.

Revision ID: 8b3f6d2a9c41
Revises: e50b2a525948
Create Date: 2026-10-29 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "8b3f6d2a9c41"
down_revision: Union[str, None] = "e50b2a525948"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("books")}


def upgrade() -> None:
    if "cover_image" not in _columns():
        op.add_column(
            "books",
            sa.Column("cover_image", sa.String(length=255), nullable=True, server_default=""),
        )


def downgrade() -> None:
    if "cover_image" in _columns():
        op.execute("ALTER TABLE books DROP COLUMN cover_image")
