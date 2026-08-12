"""per-app-mode theme selection

Adds ``user_themes.app_mode`` (which app mode a theme was built for) and
``users.theme_by_mode`` (the colour mode / theme a user picked in every app mode
other than the default).

Two different things are called a "mode", so they are named apart throughout:
``app_mode`` is Grimoire (TTRPG) or Codex (wargaming), while ``theme_mode`` stays
light / dark / system.

Grimoire's own selection stays in ``users.theme_mode`` / ``users.theme_id``, so
existing rows keep working untouched and nothing needs backfilling: a theme with
no app mode recorded is a Grimoire theme, which is what every existing row is.

Nullable columns with defaults, so this is additive and idempotent.

Revision ID: a4d8e0f7b512
Revises: f2b6a91c4d38
Create Date: 2026-08-11 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a4d8e0f7b512"
down_revision: Union[str, None] = "f2b6a91c4d38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(insp, table: str) -> set:
    return {c["name"] for c in insp.get_columns(table)}


def upgrade() -> None:
    insp = inspect(op.get_bind())

    if insp.has_table("user_themes") and "app_mode" not in _columns(insp, "user_themes"):
        op.add_column(
            "user_themes",
            sa.Column("app_mode", sa.String(length=20), nullable=True, server_default="grimoire"),
        )

    if "theme_by_mode" not in _columns(insp, "users"):
        op.add_column("users", sa.Column("theme_by_mode", sa.JSON(), nullable=True))


def downgrade() -> None:
    insp = inspect(op.get_bind())

    if "theme_by_mode" in _columns(insp, "users"):
        op.drop_column("users", "theme_by_mode")

    if insp.has_table("user_themes") and "app_mode" in _columns(insp, "user_themes"):
        op.drop_column("user_themes", "app_mode")
