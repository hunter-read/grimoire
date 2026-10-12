"""share links: public, revocable URLs for single library items

Adds the ``share_links`` table (issue #541) and ``users.share_links_enabled``,
the per-user override for creating them. The column is NULL for everyone, which
means "follow the role" - so nobody's access changes until an admin sets it.

Idempotent: the table, its indexes and the column are only created when missing.

Revision ID: 9d2f4b6a8c31
Revises: 6b1e0c9d4a27
Create Date: 2026-10-12 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "9d2f4b6a8c31"
down_revision: Union[str, None] = "6b1e0c9d4a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if not insp.has_table("share_links"):
        op.create_table(
            "share_links",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("token", sa.String(length=64), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("resource_type", sa.String(length=20), nullable=False),
            sa.Column("resource_id", sa.String(length=36), nullable=False),
            sa.Column("label", sa.String(length=200), nullable=True),
            sa.Column("filename", sa.String(length=255), nullable=True),
            sa.Column("password_hash", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_at", sa.DateTime(), nullable=True),
            sa.Column("revoked_by_id", sa.String(length=36), nullable=True),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("use_count", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_share_links_token", "share_links", ["token"], unique=True)
        op.create_index("ix_share_links_user_id", "share_links", ["user_id"])
        op.create_index(
            "ix_share_links_resource", "share_links", ["resource_type", "resource_id"]
        )

    if "share_links_enabled" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column("users", sa.Column("share_links_enabled", sa.Boolean(), nullable=True))


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if "share_links_enabled" in {c["name"] for c in insp.get_columns("users")}:
        op.drop_column("users", "share_links_enabled")
    if insp.has_table("share_links"):
        op.drop_index("ix_share_links_resource", table_name="share_links")
        op.drop_index("ix_share_links_user_id", table_name="share_links")
        op.drop_index("ix_share_links_token", table_name="share_links")
        op.drop_table("share_links")
