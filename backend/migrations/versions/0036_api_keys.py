"""api keys: personal, hashed keys with per-area permissions

Adds the ``api_keys`` table (issue #489), replacing the single plaintext
``stats_api_key`` row in ``app_settings``. Every key belongs to a user and acts
as them. Also adds ``users.api_keys_enabled``, the per-user switch for holding
keys: off for everyone (admins may regardless).

An existing stats key is carried over rather than dropped, so Homepage widgets
keep working without being reconfigured: its SHA-256 hash is stored (the
plaintext is gone after this runs), it is named "Stats API key (migrated)",
owned by the earliest-created admin, and granted ``stats: read`` and nothing
else - exactly what it could reach before. With no admin to own it (only
possible on a database that never finished setup) it is dropped. Legacy keys
lack the ``grim_`` prefix, which is fine: lookup hashes the whole presented key
and never relies on the prefix.

Idempotent: the table create is guarded, and the settings row is deleted in the
same transaction that inserts its replacement.

Revision ID: c4e8a2f6d913
Revises: a3f5c7e9b1d2
Create Date: 2026-09-23 00:00:00.000000+00:00

"""
import datetime
import hashlib
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c4e8a2f6d913"
down_revision: Union[str, None] = "a3f5c7e9b1d2"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Shown in the key list; only as much of the old key as identifies it. Legacy
# keys could be set to any value through PATCH /api/settings, so a short one is
# possible and a longer prefix could give most of it away.
_LEGACY_PREFIX_LEN = 4


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("api_keys"):
        op.create_table(
            "api_keys",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=100), nullable=False),
            sa.Column("prefix", sa.String(length=16), nullable=False),
            sa.Column("key_hash", sa.String(length=64), nullable=False),
            sa.Column("permissions", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("last_used_at", sa.DateTime(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_api_keys_key_hash", "api_keys", ["key_hash"], unique=True)
        op.create_index("ix_api_keys_user_id", "api_keys", ["user_id"])

    if "api_keys_enabled" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column(
            "users",
            sa.Column(
                "api_keys_enabled", sa.Boolean(), nullable=True, server_default=sa.text("0")
            ),
        )

    if not insp.has_table("app_settings"):
        return
    row = bind.execute(
        sa.text("SELECT value FROM app_settings WHERE key = 'stats_api_key'")
    ).first()
    legacy = (row[0] or "").strip() if row else ""
    owner = bind.execute(
        sa.text("SELECT id FROM users WHERE role = 'admin' ORDER BY created_at, id LIMIT 1")
    ).first()
    if legacy and owner:
        key_hash = hashlib.sha256(legacy.encode("utf-8")).hexdigest()
        exists = bind.execute(
            sa.text("SELECT 1 FROM api_keys WHERE key_hash = :h"), {"h": key_hash}
        ).first()
        if not exists:
            bind.execute(
                sa.text(
                    "INSERT INTO api_keys "
                    "(id, user_id, name, prefix, key_hash, permissions, created_at) "
                    "VALUES (:id, :owner, :name, :prefix, :hash, :perms, :created)"
                ),
                {
                    "id": str(uuid.uuid4()),
                    "owner": owner[0],
                    "name": "Stats API key (migrated)",
                    "prefix": legacy[:_LEGACY_PREFIX_LEN],
                    "hash": key_hash,
                    "perms": json.dumps({"stats": "read"}),
                    "created": datetime.datetime.now(datetime.timezone.utc),
                },
            )
    if row is not None:
        bind.execute(sa.text("DELETE FROM app_settings WHERE key = 'stats_api_key'"))


def downgrade() -> None:
    # The plaintext of a migrated key is unrecoverable, so there is nothing to
    # restore into app_settings; downgrading drops the keys.
    insp = inspect(op.get_bind())
    if "api_keys_enabled" in {c["name"] for c in insp.get_columns("users")}:
        op.drop_column("users", "api_keys_enabled")
    if insp.has_table("api_keys"):
        op.drop_index("ix_api_keys_user_id", table_name="api_keys")
        op.drop_index("ix_api_keys_key_hash", table_name="api_keys")
        op.drop_table("api_keys")
