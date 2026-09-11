"""a character's VTT token, separate from their portrait

A member already has ``character_art_path`` -- a portrait for the campaign page.
A *token* is a different picture with a different job: the cropped, framed disc
that goes on a battlemap. A character routinely has one without the other, and
overwriting the portrait to store a token would lose the illustration, so this
is its own column rather than a reuse of the existing one.

Files land in ``DATA_PATH/campaign_uploads/tokens/``, mirroring how art is
stored under ``.../art/``. Nothing is written to the shared library: the token
editor composes in the browser and must keep working against a read-only
library, so a character token is campaign data, not a library Token row.

Existing rows get NULL, which reads as "no token set" -- so an upgrade gives
nobody a token they did not make.

Revision ID: a1c7e93d5b60
Revises: c9d24e6f1b38
Create Date: 2026-09-10 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "a1c7e93d5b60"
down_revision: Union[str, None] = "c9d24e6f1b38"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "campaign_members" not in set(insp.get_table_names()):
        return
    existing = {c["name"] for c in insp.get_columns("campaign_members")}
    if "character_token_path" not in existing:
        op.add_column(
            "campaign_members",
            sa.Column("character_token_path", sa.String(255), nullable=True),
        )


def downgrade() -> None:
    # Left in place: dropping it would break the current code against a database
    # this revision is no longer responsible for creating.
    pass
