"""rulesets: named sets of content scoped to a campaign

Replaces ``homebrew_entries``. That table keyed content to a *user* with a
visibility flag, which could not express the thing GMs actually do: run two
games in the same system with different content allowed in each, while core
rules apply to both. A single ``campaign_id`` column plus private/public was
the wrong shape for it.

Content now belongs to a **ruleset**, and a ruleset belongs either to a
campaign — everyone at that table reads it, the GM edits it — or to the server,
when ``campaign_id`` is null, which is what core rules want to be.

``homebrew_entries`` is dropped rather than migrated. It shipped on an
unreleased branch and never carried data; preserving rows keyed on a model that
could not express the requirement would mean inventing a campaign for each one.

Revision ID: f6c82b4e0d97
Revises: e5b93a7d1c48
Create Date: 2026-09-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "f6c82b4e0d97"
down_revision: Union[str, None] = "e5b93a7d1c48"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if not insp.has_table("rulesets"):
        op.create_table(
            "rulesets",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("campaign_id", sa.String(length=36), nullable=True),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("version", sa.String(length=20), nullable=True),
            sa.Column("license", sa.String(length=200), nullable=True),
            sa.Column("license_url", sa.Text(), nullable=True),
            sa.Column("attribution", sa.Text(), nullable=True),
            sa.Column("source_pack_id", sa.String(length=100), nullable=True),
            sa.Column("created_by_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_rulesets_campaign_id", "rulesets", ["campaign_id"])
        op.create_index("ix_rulesets_schema_id", "rulesets", ["schema_id"])

    if not insp.has_table("ruleset_entries"):
        op.create_table(
            "ruleset_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("ruleset_id", sa.String(length=36), nullable=False),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("entry_id", sa.String(length=200), nullable=False),
            sa.Column("name", sa.String(length=500), nullable=False),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("forked_from", sa.String(length=300), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["ruleset_id"], ["rulesets.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("ruleset_id", "content_type", "entry_id"),
        )
        op.create_index("ix_ruleset_entries_ruleset_id", "ruleset_entries", ["ruleset_id"])
        op.create_index("ix_ruleset_entries_schema_id", "ruleset_entries", ["schema_id"])
        op.create_index(
            "ix_ruleset_entries_content_type", "ruleset_entries", ["content_type"]
        )
        op.create_index(
            "ix_ruleset_entries_lookup", "ruleset_entries", ["schema_id", "content_type"]
        )

    if insp.has_table("homebrew_entries"):
        op.drop_table("homebrew_entries")


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("ruleset_entries"):
        op.drop_index("ix_ruleset_entries_lookup", table_name="ruleset_entries")
        op.drop_index("ix_ruleset_entries_content_type", table_name="ruleset_entries")
        op.drop_index("ix_ruleset_entries_schema_id", table_name="ruleset_entries")
        op.drop_index("ix_ruleset_entries_ruleset_id", table_name="ruleset_entries")
        op.drop_table("ruleset_entries")

    if insp.has_table("rulesets"):
        op.drop_index("ix_rulesets_schema_id", table_name="rulesets")
        op.drop_index("ix_rulesets_campaign_id", table_name="rulesets")
        op.drop_table("rulesets")
