"""content hash + mtime for change and move detection

Library files are identified solely by ``filepath``, so replacing a file in place
leaves every derived artifact (page renders, thumbnail, FTS rows) stale forever,
and moving a file reads as delete + insert, losing tags/favorites/progress.

Adds a content hash and mtime to all four file-backed tables so the scanner can
tell "same path, different bytes" from "different path, same bytes" (issue #284).

Both columns are nullable and left NULL on upgrade: the next scan backfills them,
and a NULL hash is treated as *unchanged* so upgrading never triggers a
library-wide re-render.

Revision ID: e9a4c17b2d68
Revises: b5c2e7f19a43
Create Date: 2026-08-14 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "e9a4c17b2d68"
down_revision: Union[str, None] = "b5c2e7f19a43"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Every file-backed table shares the same staleness and move problems.
_TABLES = ("books", "generic_maps", "tokens", "audio")


def upgrade() -> None:
    insp = inspect(op.get_bind())
    existing_tables = set(insp.get_table_names())

    for table in _TABLES:
        if table not in existing_tables:
            continue
        cols = {c["name"] for c in insp.get_columns(table)}
        if "content_hash" not in cols:
            op.add_column(table, sa.Column("content_hash", sa.String(length=64), nullable=True))
        if "file_mtime" not in cols:
            op.add_column(table, sa.Column("file_mtime", sa.Float(), nullable=True))

        # Move detection looks rows up by hash across the whole table.
        index_name = f"ix_{table}_content_hash"
        if index_name not in {ix["name"] for ix in insp.get_indexes(table)}:
            op.create_index(index_name, table, ["content_hash"])


def downgrade() -> None:
    insp = inspect(op.get_bind())
    existing_tables = set(insp.get_table_names())

    for table in _TABLES:
        if table not in existing_tables:
            continue
        index_name = f"ix_{table}_content_hash"
        if index_name in {ix["name"] for ix in insp.get_indexes(table)}:
            op.drop_index(index_name, table_name=table)
        cols = {c["name"] for c in insp.get_columns(table)}
        if "file_mtime" in cols:
            op.drop_column(table, "file_mtime")
        if "content_hash" in cols:
            op.drop_column(table, "content_hash")
