"""wiki map pages: a page built around a map, with pins linking to pages

Adds what map pages need (issue #578):

* ``wiki_pages.map_id`` - the library map a map page shows, by id. Not a
  foreign key: the map can be deleted outside the app, and the page must
  survive that as a placeholder that keeps its pins.
* ``wiki_pages.map_file_id`` - the campaign's own copy of that map, kept when
  the map is deleted from the library in the app.
* ``wiki_map_pins`` - one row per pin. Its page reference cascades; its target
  reference is set to null, so deleting a target page leaves an unlinked pin.

New columns are nullable and a new table has nothing to backfill. Idempotent.

Revision ID: 3e7a1c5b9d24
Revises: 649b0f0b5a11
Create Date: 2026-11-10 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "3e7a1c5b9d24"
down_revision: Union[str, None] = "649b0f0b5a11"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def _index(table: str, column: str) -> None:
    name = f"ix_{table}_{column}"
    if name not in _indexes(table):
        op.create_index(name, table, [column], unique=False)


def upgrade() -> None:
    cols = _columns("wiki_pages")
    if "map_id" not in cols:
        op.add_column("wiki_pages", sa.Column("map_id", sa.String(length=36), nullable=True))
    if "map_file_id" not in cols:
        op.add_column("wiki_pages", sa.Column("map_file_id", sa.String(length=36), nullable=True))
    _index("wiki_pages", "map_id")

    if not inspect(op.get_bind()).has_table("wiki_map_pins"):
        op.create_table(
            "wiki_map_pins",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("page_id", sa.String(length=36), nullable=False),
            sa.Column("x", sa.Float(), nullable=False),
            sa.Column("y", sa.Float(), nullable=False),
            sa.Column("target_page_id", sa.String(length=36), nullable=True),
            sa.Column("label", sa.String(length=255), nullable=True),
            sa.Column("icon", sa.String(length=50), nullable=True),
            sa.Column("icon_color", sa.String(length=20), nullable=True),
            sa.Column("visibility", sa.String(length=20), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.Column("created_by_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["page_id"], ["wiki_pages.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["target_page_id"], ["wiki_pages.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["created_by_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _index("wiki_map_pins", "page_id")
    _index("wiki_map_pins", "target_page_id")


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("wiki_map_pins"):
        op.drop_table("wiki_map_pins")
    if "ix_wiki_pages_map_id" in _indexes("wiki_pages"):
        op.drop_index("ix_wiki_pages_map_id", table_name="wiki_pages")
    cols = _columns("wiki_pages")
    with op.batch_alter_table("wiki_pages") as batch:
        if "map_file_id" in cols:
            batch.drop_column("map_file_id")
        if "map_id" in cols:
            batch.drop_column("map_id")
