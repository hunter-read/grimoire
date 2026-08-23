"""add duplicate_groups.edges for installs that missed it (#304)

``edges`` was added to ``duplicate_groups`` after the table itself, inside the
same revision (``f2a86d31c705``). An install that ran an early build of that
revision therefore has the table stamped as migrated but without the column.
The backfill branch in ``f2a86d31c705`` cannot help them: Alembic never re-runs
a revision it has already stamped, so the column never arrives and every scan
fails on INSERT while ``/duplicates/groups`` fails on SELECT — the scan appears
to complete and report zero findings, because the job records the error in its
status and returns rather than raising.

This carries that same backfill as its own revision, so it actually runs.
Findings are per-scan and disposable, so nothing is backfilled into the column —
it only has to exist before the next scan writes to it.

Revision ID: a1c37e4d9f28
Revises: f2a86d31c705
Create Date: 2026-08-22 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a1c37e4d9f28"
down_revision: Union[str, None] = "f2a86d31c705"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "duplicate_groups" not in set(insp.get_table_names()):
        return
    if "edges" not in {c["name"] for c in insp.get_columns("duplicate_groups")}:
        op.add_column("duplicate_groups", sa.Column("edges", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Left in place: dropping it would break the current code against a database
    # this revision is no longer responsible for creating.
    pass
