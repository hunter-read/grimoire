"""users: a sidebar stats layout of their own

Adds ``users.sidebar_stats``, the ordered list of /api/stats fields a user's
sidebar shows. Null follows the admin's default (the ``sidebar_stats`` app
setting), which is what every existing user gets, so there is nothing to
backfill. Idempotent.

Revision ID: 4f8c1d6e2a95
Revises: 9b4e2f7a1c63
Create Date: 2026-11-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "4f8c1d6e2a95"
down_revision: Union[str, None] = "9b4e2f7a1c63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("users"):
        return
    if "sidebar_stats" not in {c["name"] for c in inspect(bind).get_columns("users")}:
        op.add_column("users", sa.Column("sidebar_stats", sa.JSON(), nullable=True))


def downgrade() -> None:
    op.drop_column("users", "sidebar_stats")
