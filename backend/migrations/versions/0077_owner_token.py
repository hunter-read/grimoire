"""a campaign owner's VTT token

A campaign member's token is stored on their ``campaign_members`` row
(``character_token_path``). The owner has no such row - the owner entry of a
campaign's member list is built from ``campaigns.owner_id`` - so a player
running a personal campaign could not keep a token for their character there.
Their character sheet has a portrait, but that is the character's art, and a
token stored over it would lose the illustration.

This adds the owner's slot to the campaign itself. Files land beside members'
tokens in ``DATA_PATH/campaign_uploads/tokens/``. Existing rows get NULL, which
reads as "no token set".

Revision ID: 8d3f6b1e2a47
Revises: 4c7e2a9d1b63
Create Date: 2026-11-20 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "8d3f6b1e2a47"
down_revision: Union[str, None] = "4c7e2a9d1b63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    if "campaigns" not in set(insp.get_table_names()):
        return
    existing = {c["name"] for c in insp.get_columns("campaigns")}
    if "owner_token_path" not in existing:
        op.add_column(
            "campaigns",
            sa.Column("owner_token_path", sa.String(255), nullable=True),
        )


def downgrade() -> None:
    # Left in place: dropping it would break the current code against a database
    # this revision is no longer responsible for creating.
    pass
