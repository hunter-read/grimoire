"""paired light/dark theme variants

Adds ``user_themes.variants``: a theme's palettes keyed by colour mode, so one
theme can cover light *and* dark and System can follow the OS within it.

Its own revision rather than an edit to 0017: that one had already
been applied on running installs, and Alembic never re-runs a revision it has
stamped — the column would silently never appear, which is exactly the
``no such column: user_themes.variants`` failure this fixes.

Nothing to backfill. A row with no variants recorded is read as a single-mode
theme whose one palette is its existing ``tokens``.

Revision ID: c7e1a94b2f60
Revises: a4d8e0f7b512
Create Date: 2026-08-11 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c7e1a94b2f60"
down_revision: Union[str, None] = "a4d8e0f7b512"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(insp, table: str) -> set:
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if insp.has_table("user_themes") and "variants" not in _columns(insp, "user_themes"):
        op.add_column("user_themes", sa.Column("variants", sa.JSON(), nullable=True))


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if insp.has_table("user_themes") and "variants" in _columns(insp, "user_themes"):
        op.drop_column("user_themes", "variants")
