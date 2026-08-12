"""per-user colour themes

Adds the ``user_themes`` table and the two ``users`` columns that record a
user's appearance choice (``theme_mode``, ``theme_id``).

Themes are per-user rather than server-wide, so the table is keyed by
``(user_id, theme_id)``: installing the same theme twice updates the user's copy
instead of duplicating it. ``source_id`` / ``source_url`` / ``source_version``
record where a downloaded theme came from and are null for one written in the
app, mirroring ``wiki_templates``.

New table and nullable columns, so there is nothing to backfill: a user with no
choice recorded gets the built-in dark palette, which is what they saw before.
Idempotent.

Revision ID: f2b6a91c4d38
Revises: e1c4d8a2f637
Create Date: 2026-08-11 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "f2b6a91c4d38"
down_revision: Union[str, None] = "e1c4d8a2f637"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _user_columns(insp) -> set:
    return {c["name"] for c in insp.get_columns("users")}


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if not insp.has_table("user_themes"):
        op.create_table(
            "user_themes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("theme_id", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("mode", sa.String(length=10), nullable=True),
            sa.Column("tokens", sa.JSON(), nullable=True),
            sa.Column("source_id", sa.String(length=100), nullable=True),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column("source_version", sa.String(length=20), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "theme_id"),
        )
        op.create_index("ix_user_themes_user_id", "user_themes", ["user_id"])

    existing = _user_columns(insp)
    if "theme_mode" not in existing:
        op.add_column("users", sa.Column("theme_mode", sa.String(length=10), nullable=True))
    if "theme_id" not in existing:
        op.add_column("users", sa.Column("theme_id", sa.String(length=100), nullable=True))


def downgrade() -> None:
    insp = inspect(op.get_bind())

    existing = _user_columns(insp)
    if "theme_id" in existing:
        op.drop_column("users", "theme_id")
    if "theme_mode" in existing:
        op.drop_column("users", "theme_mode")

    if insp.has_table("user_themes"):
        op.drop_index("ix_user_themes_user_id", table_name="user_themes")
        op.drop_table("user_themes")
