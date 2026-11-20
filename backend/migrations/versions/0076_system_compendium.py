"""system compendium: packs and sheets linked to a system, server-wide sheets

Issue #835. Four changes, each idempotent:

* ``system_content_packs`` and ``system_character_sheets``, the many-to-many
  links between a library system and the content packs that fill its
  compendium, and the character sheets its players use. Both key the far side
  by its string id (a pack's ``pack_id``, a sheet's ``schema_id``) and cascade
  on the system. New tables, so nothing to backfill.
* ``content_packs.content_types``, the content types a pack declares in its own
  ``_meta.json``. Null until the pack is next loaded, which happens at startup.
* ``character_schemas.user_id`` becomes nullable: a null owner is a server-wide
  sheet an admin installed for everyone. Every existing row has an owner, so
  nothing changes for them. SQLite cannot drop NOT NULL in place, so the table
  is copied; nothing references it by foreign key, so the copy loses nothing.
* ``uq_character_schemas_server``, a partial unique index keeping one
  server-wide row per schema id (the ``(user_id, schema_id)`` constraint cannot,
  since NULLs never compare equal).

Revision ID: 4c7e2a9d1b63
Revises: 796428a7f3eb
Create Date: 2026-11-19 12:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "4c7e2a9d1b63"
down_revision: Union[str, None] = "796428a7f3eb"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_SERVER_INDEX = "uq_character_schemas_server"
_LINK_TABLES = (
    ("system_content_packs", "pack_id"),
    ("system_character_sheets", "schema_id"),
)


def _columns(table: str) -> dict:
    return {c["name"]: c for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("game_systems"):
        for table, key in _LINK_TABLES:
            if not inspect(op.get_bind()).has_table(table):
                op.create_table(
                    table,
                    sa.Column("game_system_id", sa.String(length=36), nullable=False),
                    sa.Column(key, sa.String(length=100), nullable=False),
                    sa.Column("created_at", sa.DateTime(), nullable=True),
                    sa.ForeignKeyConstraint(
                        ["game_system_id"], ["game_systems.id"], ondelete="CASCADE"
                    ),
                    sa.PrimaryKeyConstraint("game_system_id", key),
                )
            index = f"ix_{table}_{key}"
            if index not in _indexes(table):
                op.create_index(index, table, [key], unique=False)

    if insp.has_table("content_packs") and "content_types" not in _columns("content_packs"):
        op.add_column("content_packs", sa.Column("content_types", sa.JSON(), nullable=True))

    if insp.has_table("character_schemas"):
        if not _columns("character_schemas")["user_id"]["nullable"]:
            op.execute('DROP TABLE IF EXISTS "_alembic_tmp_character_schemas"')
            with op.batch_alter_table("character_schemas") as batch:
                batch.alter_column(
                    "user_id", existing_type=sa.String(length=36), nullable=True
                )
        if _SERVER_INDEX not in _indexes("character_schemas"):
            op.create_index(
                _SERVER_INDEX,
                "character_schemas",
                ["schema_id"],
                unique=True,
                sqlite_where=sa.text("user_id IS NULL"),
                postgresql_where=sa.text("user_id IS NULL"),
            )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if insp.has_table("character_schemas"):
        if _SERVER_INDEX in _indexes("character_schemas"):
            op.drop_index(_SERVER_INDEX, table_name="character_schemas")
        # Server-wide sheets have no owner to give back, so they go.
        op.execute("DELETE FROM character_schemas WHERE user_id IS NULL")
        if _columns("character_schemas")["user_id"]["nullable"]:
            op.execute('DROP TABLE IF EXISTS "_alembic_tmp_character_schemas"')
            with op.batch_alter_table("character_schemas") as batch:
                batch.alter_column(
                    "user_id", existing_type=sa.String(length=36), nullable=False
                )
    if insp.has_table("content_packs") and "content_types" in _columns("content_packs"):
        op.drop_column("content_packs", "content_types")
    for table, _key in _LINK_TABLES:
        if inspect(op.get_bind()).has_table(table):
            op.drop_table(table)
