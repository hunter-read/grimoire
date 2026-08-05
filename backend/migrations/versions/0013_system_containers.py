"""system containers

Adds the columns backing "system container" folders (issues #261, #262) — a
books folder whose immediate children are systems in their own right rather
than categories:

* ``game_systems.container_kind`` — ``""`` for an ordinary system, ``"parent"``
  for a parent system whose subfolders are editions (``books/Dungeons &
  Dragons/5e/`` → system "Dungeons & Dragons 5e"), ``"one-page"`` for the
  one-page/micro-RPG collection whose subfolders *and* loose files are each
  their own small system.
* ``game_systems.parent_id`` — self-FK set on the children of a container.
* ``game_systems.name_is_custom`` — set when a user renames a system so the
  scanner stops overwriting the folder-derived name on rescan (e.g. renaming
  the auto-generated "Dungeons & Dragons 2e" to "Advanced Dungeons & Dragons").

Existing rows keep ``container_kind=""``/``parent_id=NULL``, so a database that
has never used a container folder behaves exactly as before. Idempotent.

Revision ID: b8f3c7d1a520
Revises: d5e2b9f4c1a3
Create Date: 2026-08-05 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "b8f3c7d1a520"
down_revision: Union[str, None] = "d5e2b9f4c1a3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "game_systems"
_INDEX = "ix_game_systems_parent_id"


def _has_column(table: str, column: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def _has_index(table: str, index: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return index in {i["name"] for i in insp.get_indexes(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if not insp.has_table(_TABLE):
        return

    if not _has_column(_TABLE, "container_kind"):
        op.add_column(
            _TABLE,
            sa.Column(
                "container_kind",
                sa.String(length=20),
                nullable=True,
                server_default=sa.text("''"),
            ),
        )
    # No FK constraint: SQLite cannot add one to an existing table without a
    # full table rebuild, and the ORM-side relationship plus the scanner's own
    # bookkeeping already keep the reference consistent.
    if not _has_column(_TABLE, "parent_id"):
        op.add_column(_TABLE, sa.Column("parent_id", sa.String(length=36), nullable=True))
    if not _has_column(_TABLE, "name_is_custom"):
        op.add_column(
            _TABLE,
            sa.Column(
                "name_is_custom",
                sa.Boolean(),
                nullable=True,
                server_default=sa.text("0"),
            ),
        )
    if not _has_index(_TABLE, _INDEX):
        op.create_index(_INDEX, _TABLE, ["parent_id"])


def downgrade() -> None:
    if _has_index(_TABLE, _INDEX):
        op.drop_index(_INDEX, table_name=_TABLE)
    for column in ("name_is_custom", "parent_id", "container_kind"):
        if _has_column(_TABLE, column):
            op.drop_column(_TABLE, column)
