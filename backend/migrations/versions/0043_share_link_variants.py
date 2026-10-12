"""share link variants: links that serve a derived form of an item

Adds ``share_links.variant`` and ``share_links.variant_options`` (issue #551).
A link with no variant serves the item as it is; ``variant = "otfbm"`` serves a
map resized for an OTFBM background, at the cell size held in
``variant_options`` (``{"cell": 70}``). Both are NULL for every existing link,
which keeps them serving exactly what they did.

Idempotent: each column is only added when missing.

Revision ID: 4c7e1a9b2d58
Revises: 9d2f4b6a8c31
Create Date: 2026-10-12 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "4c7e1a9b2d58"
down_revision: Union[str, None] = "9d2f4b6a8c31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns() -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns("share_links")}


def upgrade() -> None:
    present = _columns()
    if "variant" not in present:
        op.add_column("share_links", sa.Column("variant", sa.String(length=20), nullable=True))
    if "variant_options" not in present:
        op.add_column("share_links", sa.Column("variant_options", sa.JSON(), nullable=True))


def downgrade() -> None:
    present = _columns()
    if "variant_options" in present:
        op.drop_column("share_links", "variant_options")
    if "variant" in present:
        op.drop_column("share_links", "variant")
