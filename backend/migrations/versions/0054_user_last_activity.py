"""user activity: when each account last signed in and was last active

Adds ``users.last_login_at`` and ``users.last_active_at`` (issue #576), shown on
the admin users list. Both are backfilled from the account's login sessions -
the newest session's ``created_at`` and the latest ``last_used_at`` - so an
upgraded instance shows something straight away rather than "Never" for
everyone. Sessions purged before the upgrade are gone, so an account idle for
longer than that stays NULL until it next signs in. Idempotent.

Revision ID: 243b40052a01
Revises: 7c2f9e4a1b58
Create Date: 2026-10-21 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "243b40052a01"
down_revision: Union[str, None] = "7c2f9e4a1b58"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    columns = {c["name"] for c in inspect(bind).get_columns("users")}
    if "last_login_at" not in columns:
        op.add_column("users", sa.Column("last_login_at", sa.DateTime(), nullable=True))
    if "last_active_at" not in columns:
        op.add_column("users", sa.Column("last_active_at", sa.DateTime(), nullable=True))
    if not inspect(bind).has_table("auth_sessions"):
        return
    op.execute(
        "UPDATE users SET last_login_at = ("
        " SELECT MAX(s.created_at) FROM auth_sessions s WHERE s.user_id = users.id"
        ") WHERE last_login_at IS NULL"
    )
    op.execute(
        "UPDATE users SET last_active_at = ("
        " SELECT MAX(COALESCE(s.last_used_at, s.created_at))"
        " FROM auth_sessions s WHERE s.user_id = users.id"
        ") WHERE last_active_at IS NULL"
    )


def downgrade() -> None:
    columns = {c["name"] for c in inspect(op.get_bind()).get_columns("users")}
    for name in ("last_active_at", "last_login_at"):
        if name in columns:
            op.execute(f"ALTER TABLE users DROP COLUMN {name}")
