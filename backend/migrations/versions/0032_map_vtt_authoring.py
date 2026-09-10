"""authored Universal VTT geometry for maps

Backs the in-app UVTT editor (issues #126 and #127): walls, portals and lights
a GM draws over a raster map, plus the grid calibration that anchors them.

Storage is a JSON column on ``generic_maps`` rather than a sidecar file next to
the image. The library is routinely mounted read-only, and authoring must never
modify or add files beside the user's own maps -- the export endpoint builds a
fresh ``.uvtt`` on demand from this column instead.

``vtt_data`` holds the whole authored document::

    {
      "version": 1,
      "pixels_per_grid": 140.0,     # what the geometry was authored against
      "grid_offset": {"x": 0, "y": 0},   # pixel offset of the grid's top-left
      "line_of_sight": [[{"x":.., "y":..}, ...], ...],   # grid units
      "objects_line_of_sight": [...],
      "portals": [{"bounds": [{...},{...}], "closed": true, "freestanding": false}],
      "lights": [{"position": {...}, "range": 3.0, "intensity": 1.0,
                  "color": "ffffffff", "shadows": true}],
      "environment": {"baked_lighting": false, "ambient_light": "00000000"}
    }

Geometry is stored in **grid units**, as the format itself uses, but the
``pixels_per_grid`` it was authored at is stored alongside: everything is
scale-relative, so replacing or resizing the source image would otherwise
silently invalidate authored walls with no way to detect it.

NULL means "nothing authored", which is what every existing row gets -- so an
upgrade changes nothing about any current map. Idempotent.

Revision ID: c9d24e6f1b38
Revises: b7f3c1e8a204
Create Date: 2026-09-09 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c9d24e6f1b38"
down_revision: Union[str, None] = "b7f3c1e8a204"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "generic_maps" not in set(insp.get_table_names()):
        return
    existing = {c["name"] for c in insp.get_columns("generic_maps")}
    if "vtt_data" not in existing:
        op.add_column("generic_maps", sa.Column("vtt_data", sa.JSON(), nullable=True))


def downgrade() -> None:
    # Left in place: dropping this would discard authored geometry that cannot
    # be recovered, and the column is inert for code that does not read it.
    pass
