"""explicit locked: let an admin's explicit-content restriction stick

``users.allow_explicit`` was one column written by admins, the seed file, the
OIDC ``viewNSFW`` permission and the user's own preferences alike, so a user
could turn back on what an admin had turned off. ``explicit_locked`` records
that the "off" came from one of the others; the self-service route refuses to
turn explicit content on while it is set.

Whether an existing "off" was the user's choice or an admin's is not recorded,
so every existing "off" starts locked - the reading that cannot widen anyone's
access. An admin turning the setting on for a user clears it; an OIDC user's
lock is re-derived from the provider at their next sign-in.

Revision ID: 3c8e1f6b2d97
Revises: 7a2f9d4c1e85
Create Date: 2026-10-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


# revision identifiers, used by Alembic.
revision: str = "3c8e1f6b2d97"
down_revision: Union[str, None] = "7a2f9d4c1e85"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("users")}
    if "explicit_locked" not in columns:
        op.add_column("users", sa.Column("explicit_locked", sa.Boolean(), nullable=True))
    op.execute("UPDATE users SET explicit_locked = 1 WHERE allow_explicit = 0")
    op.execute("UPDATE users SET explicit_locked = 0 WHERE explicit_locked IS NULL")


def downgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("users")}
    if "explicit_locked" in columns:
        op.execute("ALTER TABLE users DROP COLUMN explicit_locked")
