"""saved_filters: per-user named sort/filter presets with a per-scope default

Adds the ``saved_filters`` table backing server-side saved filters for the
library scopes (systems/books/maps/tokens/audio). One preset per (user, scope)
may be the default the user lands on.

Revision ID: 96927e7cb35e
Revises: 6be3e9a796c4
Create Date: 2026-07-25 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "96927e7cb35e"
down_revision: Union[str, None] = "6be3e9a796c4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def upgrade() -> None:
    if "saved_filters" not in _tables():
        op.create_table(
            "saved_filters",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("scope", sa.String(length=20), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("state", sa.JSON(), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("user_id", "scope", "name"),
        )
        op.create_index("ix_saved_filters_user_id", "saved_filters", ["user_id"])


def downgrade() -> None:
    if "saved_filters" in _tables():
        op.drop_index("ix_saved_filters_user_id", table_name="saved_filters")
        op.drop_table("saved_filters")
