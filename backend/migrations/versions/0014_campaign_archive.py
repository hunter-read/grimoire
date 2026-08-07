"""campaign archiving

Adds ``campaigns.is_archived`` and ``campaigns.archived_at``. An archived
campaign is hidden from the campaign list unless it is explicitly requested
(``?include_archived=true``) and is frozen read-only for everyone, reusing the
same write-refusal path as the owner-level ``locked`` state.

Existing campaigns are backfilled to not-archived, which is the pre-feature
behaviour. Idempotent.

Revision ID: c3a7e5b1d904
Revises: b8f3c7d1a520
Create Date: 2026-08-06 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c3a7e5b1d904"
down_revision: Union[str, None] = "b8f3c7d1a520"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if not insp.has_table("campaigns"):
        return
    if not _has_column("campaigns", "is_archived"):
        # server_default backfills existing rows; the column is NOT NULL because
        # every listing query filters on it and a NULL would drop rows silently.
        op.add_column(
            "campaigns",
            sa.Column(
                "is_archived",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            ),
        )
    if not _has_column("campaigns", "archived_at"):
        op.add_column("campaigns", sa.Column("archived_at", sa.DateTime(), nullable=True))


def downgrade() -> None:
    for column in ("archived_at", "is_archived"):
        if _has_column("campaigns", column):
            op.drop_column("campaigns", column)
