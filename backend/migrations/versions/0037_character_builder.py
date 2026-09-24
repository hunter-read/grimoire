"""character builder: sheets, characters, the content catalog, and rulesets

Every table the character builder needs, in one revision.

**Sheets and characters.** ``character_schemas`` and ``characters`` are keyed by
user, like ``user_themes``: a schema is a small document, so a copy per user
costs almost nothing, and it means one person editing their sheet never changes
what anyone else sees. Installing one therefore needs no admin step.

``characters.schema_ref`` holds a schema's ``schema_id`` string rather than a
foreign key. A character has to survive its schema being uninstalled and
reinstalled — same id, new row — so the reference is deliberately soft and a
dangling one renders as raw data rather than failing.

``characters.campaign_id`` is nullable because a character may exist before a
campaign does — a player rolls one up and joins a table later — and because a
character can outlive the game it was made for. Setting it lets the party read
the sheet; editing stays with the player who wrote it. ``portrait_path`` holds a
filename under ``DATA_PATH/uploads/characters/`` rather than a path, so moving
that directory is not a migration, matching the campaign character-art pattern.

**The content catalog.** ``content_packs`` and ``content_entries``, plus the
``content_search`` FTS5 table the catalog searches through. Unlike
``character_schemas`` these are **server-wide**: the 5e SRD's spell list is not
small, and nobody edits an SRD entry in place — editing means forking it into a
ruleset. A character references an entry rather than copying it, so an erratum
reaches every character built on it.

``content_entries.pack_id`` cascades: dropping a pack drops the entries it
brought, because they only exist as an index of that pack's JSON. Characters
referencing them are unaffected — a reference is a soft one by entry id, and a
dangling ref renders from the character's own stored data.

**Rulesets.** ``rulesets`` and ``ruleset_entries``: named sets of content
scoped to a campaign, which is what lets a GM run two games in the same system
with different content allowed in each while core rules apply to both. A
ruleset belongs either to a campaign — everyone at that table reads it, the GM
edits it — or to the server, when ``campaign_id`` is null, which is what core
rules want to be.

Seven new tables and nothing to backfill. Idempotent.

Revision ID: 9d3f6a2c8e51
Revises: c4e8a2f6d913
Create Date: 2026-09-24 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "9d3f6a2c8e51"
down_revision: Union[str, None] = "c4e8a2f6d913"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("character_schemas"):
        op.create_table(
            "character_schemas",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("schema_id", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("system", sa.String(length=200), nullable=True),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("version", sa.String(length=20), nullable=True),
            sa.Column("document", sa.JSON(), nullable=True),
            sa.Column("source_id", sa.String(length=100), nullable=True),
            sa.Column("source_url", sa.Text(), nullable=True),
            sa.Column("source_version", sa.String(length=20), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "schema_id"),
        )
        op.create_index(
            "ix_character_schemas_user_id", "character_schemas", ["user_id"]
        )

    if not insp.has_table("characters"):
        op.create_table(
            "characters",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("schema_ref", sa.String(length=100), nullable=False),
            sa.Column("name", sa.String(length=200), nullable=False),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("campaign_id", sa.String(length=36), nullable=True),
            sa.Column("portrait_path", sa.String(length=255), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_characters_user_id", "characters", ["user_id"])
        op.create_index("ix_characters_schema_ref", "characters", ["schema_ref"])
        op.create_index("ix_characters_campaign_id", "characters", ["campaign_id"])

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


def downgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

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

    if insp.has_table("characters"):
        op.drop_index("ix_characters_campaign_id", table_name="characters")
        op.drop_index("ix_characters_schema_ref", table_name="characters")
        op.drop_index("ix_characters_user_id", table_name="characters")
        op.drop_table("characters")

    if insp.has_table("character_schemas"):
        op.drop_index("ix_character_schemas_user_id", table_name="character_schemas")
        op.drop_table("character_schemas")
