"""manual grid override for maps

Grid dimensions were derived on every request and never stored, so a wrong
guess could not be corrected. That mattered once ``.uvtt`` export landed
(issue #125): the detected grid is baked into every exported file, and a map
whose cell size is misread exports a grid the VTT then draws wrong.

Adds ``grid_width``/``grid_height``/``grid_px`` to ``generic_maps``. All three
are nullable, and NULL is the signal: it means "no override, use detection".
Floats rather than ints because maps routinely bleed a partial cell past the
nominal grid -- a 33x24 battlemap with a quarter-cell margin is really
33.5x24.5 -- and UVTT's own ``map_size`` is numeric.

Existing rows get NULL, so an upgrade changes nothing about how any current map
reports its grid.

Revision ID: e4a9d07b3c15
Revises: d38b1c6f92a7
Create Date: 2026-09-08 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "e4a9d07b3c15"
down_revision: Union[str, None] = "d38b1c6f92a7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "generic_maps" not in set(insp.get_table_names()):
        return
    existing = {c["name"] for c in insp.get_columns("generic_maps")}
    for name in ("grid_width", "grid_height", "grid_px"):
        if name not in existing:
            op.add_column("generic_maps", sa.Column(name, sa.Float(), nullable=True))


def downgrade() -> None:
    # Left in place: dropping these would break the current code against a
    # database this revision is no longer responsible for creating.
    pass
