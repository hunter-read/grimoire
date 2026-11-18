"""MCP OAuth: client and authorization tables, and grant columns on api_keys

Adds what OAuth sign-in for /mcp needs (issue #906):

- ``oauth_clients``: clients that registered themselves (dynamic client
  registration), with only a hash of each client secret.
- ``oauth_codes``: one row per authorization request, from ``/authorize``
  through the user's approval to the code exchange.
- On ``api_keys``, the columns of a grant: ``client_id`` marks the row as one,
  and the access and refresh tokens are stored as hashes with their own
  expiry, apart from the key's ``expires_at``.

Additive only: existing keys keep working untouched, and every new column is
empty for them. Idempotent: each table, column and index is created only if
missing.

Revision ID: e3a91c7f5d20
Revises: 9b4e2f7a1c63
Create Date: 2026-11-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "e3a91c7f5d20"
down_revision: Union[str, None] = "9b4e2f7a1c63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (column, type, unique index?) added to api_keys for grants.
_GRANT_COLUMNS = (
    ("client_id", sa.String(length=36), False),
    ("access_token_hash", sa.String(length=64), True),
    ("access_expires_at", sa.DateTime(), None),
    ("refresh_token_hash", sa.String(length=64), True),
    ("prev_refresh_hash", sa.String(length=64), True),
    ("prev_refresh_until", sa.DateTime(), None),
    ("refresh_expires_at", sa.DateTime(), None),
)


def _indexes(insp, table: str) -> set[str]:
    return {ix["name"] for ix in insp.get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)

    if not insp.has_table("oauth_clients"):
        op.create_table(
            "oauth_clients",
            sa.Column("client_id", sa.String(length=36), nullable=False),
            sa.Column("client_name", sa.String(length=200), nullable=True),
            sa.Column("info", sa.JSON(), nullable=False),
            sa.Column("client_secret_hash", sa.String(length=64), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.PrimaryKeyConstraint("client_id"),
        )
        op.create_index("ix_oauth_clients_created_at", "oauth_clients", ["created_at"])

    if not insp.has_table("oauth_codes"):
        op.create_table(
            "oauth_codes",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("client_id", sa.String(length=36), nullable=False),
            sa.Column("request_hash", sa.String(length=64), nullable=False),
            sa.Column("code_hash", sa.String(length=64), nullable=True),
            sa.Column("user_id", sa.String(length=36), nullable=True),
            sa.Column("params", sa.JSON(), nullable=False),
            sa.Column("permissions", sa.JSON(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("expires_at", sa.DateTime(), nullable=False),
            sa.Column("used_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["client_id"], ["oauth_clients.client_id"]),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
        op.create_index("ix_oauth_codes_client_id", "oauth_codes", ["client_id"])
        op.create_index("ix_oauth_codes_request_hash", "oauth_codes", ["request_hash"], unique=True)
        op.create_index("ix_oauth_codes_code_hash", "oauth_codes", ["code_hash"], unique=True)
        op.create_index("ix_oauth_codes_user_id", "oauth_codes", ["user_id"])
        op.create_index("ix_oauth_codes_expires_at", "oauth_codes", ["expires_at"])

    if not insp.has_table("api_keys"):
        return
    existing = {c["name"] for c in insp.get_columns("api_keys")}
    for name, type_, _unique in _GRANT_COLUMNS:
        if name not in existing:
            op.add_column("api_keys", sa.Column(name, type_, nullable=True))
    have = _indexes(inspect(bind), "api_keys")
    for name, _type, unique in _GRANT_COLUMNS:
        index = f"ix_api_keys_{name}"
        if unique is not None and index not in have:
            op.create_index(index, "api_keys", [name], unique=unique)


def downgrade() -> None:
    # Dropping the grant columns signs every OAuth client out; their rows would
    # otherwise remain as keys nobody holds, so they go too.
    bind = op.get_bind()
    insp = inspect(bind)
    if insp.has_table("api_keys"):
        existing = {c["name"] for c in insp.get_columns("api_keys")}
        if "client_id" in existing:
            bind.execute(sa.text("DELETE FROM api_keys WHERE client_id IS NOT NULL"))
        have = _indexes(insp, "api_keys")
        with op.batch_alter_table("api_keys") as batch:
            for name, _type, unique in _GRANT_COLUMNS:
                if unique is not None and f"ix_api_keys_{name}" in have:
                    batch.drop_index(f"ix_api_keys_{name}")
            for name, _type, _unique in _GRANT_COLUMNS:
                if name in existing:
                    batch.drop_column(name)
    if insp.has_table("oauth_codes"):
        op.drop_table("oauth_codes")
    if insp.has_table("oauth_clients"):
        op.drop_table("oauth_clients")
