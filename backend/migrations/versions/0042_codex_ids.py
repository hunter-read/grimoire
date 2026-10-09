"""codex ids: link books and game systems to their GrimoireCodexDB records

Adds a nullable, indexed ``codex_id`` to ``books`` and ``game_systems``: the id
of the GrimoireCodexDB record (issue #35) a local record was matched to, fetched
from, or sent to. It is an id in another service, not a foreign key, and NULL
means "not linked".

Plain in-place ALTERs, as in 0040. Idempotent.

Revision ID: 9c4d2e7a1f30
Revises: 6b1e0c9d4a27
Create Date: 2026-10-08 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "9c4d2e7a1f30"
down_revision: Union[str, None] = "6b1e0c9d4a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("books", "game_systems")


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    for table in _TABLES:
        op.execute(f"DROP TABLE IF EXISTS _alembic_tmp_{table}")
        if "codex_id" not in _columns(table):
            op.add_column(table, sa.Column("codex_id", sa.String(length=40), nullable=True))
        index = f"ix_{table}_codex_id"
        if index not in _indexes(table):
            op.create_index(index, table, ["codex_id"], unique=False)


def downgrade() -> None:
    for table in _TABLES:
        index = f"ix_{table}_codex_id"
        if index in _indexes(table):
            op.drop_index(index, table_name=table)
        if "codex_id" in _columns(table):
            with op.batch_alter_table(table) as batch:
                batch.drop_column("codex_id")
