"""character content catalog: server-wide packs and their entries

Adds ``content_packs`` and ``content_entries``, plus the ``content_search`` FTS5
table the catalog searches through.

Unlike ``character_schemas``, these are **server-wide**: a schema is a small
document so a copy per user costs nothing, but the 5e SRD's spell list is not,
and nobody edits an SRD entry in place — editing means forking into a ruleset,
which is per user and arrives in Phase 4. A character references an entry rather
than copying it, so an erratum reaches every character built on it.

``content_entries.pack_id`` cascades: dropping a pack drops the entries it
brought, because they only exist as an index of that pack's JSON. Characters
referencing them are unaffected — a reference is a soft one by entry id, and a
dangling ref renders from the character's own stored data.

Three new tables and nothing to backfill. Idempotent.

Revision ID: c8e35a9f2b71
Revises: b7d24f8e1a03
Create Date: 2026-09-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "c8e35a9f2b71"
down_revision: Union[str, None] = "b7d24f8e1a03"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("content_packs"):
        op.create_table(
            "content_packs",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("pack_id", sa.String(length=100), nullable=False),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("version", sa.String(length=20), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("license", sa.String(length=200), nullable=True),
            sa.Column("license_url", sa.Text(), nullable=True),
            sa.Column("attribution", sa.Text(), nullable=True),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column("directory", sa.String(length=255), nullable=True),
            sa.Column("entry_count", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("pack_id"),
        )
        op.create_index("ix_content_packs_pack_id", "content_packs", ["pack_id"])
        op.create_index("ix_content_packs_schema_id", "content_packs", ["schema_id"])

    if not insp.has_table("content_entries"):
        op.create_table(
            "content_entries",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("pack_id", sa.String(length=36), nullable=False),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("content_type", sa.String(length=100), nullable=False),
            sa.Column("entry_id", sa.String(length=200), nullable=False),
            sa.Column("source", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=500), nullable=False),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["pack_id"], ["content_packs.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("pack_id", "content_type", "entry_id"),
        )
        op.create_index("ix_content_entries_pack_id", "content_entries", ["pack_id"])
        op.create_index("ix_content_entries_schema_id", "content_entries", ["schema_id"])
        op.create_index(
            "ix_content_entries_content_type", "content_entries", ["content_type"]
        )
        op.create_index(
            "ix_content_entries_lookup", "content_entries", ["schema_id", "content_type"]
        )

    # FTS5 over the searchable text of every entry, mirroring `book_search`.
    # `entry_row` is the content_entries.id, so a hit maps straight back;
    # `pack_row` is the owning pack, which is what a reload clears by — entries
    # are replaced wholesale, so their ids change and cannot key the cleanup.
    bind.execute(
        text(
            """
            CREATE VIRTUAL TABLE IF NOT EXISTS content_search
            USING fts5(
                entry_row UNINDEXED,
                pack_row UNINDEXED,
                schema_id UNINDEXED,
                content_type UNINDEXED,
                name,
                body,
                tokenize='porter unicode61'
            )
            """
        )
    )


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    bind.execute(text("DROP TABLE IF EXISTS content_search"))

    if insp.has_table("content_entries"):
        op.drop_index("ix_content_entries_lookup", table_name="content_entries")
        op.drop_index("ix_content_entries_content_type", table_name="content_entries")
        op.drop_index("ix_content_entries_schema_id", table_name="content_entries")
        op.drop_index("ix_content_entries_pack_id", table_name="content_entries")
        op.drop_table("content_entries")

    if insp.has_table("content_packs"):
        op.drop_index("ix_content_packs_schema_id", table_name="content_packs")
        op.drop_index("ix_content_packs_pack_id", table_name="content_packs")
        op.drop_table("content_packs")
