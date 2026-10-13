"""audio track numbers: disc/track position from the tags, and album order

Issue #494. The audio list labelled each row by filename, and only the
filenames kept an album in order. The scanner now reads the track and disc
number tags, and the gallery's "track" sort orders a folder by disc, then track,
then name.

* ``track_number`` and ``disc_number`` on ``audio``. Left NULL here: reading
  them means opening every file, which is the scanner's job, so the next scan
  fills them in once (0 for a file with no such tag).
* ``ix_audio_browse_track`` - ``ix_audio_browse_folder`` with the two numbers
  ahead of the name, so a folder's tracks in album order are an index walk.

``ANALYZE audio`` runs at the end so the planner has statistics for the new
index beside the others leading on ``variant_parent_id`` (see 0041).

Idempotent: columns and the index are only added when missing.

Revision ID: 2d9b6e4f8a13
Revises: 7f3a2c9e1b64
Create Date: 2026-10-13 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "2d9b6e4f8a13"
down_revision: Union[str, None] = "7f3a2c9e1b64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = ("track_number", "disc_number")


def _columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("audio")}


def upgrade() -> None:
    present = _columns()
    for column in _COLUMNS:
        if column not in present:
            op.add_column("audio", sa.Column(column, sa.Integer(), nullable=True))
    op.execute(
        "CREATE INDEX IF NOT EXISTS ix_audio_browse_track ON audio "
        "(variant_parent_id, folder_path, disc_number, track_number, sort_name, filename, id)"
    )
    op.execute("ANALYZE audio")


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_audio_browse_track")
    present = _columns()
    for column in _COLUMNS:
        if column in present:
            op.drop_column("audio", column)
