"""title-case display for migrated tags

The 0008 backfill copied the legacy JSON tag values (which were stored lowercased)
straight into ``tags.display``, leaving migrated tags with an all-lowercase display.
This retitles those: any tag whose display is still all-lowercase (i.e. it was never
given a proper display casing) is Title-Cased. Tags a user has explicitly cased are
left untouched. Idempotent.

Revision ID: f3c1a7d2e6b8
Revises: e2b8c6a4d9f1
Create Date: 2026-07-27 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import inspect, text


revision: str = "f3c1a7d2e6b8"
down_revision: Union[str, None] = "e2b8c6a4d9f1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _title_case(value: str) -> str:
    return " ".join(w[:1].upper() + w[1:] if w else w for w in value.split(" "))


def upgrade() -> None:
    bind = op.get_bind()
    if not inspect(bind).has_table("tags"):
        return
    rows = bind.execute(text("SELECT id, display FROM tags")).fetchall()
    for tid, display in rows:
        if display and display == display.lower():
            titled = _title_case(display)
            if titled != display:
                bind.execute(
                    text("UPDATE tags SET display = :d WHERE id = :id"),
                    {"d": titled, "id": tid},
                )


def downgrade() -> None:
    # One-way data normalization; nothing to revert.
    pass
