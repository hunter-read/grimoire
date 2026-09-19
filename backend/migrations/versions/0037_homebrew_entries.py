"""homebrew: user-authored catalog entries

Adds ``homebrew_entries``. Homebrew is the same data as a pack entry —
validated against the same content type, rendered by the same component — but
owned by the user who wrote it, so it is per user where pack content is
server-wide, and editable, which pack content is not.

``visibility`` is enforced server-side in every query: ``private`` (owner only),
``campaign`` (owner plus members of ``campaign_id``), ``public`` (everyone on
the instance). A client is never the thing deciding who may see a private entry.

``owner_id`` is a hard foreign key — homebrew belongs to an account and has no
meaning without one. ``campaign_id`` is nullable and survives a visibility
change, so an entry shared to a campaign and set back to private remembers
which campaign it was shared with.

``schema_id`` is deliberately **not** a foreign key, matching ``content_packs``:
schemas are per user, so there is no single row to point at, and homebrew may
outlive the schema copy it was written against.

One new table and nothing to backfill. Idempotent.

Revision ID: d4a71c3e8f60
Revises: c8e35a9f2b71
Create Date: 2026-09-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "d4a71c3e8f60"
down_revision: Union[str, None] = "c8e35a9f2b71"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if not insp.has_table("homebrew_entries"):
        op.create_table(
            "homebrew_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("owner_id", sa.String(length=36), nullable=False),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("entry_id", sa.String(length=200), nullable=False),
            sa.Column("name", sa.String(length=500), nullable=False),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("visibility", sa.String(length=20), nullable=False),
            sa.Column("campaign_id", sa.String(length=36), nullable=True),
            sa.Column("forked_from", sa.String(length=300), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["owner_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("owner_id", "schema_id", "content_type", "entry_id"),
        )
        op.create_index("ix_homebrew_entries_owner_id", "homebrew_entries", ["owner_id"])
        op.create_index("ix_homebrew_entries_schema_id", "homebrew_entries", ["schema_id"])
        op.create_index(
            "ix_homebrew_entries_content_type", "homebrew_entries", ["content_type"]
        )
        op.create_index(
            "ix_homebrew_entries_campaign_id", "homebrew_entries", ["campaign_id"]
        )
        op.create_index(
            "ix_homebrew_lookup", "homebrew_entries", ["schema_id", "content_type"]
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("homebrew_entries"):
        op.drop_index("ix_homebrew_lookup", table_name="homebrew_entries")
        op.drop_index("ix_homebrew_entries_campaign_id", table_name="homebrew_entries")
        op.drop_index("ix_homebrew_entries_content_type", table_name="homebrew_entries")
        op.drop_index("ix_homebrew_entries_schema_id", table_name="homebrew_entries")
        op.drop_index("ix_homebrew_entries_owner_id", table_name="homebrew_entries")
        op.drop_table("homebrew_entries")
