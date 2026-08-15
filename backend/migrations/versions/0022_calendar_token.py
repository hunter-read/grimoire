"""per-user calendar feed token

Calendar apps subscribing to an ICS feed cannot send an ``Authorization``
header, so the feed URL has to carry its own credential. This adds a dedicated,
revocable per-user token rather than reusing the JWT or ``opds_token``: it
grants read access to campaign schedule data only, and rotating it invalidates
subscription URLs without disturbing login sessions or the OPDS feed (#149).

Nullable and left NULL on upgrade — a token is minted lazily the first time a
user asks for their subscription URL, so upgrading hands out no new credentials.

Revision ID: a1f6b3d9e402
Revises: e9a4c17b2d68
Create Date: 2026-08-14 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a1f6b3d9e402"
down_revision: Union[str, None] = "e9a4c17b2d68"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "users" not in set(insp.get_table_names()):
        return

    cols = {c["name"] for c in insp.get_columns("users")}
    if "calendar_token" not in cols:
        op.add_column("users", sa.Column("calendar_token", sa.String(length=64), nullable=True))

    # Feed requests look the user up by token alone, on every calendar poll.
    # Partial + unique: NULL means "no feed", and many users share that state.
    if "ix_users_calendar_token" not in {ix["name"] for ix in insp.get_indexes("users")}:
        op.create_index(
            "ix_users_calendar_token",
            "users",
            ["calendar_token"],
            unique=True,
            sqlite_where=sa.text("calendar_token IS NOT NULL"),
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if "users" not in set(insp.get_table_names()):
        return

    if "ix_users_calendar_token" in {ix["name"] for ix in insp.get_indexes("users")}:
        op.drop_index("ix_users_calendar_token", table_name="users")
    if "calendar_token" in {c["name"] for c in insp.get_columns("users")}:
        op.drop_column("users", "calendar_token")
