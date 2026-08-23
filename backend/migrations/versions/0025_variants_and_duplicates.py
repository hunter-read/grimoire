"""variant grouping and duplicate-detection storage (#304, #306)

A library accumulates several files of the same thing. Some are true duplicates
— the same book bought in a bundle and standalone, or ``Book (1).pdf`` from an
interrupted copy. Many are not: a printer-friendly cut next to the screen
edition, a form-fillable character sheet, a gridless copy of a battle map, a
v1.0.0 superseded by a v1.0.1 with errata. Each of those is a real file the user
owns and wants to open, but showing all five as unrelated shelf entries makes the
library harder to read and splits reading progress across them.

Adds ``variant_parent_id`` / ``variant_kind`` / ``variant_label`` to all four
file-backed tables. A row pointing at a parent is hidden from browsing, counts,
and search, while staying reachable by id so it still opens and reads. The parent
keeps its own id, so everything attached to it — tags, favorites, bookmarks,
progress, campaign links — survives the grouping untouched.

``variant_parent_id`` is deliberately **not** a foreign key. SQLite cannot add
one without a ``batch_alter_table`` rebuild, which on ``books`` would mean
reflecting and recreating a unique ``filepath`` plus three indexes. Worse, with
``PRAGMA foreign_keys=ON`` (see ``models/db.py``) it would make deleting a game
system fail: ``GameSystem.books`` cascades to its books, and any book that had
variants would trip the constraint. ``game_systems.cover_book_id`` is the
existing precedent for a soft reference here. The two-level rule (a variant may
not itself have variants, which is what makes cycles impossible) is enforced in
``services/variants.py``, and no foreign key could express it anyway.

All columns are nullable and left empty on upgrade: nothing is a variant until a
user says so, so this migration changes no behaviour on its own.

Also creates the two tables backing duplicate detection — ``duplicate_groups``
for a run's findings, ``duplicate_dismissals`` for the user's standing "these are
not duplicates" answers, which must outlive every future scan.

Revision ID: f2a86d31c705
Revises: b4d90c2e75af
Create Date: 2026-08-22 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "f2a86d31c705"
down_revision: Union[str, None] = "b4d90c2e75af"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# The four file-backed collections, all of which can hold variants of each other.
_TABLES = ("books", "generic_maps", "tokens", "audio")

_COLUMNS = (
    ("variant_parent_id", sa.String(length=36)),
    ("variant_kind", sa.String(length=30)),
    ("variant_label", sa.String(length=120)),
)


def upgrade() -> None:
    insp = inspect(op.get_bind())
    existing_tables = set(insp.get_table_names())

    for table in _TABLES:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        for name, coltype in _COLUMNS:
            if name not in cols:
                op.add_column(table, sa.Column(name, coltype, nullable=True))

        # Every browse query becomes "WHERE variant_parent_id IS NULL" and every
        # picker becomes "WHERE variant_parent_id = :id"; one index serves both,
        # since SQLite indexes NULLs.
        index_name = f"ix_{table}_variant_parent"
        if index_name not in {ix["name"] for ix in insp.get_indexes(table)}:
            op.create_index(index_name, table, ["variant_parent_id"])

    if "duplicate_groups" not in existing_tables:
        op.create_table(
            "duplicate_groups",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("scan_id", sa.String(length=36), nullable=False),
            sa.Column("resource_type", sa.String(length=20), nullable=False),
            sa.Column("group_key", sa.String(length=64), nullable=False),
            sa.Column("member_ids", sa.JSON(), nullable=True),
            sa.Column("confidence", sa.Float(), nullable=True),
            sa.Column("reasons", sa.JSON(), nullable=True),
            sa.Column("edges", sa.JSON(), nullable=True),
            sa.Column("suggested_parent_id", sa.String(length=36), nullable=True),
            sa.Column("suggested_kinds", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index("ix_duplicate_groups_scan_id", "duplicate_groups", ["scan_id"])
        op.create_index(
            "ix_duplicate_groups_scan_type", "duplicate_groups", ["scan_id", "resource_type"]
        )
    else:
        # ``edges`` landed after the table did, so an install that ran an early
        # build of this revision already has ``duplicate_groups`` without it and
        # would never get the column from the create branch above. Findings are
        # per-scan and disposable, so backfilling is unnecessary - the column
        # just has to exist before the next scan writes to it.
        cols = {c["name"] for c in insp.get_columns("duplicate_groups")}
        if "edges" not in cols:
            op.add_column("duplicate_groups", sa.Column("edges", sa.JSON(), nullable=True))

    if "duplicate_dismissals" not in existing_tables:
        op.create_table(
            "duplicate_dismissals",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("resource_type", sa.String(length=20), nullable=False),
            sa.Column("group_key", sa.String(length=64), nullable=False),
            sa.Column("member_ids", sa.JSON(), nullable=True),
            sa.Column("dismissed_by", sa.String(length=36), nullable=True),
            sa.Column("note", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("resource_type", "group_key", name="uq_dismissal_group"),
        )
        op.create_index(
            "ix_duplicate_dismissals_type", "duplicate_dismissals", ["resource_type"]
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    existing_tables = set(insp.get_table_names())

    for table in ("duplicate_dismissals", "duplicate_groups"):
        if table in existing_tables:
            op.drop_table(table)

    for table in _TABLES:
        if table not in existing_tables:
            continue
        index_name = f"ix_{table}_variant_parent"
        if index_name in {ix["name"] for ix in insp.get_indexes(table)}:
            op.drop_index(index_name, table_name=table)
        cols = {c["name"] for c in insp.get_columns(table)}
        # Unlike the columns themselves, the grouping a user built is real work;
        # dropping it is what a downgrade means, but it is not recoverable.
        for name, _ in _COLUMNS:
            if name in cols:
                op.drop_column(table, name)
