"""campaign icon colour

Adds ``wiki_pages.icon_color`` and ``campaign_categories.icon_color`` — an
optional per-entry tint for the campaign tree icon (issue #198). The value is
either a preset palette token (e.g. ``red``) or a ``#rrggbb`` literal; null
means the icon inherits the row's text colour.

Previously the icon was tinted by the page's visibility, which encoded
permission state in colour alone. Visibility now has its own glyph, freeing the
colour for user choice. Idempotent.

Revision ID: d5e2b9f4c1a3
Revises: a4d8f1c9e2b7
Create Date: 2026-08-04 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "d5e2b9f4c1a3"
down_revision: Union[str, None] = "a4d8f1c9e2b7"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLES = ("wiki_pages", "campaign_categories")


def _has_column(table: str, column: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())
    for table in _TABLES:
        if not insp.has_table(table):
            continue
        if not _has_column(table, "icon_color"):
            op.add_column(table, sa.Column("icon_color", sa.String(length=20), nullable=True))


def downgrade() -> None:
    for table in _TABLES:
        if _has_column(table, "icon_color"):
            op.drop_column(table, "icon_color")
