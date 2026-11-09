"""folder access rules: a minimum role per library folder

Adds the ``folder_access_rules`` table. Each row restricts every book beneath a
library folder (``books/D&D 5e/Core/GM``) to GMs and admins, or to admins only,
on top of what the book's system and category already give it.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: 9a4e7b2c6d31
Revises: 3f6a9d2c8e15
Create Date: 2026-11-09 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "9a4e7b2c6d31"
down_revision: Union[str, None] = "3f6a9d2c8e15"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("folder_access_rules"):
        return
    op.create_table(
        "folder_access_rules",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("path", sa.String(length=1000), nullable=False),
        sa.Column("level", sa.String(length=10), nullable=False),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("path"),
    )


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("folder_access_rules"):
        op.drop_table("folder_access_rules")
