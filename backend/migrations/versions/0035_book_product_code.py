"""book product code: the publisher's catalogue number / SKU

Adds ``product_code`` to books - the code a publisher prints on the cover or in
a store listing ("PZO9001", "DDAL05-01", "TSR 9247"). Most RPG PDFs have no
ISBN and titles repeat across printings, so this is the identifier that tells
editions apart and matches a book against outside catalogues. See issue #479.

Existing rows default to "": no code was ever recorded, and inventing one from
the file name is left to the user (the bulk editor's "read from file names").

Revision ID: a3f5c7e9b1d2
Revises: e4b81f60a9c2
Create Date: 2026-09-22 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "a3f5c7e9b1d2"
down_revision: Union[str, None] = "e4b81f60a9c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _books_columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("books")}


def upgrade() -> None:
    # Plain in-place ALTER, as in 0034: a column with a server default needs no
    # table copy. Guarded so a retried/partial run is a no-op.
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_books")
    if "product_code" not in _books_columns():
        op.add_column(
            "books",
            sa.Column(
                "product_code",
                sa.String(length=100),
                nullable=True,
                server_default=sa.text("''"),
            ),
        )


def downgrade() -> None:
    if "product_code" in _books_columns():
        op.drop_column("books", "product_code")
