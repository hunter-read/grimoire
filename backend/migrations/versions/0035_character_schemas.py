"""character sheets: per-user schemas and the characters built on them

Adds ``character_schemas`` and ``characters``. Both are keyed by user, like
``user_themes``: a schema is a small document, so a copy per user costs almost
nothing, and it means one person editing their sheet never changes what anyone
else sees. Installing one therefore needs no admin step.

``characters.schema_ref`` holds a schema's ``schema_id`` string rather than a
foreign key. A character has to survive its schema being uninstalled and
reinstalled — same id, new row — so the reference is deliberately soft and a
dangling one renders as raw data rather than failing.

Two new tables and nothing to backfill. Idempotent.

Revision ID: b7d24f8e1a03
Revises: e4b81f60a9c2
Create Date: 2026-09-17 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "b7d24f8e1a03"
down_revision: Union[str, None] = "e4b81f60a9c2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

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
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_characters_user_id", "characters", ["user_id"])
        op.create_index("ix_characters_schema_ref", "characters", ["schema_ref"])


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("characters"):
        op.drop_index("ix_characters_schema_ref", table_name="characters")
        op.drop_index("ix_characters_user_id", table_name="characters")
        op.drop_table("characters")

    if insp.has_table("character_schemas"):
        op.drop_index("ix_character_schemas_user_id", table_name="character_schemas")
        op.drop_table("character_schemas")
