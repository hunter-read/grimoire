"""character gm_can_edit: a player may let their campaign's GM edit the sheet

A character placed in a campaign is readable by everyone at that table and
editable by its owner alone. ``characters.gm_can_edit`` is the player's opt-in
for the campaign's GM to edit it too. Existing sheets keep today's behaviour:
the column defaults to false.

Revision ID: 3c8f1a6e9b27
Revises: 5e1b7c9a2d40
Create Date: 2026-10-20 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "3c8f1a6e9b27"
down_revision: Union[str, None] = "5e1b7c9a2d40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("characters")}
    if "gm_can_edit" not in columns:
        op.add_column(
            "characters",
            sa.Column("gm_can_edit", sa.Boolean(), nullable=False, server_default=sa.text("0")),
        )


def downgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("characters")}
    if "gm_can_edit" in columns:
        op.execute("ALTER TABLE characters DROP COLUMN gm_can_edit")
