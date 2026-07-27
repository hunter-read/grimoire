"""system folder-cover path

Adds game_systems.folder_cover_path — the library-relative path to a
cover.*/folder.* image found at a system's folder root by the scanner. It takes
precedence over the admin-uploaded cover_image, which beats the cover_book_id
fallback. Idempotent.

Revision ID: 1537716d5347
Revises: 873d3303ba93
Create Date: 2026-07-26 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "1537716d5347"
down_revision: Union[str, None] = "873d3303ba93"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def upgrade() -> None:
    if "folder_cover_path" not in _columns("game_systems"):
        op.add_column(
            "game_systems",
            sa.Column("folder_cover_path", sa.String(length=1000), nullable=True, server_default=""),
        )


def downgrade() -> None:
    if "folder_cover_path" in _columns("game_systems"):
        op.drop_column("game_systems", "folder_cover_path")
