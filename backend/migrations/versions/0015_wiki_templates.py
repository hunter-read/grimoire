"""campaign wiki note templates

Adds the ``wiki_templates`` table: reusable starting points for wiki pages,
owned by one campaign. A template arrives by download from a community
repository, by `.md` upload, or by being written in the app; ``source_id`` /
``source_url`` / ``source_version`` record the provenance of a downloaded one
and are null otherwise.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: e1c4d8a2f637
Revises: c3a7e5b1d904
Create Date: 2026-08-07 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "e1c4d8a2f637"
down_revision: Union[str, None] = "c3a7e5b1d904"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if insp.has_table("wiki_templates"):
        return
    op.create_table(
        "wiki_templates",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("campaign_id", sa.String(length=36), nullable=False),
        sa.Column("name", sa.String(length=255), nullable=False),
        sa.Column("system", sa.String(length=255), nullable=True),
        sa.Column("category", sa.String(length=255), nullable=True),
        sa.Column("description", sa.Text(), nullable=True),
        sa.Column("body", sa.Text(), nullable=True),
        sa.Column("source_id", sa.String(length=100), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("source_version", sa.String(length=20), nullable=True),
        sa.Column("created_by_id", sa.String(length=36), nullable=True),
        sa.Column("sort_order", sa.Integer(), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"]),
        sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(
        "ix_wiki_templates_campaign_id", "wiki_templates", ["campaign_id"]
    )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if not insp.has_table("wiki_templates"):
        return
    op.drop_index("ix_wiki_templates_campaign_id", table_name="wiki_templates")
    op.drop_table("wiki_templates")
