"""pins: folders and game systems a user keeps one click away

Adds the ``pins`` table. Each row is one user's pin in one browse view
(``collection``: systems, maps, tokens, audio or models) on a ``target`` - a
collection-relative folder path, or a game system's id. The galleries and the
library show a user's pins as a strip at the top of the view.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: 4d7e1c9b2a63
Revises: 521c4f179a46
Create Date: 2026-11-06 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "4d7e1c9b2a63"
down_revision: Union[str, None] = "521c4f179a46"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("pins"):
        return
    op.create_table(
        "pins",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("collection", sa.String(length=20), nullable=False),
        sa.Column("target", sa.String(length=1000), nullable=False),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "collection", "target"),
    )
    op.create_index("ix_pins_user_id", "pins", ["user_id"])


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("pins"):
        op.drop_index("ix_pins_user_id", table_name="pins")
        op.drop_table("pins")
