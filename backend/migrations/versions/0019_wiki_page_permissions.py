"""per-user wiki page write shares and hidden pages

Two changes backing the reworked wiki permission model (issues #232, #233):

* ``wiki_page_shares.can_write`` — a Private page's share list now distinguishes
  read from read+write access, so the author can grant a specific player the
  right to edit. Existing rows granted read only, which is exactly what the
  ``0`` default preserves; nothing needs backfilling.

* ``wiki_page_hidden`` — per-user "hide this page from my view" rows. Purely
  additive: with no rows, every page is visible exactly as before.

Both steps are idempotent, so a database that already picked either up through
the legacy ``_apply_legacy_migrations`` replay passes straight through.

Revision ID: d3f8b1a7c5e2
Revises: c7e1a94b2f60
Create Date: 2026-08-13 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "d3f8b1a7c5e2"
down_revision: Union[str, None] = "c7e1a94b2f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

    cols = {c["name"] for c in insp.get_columns("wiki_page_shares")}
    if "can_write" not in cols:
        op.add_column(
            "wiki_page_shares",
            sa.Column("can_write", sa.Boolean(), nullable=True, server_default="0"),
        )

    if not insp.has_table("wiki_page_hidden"):
        op.create_table(
            "wiki_page_hidden",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("page_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.ForeignKeyConstraint(["page_id"], ["wiki_pages.id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("page_id", "user_id"),
        )
        op.create_index(
            "ix_wiki_page_hidden_page_id", "wiki_page_hidden", ["page_id"]
        )
        op.create_index(
            "ix_wiki_page_hidden_user_id", "wiki_page_hidden", ["user_id"]
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("wiki_page_hidden"):
        op.drop_index("ix_wiki_page_hidden_user_id", table_name="wiki_page_hidden")
        op.drop_index("ix_wiki_page_hidden_page_id", table_name="wiki_page_hidden")
        op.drop_table("wiki_page_hidden")

    cols = {c["name"] for c in insp.get_columns("wiki_page_shares")}
    if "can_write" in cols:
        op.drop_column("wiki_page_shares", "can_write")
