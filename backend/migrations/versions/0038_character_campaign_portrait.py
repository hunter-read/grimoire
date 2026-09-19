"""characters: campaign scoping and portraits

Adds ``campaign_id`` and ``portrait_path`` to ``characters``.

``campaign_id`` is nullable because a character may exist before a campaign does
— a player rolls one up and joins a table later — and because a character can
outlive the game it was made for. Setting it lets the party read the sheet;
editing stays with the player who wrote it.

``portrait_path`` holds a filename under ``DATA_PATH/uploads/characters/``
rather than a path, so moving that directory is not a migration. It follows the
campaign character-art pattern, which stores filenames the same way.

Two nullable columns and nothing to backfill: a character with neither is
exactly what every existing row already is. Idempotent.

Revision ID: e5b93a7d1c48
Revises: d4a71c3e8f60
Create Date: 2026-09-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "e5b93a7d1c48"
down_revision: Union[str, None] = "d4a71c3e8f60"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(insp) -> set:
    return {column["name"] for column in insp.get_columns("characters")}


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if not insp.has_table("characters"):
        return

    existing = _columns(insp)
    if "campaign_id" not in existing:
        op.add_column(
            "characters", sa.Column("campaign_id", sa.String(length=36), nullable=True)
        )
        op.create_index("ix_characters_campaign_id", "characters", ["campaign_id"])
    if "portrait_path" not in existing:
        op.add_column(
            "characters", sa.Column("portrait_path", sa.String(length=255), nullable=True)
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if not insp.has_table("characters"):
        return

    existing = _columns(insp)
    if "portrait_path" in existing:
        op.drop_column("characters", "portrait_path")
    if "campaign_id" in existing:
        op.drop_index("ix_characters_campaign_id", table_name="characters")
        op.drop_column("characters", "campaign_id")
