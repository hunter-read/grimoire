"""saved audio sets (named playlists and soundboards)

Adds the ``audio_sets`` table backing per-user named playlists and soundboards
(issue #422). Both kinds share one table: they are the same shape — a name plus
an ordered list of audio ids with per-entry settings — and ``kind``
discriminates. ``entries`` holds the ordered list, ``layout`` the soundboard
grid size (null for a playlist).

New table only, so there is nothing to backfill. The live queue
(``sessionStorage``) and the live soundboard (``localStorage``) keep working
exactly as before; a saved set is something the user explicitly writes.
Idempotent.

Revision ID: b7f3c1e8a204
Revises: e4a9d07b3c15
Create Date: 2026-09-09 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "b7f3c1e8a204"
down_revision: Union[str, None] = "e4a9d07b3c15"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if not insp.has_table("audio_sets"):
        op.create_table(
            "audio_sets",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("kind", sa.String(length=20), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("entries", sa.JSON(), nullable=True),
            sa.Column("layout", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "kind", "name"),
        )
        op.create_index("ix_audio_sets_user_id", "audio_sets", ["user_id"])


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("audio_sets"):
        op.drop_index("ix_audio_sets_user_id", table_name="audio_sets")
        op.drop_table("audio_sets")
