"""token editor recipes, kept with the tokens they made

A token made in the token editor is a flat PNG, so changing it meant building
it again from the original art. Each stored token now keeps the editor's
settings and where its art came from - a "recipe" - beside it, so the editor
can reopen it exactly as it was:

* ``campaign_members.character_token_recipe`` for a member's token,
* ``campaigns.owner_token_recipe`` for the owner's own token,
* ``campaign_files.token_recipe`` for a token filed as a campaign resource.

A column on each row rather than a table of their own: a recipe describes one
file and lives and dies with the row naming it, so removing a member, a file or
a campaign takes the recipe with it and nothing is left to sweep up. Art
uploaded from a device is kept under ``DATA_PATH/campaign_uploads/token_sources/``
and removed with the token. Existing rows get NULL: tokens made before this
simply cannot be reopened.

Revision ID: 3e9b5c7a1d82
Revises: 8d3f6b1e2a47
Create Date: 2026-11-20 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "3e9b5c7a1d82"
down_revision: Union[str, None] = "8d3f6b1e2a47"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_COLUMNS = (
    ("campaign_members", "character_token_recipe"),
    ("campaigns", "owner_token_recipe"),
    ("campaign_files", "token_recipe"),
)


def upgrade() -> None:
    insp = inspect(op.get_bind())
    tables = set(insp.get_table_names())
    for table, column in _COLUMNS:
        if table not in tables:
            continue
        existing = {c["name"] for c in insp.get_columns(table)}
        if column not in existing:
            op.add_column(table, sa.Column(column, sa.JSON(), nullable=True))


def downgrade() -> None:
    # Left in place: dropping them would break the current code against a
    # database this revision is no longer responsible for creating.
    pass
