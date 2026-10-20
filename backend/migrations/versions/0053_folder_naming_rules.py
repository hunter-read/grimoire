"""folder naming rules: a filename pattern per library folder

Adds the ``folder_naming_rules`` table. Each row holds one pattern for the books
under a library folder (``books/D&D 5e``): the scanner reads new books' titles
out of their filenames with it, and the admin can rename files onto it.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: 7c2f9e4a1b58
Revises: 3c8f1a6e9b27
Create Date: 2026-10-20 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "7c2f9e4a1b58"
down_revision: Union[str, None] = "3c8f1a6e9b27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("folder_naming_rules"):
        return
    op.create_table(
        "folder_naming_rules",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("path", sa.String(length=1000), nullable=False),
        sa.Column("pattern", sa.String(length=500), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("path"),
    )


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("folder_naming_rules"):
        op.drop_table("folder_naming_rules")
