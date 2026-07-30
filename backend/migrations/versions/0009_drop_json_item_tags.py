"""drop legacy JSON tag columns from item tables

Item tags moved to the shared-tag tables (``tags`` / ``resource_tags``) in 0008,
and all reads/writes now go through them (issue #235). This drops the now-unused
JSON ``tags`` column from the five item tables. Folder tables keep their JSON
``tags`` (folder tagging is a separate, unchanged feature). Idempotent.

The 0008 backfill already copied every JSON tag into the shared tables, so no data
is lost. ``downgrade`` re-adds the (empty) columns for schema symmetry.

Revision ID: e2b8c6a4d9f1
Revises: c7a9e1f2b8d4
Create Date: 2026-07-27 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "e2b8c6a4d9f1"
down_revision: Union[str, None] = "c7a9e1f2b8d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# Item tables whose per-row JSON ``tags`` column is dropped (folder tables keep it).
_ITEM_TABLES = ["game_systems", "books", "generic_maps", "tokens", "audio"]


def _has_column(table: str, column: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def _drop_leftover_tmp(table: str) -> None:
    """Remove any ``_alembic_tmp_<table>`` left behind by a previously interrupted
    batch migration. SQLite's batch (copy-and-move) column change creates this temp
    table; if an earlier run died mid-flight it lingers and makes every retry fail
    with "table _alembic_tmp_<table> already exists". Dropping it first makes this
    migration self-healing.
    """
    op.get_bind().execute(text(f'DROP TABLE IF EXISTS "_alembic_tmp_{table}"'))


def _supports_native_drop(bind) -> bool:
    """SQLite gained ``ALTER TABLE ... DROP COLUMN`` in 3.35.0 (2021). When
    available we use it directly — no table rebuild, no ``_alembic_tmp_*`` temp
    table, so no cross-worker collision or leftover-temp-table failure mode."""
    if bind.dialect.name != "sqlite":
        return True  # other backends support DROP COLUMN natively
    version = getattr(bind.dialect, "server_version_info", None)
    return bool(version) and version >= (3, 35, 0)


def upgrade() -> None:
    bind = op.get_bind()
    for table in _ITEM_TABLES:
        # Clear any leftover temp table from a previously interrupted attempt on
        # an older version of this migration, so a retry always starts clean.
        _drop_leftover_tmp(table)
        if not _has_column(table, "tags"):
            continue
        if _supports_native_drop(bind):
            bind.execute(text(f'ALTER TABLE "{table}" DROP COLUMN "tags"'))
        else:
            with op.batch_alter_table(table) as batch:
                batch.drop_column("tags")


def downgrade() -> None:
    for table in _ITEM_TABLES:
        if not _has_column(table, "tags"):
            op.add_column(table, sa.Column("tags", sa.JSON(), nullable=True))
