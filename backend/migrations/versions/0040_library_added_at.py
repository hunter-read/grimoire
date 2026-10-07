"""library added_at: when each item first appeared in the library

Adds an indexed ``added_at`` to every library item table - books, maps, tokens,
audio and 3D models - so the library can surface recent additions: a "new"
badge, a date-added sort, a "recently added" filter, and a books API an external
notifier can poll. See issue #199.

Existing rows are backfilled from ``created_at``, which the scanner has set on
every insert since the baseline schema: it is the moment Grimoire first indexed
the file, and a move or an in-place replacement keeps that row rather than
inserting a new one. A legacy row with no ``created_at`` stays NULL - there is
nothing trustworthy to invent a date from, and the UI treats NULL as "added
before tracking began" (no badge, sorted last).

Plain in-place ALTERs, as in 0034/0035. Idempotent.

Revision ID: 1edcfbd4f21c
Revises: 34e9f14ea065
Create Date: 2026-10-07 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "1edcfbd4f21c"
down_revision: Union[str, None] = "34e9f14ea065"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("books", "generic_maps", "tokens", "audio", "models_3d")


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS _alembic_tmp_{table}")
        if "added_at" not in _columns(table):
            op.add_column(table, sa.Column("added_at", sa.DateTime(), nullable=True))
        # Re-runnable: only fills rows still empty, so a retried run cannot
        # overwrite a date the scanner has written since.
        op.execute(f"UPDATE {table} SET added_at = created_at WHERE added_at IS NULL")
        index = f"ix_{table}_added_at"
        if index not in _indexes(table):
            op.create_index(index, table, ["added_at"], unique=False)


def downgrade() -> None:
    for table in _TABLES:
        index = f"ix_{table}_added_at"
        if index in _indexes(table):
            op.drop_index(index, table_name=table)
        if "added_at" in _columns(table):
            op.drop_column(table, "added_at")
