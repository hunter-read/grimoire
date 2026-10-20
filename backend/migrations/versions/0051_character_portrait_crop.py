"""character portrait crop: which part of the art a frame shows

A portrait is drawn in frames of several shapes - a square in the sheet's
header, the list's card, a tall panel a sheet places with ``<g-portrait>`` - and
centring the image in each cut the head off tall, full-length art.
``characters.portrait_crop`` holds the player's focus point and zoom, so every
frame keeps the part they chose in view. Null is the old behaviour: centred.

Revision ID: 5e1b7c9a2d40
Revises: 9d4b2e7f1a63
Create Date: 2026-10-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "5e1b7c9a2d40"
down_revision: Union[str, None] = "9d4b2e7f1a63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("characters")}
    if "portrait_crop" not in columns:
        op.add_column("characters", sa.Column("portrait_crop", sa.JSON(), nullable=True))


def downgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("characters")}
    if "portrait_crop" in columns:
        op.execute("ALTER TABLE characters DROP COLUMN portrait_crop")
