"""defer heavy 3D thumbnails to a queue

Rasterising a mesh happens in Python, so cost scales with triangle count: a
detailed miniature is a fraction of a second, but a photogrammetry scan or a
large multi-part terrain piece can run to half a minute. Doing that inline meant
one heavy file could stall the library walk, and the old fix — refusing anything
past a million triangles — simply left those models with no thumbnail at all.

Adds ``thumbnail_pending`` to ``models_3d``, mirroring ``books.ocr_pending``.
The scan flags a heavy mesh instead of rendering it, and a queue drains the
flagged rows once the fast phases are done, with a per-model budget of its own.

Existing rows default to 0: they were either thumbnailed already or refused for
being over the old cap. The latter are picked up by the maintenance backfill
rather than by this migration, so an upgrade does not silently start a long
render on the next scan.

Revision ID: d38b1c6f92a7
Revises: c7f5a2b81e64
Create Date: 2026-09-05 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "d38b1c6f92a7"
down_revision: Union[str, None] = "c7f5a2b81e64"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "models_3d" not in set(insp.get_table_names()):
        return
    if "thumbnail_pending" not in {c["name"] for c in insp.get_columns("models_3d")}:
        op.add_column(
            "models_3d",
            sa.Column("thumbnail_pending", sa.Boolean(), nullable=True, server_default="0"),
        )


def downgrade() -> None:
    # Left in place: dropping it would break the current code against a database
    # this revision is no longer responsible for creating.
    pass
