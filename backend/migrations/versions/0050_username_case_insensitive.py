"""username case-insensitive: a unique index on lower(username)

Sign-in has matched usernames case-insensitively for a long time, but
uniqueness was case-sensitive, so "Admin" could be created beside "admin"
(by OIDC auto-registration, for one). Every "is this name taken" check now
ignores case, and this index makes the database agree.

An instance that already holds accounts differing only in case can't take the
index; the migration logs them instead of failing, and start-up creates the
index once they are renamed (``backend.usernames.ensure_unique_index``, which
this revision carries its own copy of).

Revision ID: 9d4b2e7f1a63
Revises: 3c8e1f6b2d97
Create Date: 2026-10-19 00:00:00.000000+00:00

"""
import logging
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "9d4b2e7f1a63"
down_revision: Union[str, None] = "3c8e1f6b2d97"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


_INDEX = "ix_users_username_lower"

logger = logging.getLogger("grimoire.users")


def upgrade() -> None:
    bind = op.get_bind()
    exists = bind.execute(
        text("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :n"),
        {"n": _INDEX},
    ).first()
    if exists:
        return
    duplicates = bind.execute(
        text(
            "SELECT lower(username), group_concat(username, ', ') FROM users "
            "GROUP BY lower(username) HAVING count(*) > 1"
        )
    ).all()
    if duplicates:
        for _, names in duplicates:
            logger.warning(
                "Accounts whose usernames differ only in case: %s. Rename all but "
                "one in Settings > Users; usernames are case-insensitive.",
                names,
            )
        return
    bind.execute(text(f"CREATE UNIQUE INDEX {_INDEX} ON users (lower(username))"))


def downgrade() -> None:
    op.execute(f"DROP INDEX IF EXISTS {_INDEX}")
