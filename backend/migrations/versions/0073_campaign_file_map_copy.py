"""campaign files: record which ones are copies of a deleted library map

Adds ``campaign_files.map_copy``. A campaign keeps a copy of a library map
deleted through the app; the column says whether that map was linked to the
campaign as a resource (``linked``) or only embedded in its pages
(``unlinked``), which decides who may read the copy. Null for an upload, and
for copies made before this column existed, which keep the rules they had.

Nullable, nothing to backfill. Idempotent.

Revision ID: 9b4e2f7a1c63
Revises: 7d2a9c4e1b58
Create Date: 2026-11-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "9b4e2f7a1c63"
down_revision: Union[str, None] = "7d2a9c4e1b58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("campaign_files"):
        return
    if "map_copy" not in {c["name"] for c in inspect(bind).get_columns("campaign_files")}:
        op.add_column("campaign_files", sa.Column("map_copy", sa.String(length=10), nullable=True))


def downgrade() -> None:
    op.drop_column("campaign_files", "map_copy")
