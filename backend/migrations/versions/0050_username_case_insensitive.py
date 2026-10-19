"""username case-insensitive: a unique index on lower(username)

Sign-in has matched usernames case-insensitively for a long time, but
uniqueness was case-sensitive, so "Admin" could be created beside "admin"
(by OIDC auto-registration, for one). Every "is this name taken" check now
ignores case, and this index makes the database agree.

An instance that already holds accounts differing only in case can't take the
index; the migration logs them instead of failing, and start-up creates the
index once they are renamed (``backend.usernames.ensure_unique_index``).

Revision ID: 9d4b2e7f1a63
Revises: 3c8e1f6b2d97
Create Date: 2026-10-19 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op


# revision identifiers, used by Alembic.
revision: str = "9d4b2e7f1a63"
down_revision: Union[str, None] = "3c8e1f6b2d97"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    from backend.usernames import ensure_unique_index

    ensure_unique_index(op.get_bind())


def downgrade() -> None:
    op.execute("DROP INDEX IF EXISTS ix_users_username_lower")
