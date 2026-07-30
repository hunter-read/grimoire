"""tag category

Adds ``tags.category`` — the single resource type a tag belongs to, or ``shared``
when it spans more than one (issue #235 follow-up). Backfills from existing
``resource_tags`` usage: a tag used on exactly one resource type takes that type;
a tag used across multiple types (or on none) becomes ``shared``. Idempotent.

Revision ID: a4d8f1c9e2b7
Revises: f3c1a7d2e6b8
Create Date: 2026-07-28 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "a4d8f1c9e2b7"
down_revision: Union[str, None] = "f3c1a7d2e6b8"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_column(table: str, column: str) -> bool:
    insp = inspect(op.get_bind())
    if not insp.has_table(table):
        return False
    return column in {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("tags"):
        return
    if not _has_column("tags", "category"):
        op.add_column(
            "tags",
            sa.Column("category", sa.String(length=20), nullable=False, server_default="shared"),
        )

    # Backfill: distinct resource types per tag from resource_tags.
    rows = bind.execute(
        text(
            "SELECT tag_id, resource_type FROM resource_tags GROUP BY tag_id, resource_type"
        )
    ).fetchall()
    types_by_tag: dict[str, set] = {}
    for tag_id, rtype in rows:
        types_by_tag.setdefault(tag_id, set()).add(rtype)

    for tag_id, types in types_by_tag.items():
        category = next(iter(types)) if len(types) == 1 else "shared"
        bind.execute(
            text("UPDATE tags SET category = :c WHERE id = :id"),
            {"c": category, "id": tag_id},
        )


def downgrade() -> None:
    if _has_column("tags", "category"):
        op.drop_column("tags", "category")
