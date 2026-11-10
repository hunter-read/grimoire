"""gm screen panels: a campaign's board of GM tools

Adds the ``gm_screen_panels`` table (issue #764). Each row is one tool on a
campaign's GM screen - a counter, countdowns, the party overview - at one cell
of the grid. The campaign foreign key cascades, so deleting a campaign takes
its board with it.

Creating a table, so there is nothing to backfill. Idempotent.

Revision ID: 649b0f0b5a11
Revises: 5d2b8e9f4a17
Create Date: 2026-11-10 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "649b0f0b5a11"
down_revision: Union[str, None] = "5d2b8e9f4a17"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_INDEX = "ix_gm_screen_panels_campaign_id"


def upgrade() -> None:
    inspector = inspect(op.get_bind())
    if not inspector.has_table("gm_screen_panels"):
        op.create_table(
            "gm_screen_panels",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("campaign_id", sa.String(length=36), nullable=False),
            sa.Column("kind", sa.String(length=30), nullable=False),
            sa.Column("title", sa.String(length=120), nullable=False),
            sa.Column("x", sa.Integer(), nullable=False),
            sa.Column("y", sa.Integer(), nullable=False),
            sa.Column("w", sa.Integer(), nullable=False),
            sa.Column("h", sa.Integer(), nullable=False),
            sa.Column("config", sa.JSON(), nullable=True),
            sa.Column("state", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["campaign_id"], ["campaigns.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
        )
        inspector = inspect(op.get_bind())
    if _INDEX not in {i["name"] for i in inspector.get_indexes("gm_screen_panels")}:
        op.create_index(_INDEX, "gm_screen_panels", ["campaign_id"], unique=False)


def downgrade() -> None:
    if inspect(op.get_bind()).has_table("gm_screen_panels"):
        op.drop_table("gm_screen_panels")
