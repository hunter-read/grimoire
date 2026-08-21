"""banner focal point and audio cover image (#286)

Two additions for setting images from assets Grimoire already holds:

* ``campaigns.banner_focus_y`` — where the banner image sits vertically inside
  the 2:1 hero, as a 0–100 percentage (50 = centred, the CSS default). A banner
  chosen from a library map is rarely 2:1, so without a reposition control the
  interesting part is routinely cropped out. Stored on the campaign rather than
  baked into the stored bytes so it stays adjustable after the fact.
* ``audio.cover_image`` — a bare filename under ``DATA_PATH/audio_covers/`` for
  a cover set through the UI. Tracks previously had artwork only from a folder
  image or an embedded tag, neither of which the user can set from Grimoire.

Both nullable/defaulted, so upgrading changes nothing for existing rows.

Revision ID: c72e5b81a934
Revises: a1f6b3d9e402
Create Date: 2026-08-20 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c72e5b81a934"
down_revision: Union[str, None] = "a1f6b3d9e402"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    tables = _tables()
    if "campaigns" in tables and "banner_focus_y" not in _columns("campaigns"):
        op.add_column(
            "campaigns",
            sa.Column("banner_focus_y", sa.Integer(), nullable=True, server_default="50"),
        )
    if "audio" in tables and "cover_image" not in _columns("audio"):
        op.add_column(
            "audio",
            sa.Column("cover_image", sa.String(length=255), nullable=True, server_default=""),
        )


def downgrade() -> None:
    tables = _tables()
    if "campaigns" in tables and "banner_focus_y" in _columns("campaigns"):
        op.drop_column("campaigns", "banner_focus_y")
    if "audio" in tables and "cover_image" in _columns("audio"):
        op.drop_column("audio", "cover_image")
