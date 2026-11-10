"""book system links: a book shown on a second system's shelf

Adds the ``book_system_links`` table (issue #446). Each row puts one book on
one more system's shelf, beside the system its folder gives it. Both foreign
keys cascade, so a rescan pruning a book or a system leaves no row behind.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: 5d2b8e9f4a17
Revises: a8c49886038e
Create Date: 2026-11-10 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "5d2b8e9f4a17"
down_revision: Union[str, None] = "a8c49886038e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_book_system_links_game_system_id"


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if not inspector.has_table("book_system_links"):
        op.create_table(
            "book_system_links",
            sa.Column("book_id", sa.String(length=36), nullable=False),
            sa.Column("game_system_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["game_system_id"], ["game_systems.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("book_id", "game_system_id"),
        )
        inspector = inspect(op.get_bind())
    if _INDEX not in {i["name"] for i in inspector.get_indexes("book_system_links")}:
        op.create_index(_INDEX, "book_system_links", ["game_system_id"], unique=False)


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("book_system_links"):
        op.drop_table("book_system_links")
