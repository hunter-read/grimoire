"""user importers: character importers a user installs for themselves

Adds ``user_importers``. A character importer that only reads uploaded files
with a YAML mapping makes no network request and runs no code, so - like a
character sheet - any user may install one into their own account. Importers
that fetch links or run scripts stay server-wide, admin-installed add-ons.

Idempotent: the table is only created when missing.

Revision ID: 7f3a2c9e1b64
Revises: 4c7e1a9b2d58
Create Date: 2026-10-12 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "7f3a2c9e1b64"
down_revision: Union[str, None] = "4c7e1a9b2d58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    if inspect(op.get_bind()).has_table("user_importers"):
        return
    op.create_table(
        "user_importers",
        sa.Column("id", sa.String(length=36), nullable=False),
        sa.Column("user_id", sa.String(length=36), nullable=False),
        sa.Column("importer_id", sa.String(length=100), nullable=False),
        sa.Column("name", sa.String(length=200), nullable=False),
        sa.Column("version", sa.String(length=20), nullable=True),
        sa.Column("manifest", sa.JSON(), nullable=True),
        sa.Column("source_url", sa.Text(), nullable=True),
        sa.Column("sha256", sa.String(length=64), nullable=True),
        sa.Column("created_at", sa.DateTime(), nullable=True),
        sa.Column("updated_at", sa.DateTime(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("user_id", "importer_id"),
    )
    op.create_index("ix_user_importers_user_id", "user_importers", ["user_id"])


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("user_importers"):
        op.drop_index("ix_user_importers_user_id", table_name="user_importers")
        op.drop_table("user_importers")
