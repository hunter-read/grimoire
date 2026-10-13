"""Per-user DiceCloud API key for private character URL import.

DiceCloud keys belong to a player's own DiceCloud account. Storing them on the
user row (and reading them from settings) replaces a shared ``DICECLOUD_API_KEY``
environment variable that every account — guests included — would otherwise
share.

Idempotent: the column is only added when missing.

Revision ID: a8c3e1f5b902
Revises: 6b1e0c9d4a27
Create Date: 2026-10-13 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a8c3e1f5b902"
down_revision: Union[str, None] = "6b1e0c9d4a27"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "dicecloud_api_key" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column(
            "users",
            sa.Column("dicecloud_api_key", sa.String(length=500), nullable=True),
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if "dicecloud_api_key" in {c["name"] for c in insp.get_columns("users")}:
        op.drop_column("users", "dicecloud_api_key")
