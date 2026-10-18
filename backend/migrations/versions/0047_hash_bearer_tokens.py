"""hash bearer tokens: store OPDS, calendar and share-link tokens hashed and sealed

The OPDS feed, calendar feed and share-link tokens were stored in plaintext, so a
leaked database (a downloaded backup holds ``grimoire.db`` but not ``secret_key``)
yielded working feeds and links (issue #583). Each token now becomes:

* ``<name>_hash`` - HMAC-SHA256 under a key derived from SECRET_KEY, which requests
  are matched on, and
* ``<name>_sealed`` - the token encrypted under another SECRET_KEY-derived key, so
  its owner can still copy the URL (see backend/token_vault.py).

Existing tokens are converted in place, so every feed URL and share link already
handed out keeps working. The plaintext columns and their indexes are dropped.

Replacing a value in place does not erase it from the file: old row images stay
in unused page space, free pages and WAL frames. So once any token was converted
this sets ``db_compact_pending``, and startup VACUUMs the database once
(``_compact_if_pending`` in backend/models/db.py). ``secure_delete`` is on for
the conversion as well, to clear what it can before then. Backups are written
with VACUUM INTO and carry only live rows either way.

``share_links.token_hash``/``token_sealed`` are added nullable: SQLite cannot add
a NOT NULL column to a populated table without a default. The model requires
both on every insert.

Revision ID: 5e1b8c3a7d42
Revises: 9c4d2e7a1f30
Create Date: 2026-10-17 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "5e1b8c3a7d42"
down_revision: Union[str, None] = "9c4d2e7a1f30"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# (table, old plaintext column, new column prefix)
_TOKENS = (
    ("users", "opds_token", "opds_token"),
    ("users", "calendar_token", "calendar_token"),
    ("share_links", "token", "token"),
)


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    from backend import token_vault

    bind = op.get_bind()
    previous = bind.execute(text("PRAGMA secure_delete")).scalar()
    op.execute("PRAGMA secure_delete = ON")
    try:
        _convert(bind, token_vault)
    finally:
        op.execute(f"PRAGMA secure_delete = {int(previous or 0)}")


def _convert(bind, token_vault) -> None:
    converted = 0
    for table, old, new in _TOKENS:
        cols = _columns(table)
        if f"{new}_hash" not in cols:
            op.add_column(table, sa.Column(f"{new}_hash", sa.String(length=64), nullable=True))
        if f"{new}_sealed" not in cols:
            op.add_column(table, sa.Column(f"{new}_sealed", sa.Text(), nullable=True))

        if old in cols:
            rows = bind.execute(
                text(f"SELECT id, {old} FROM {table} WHERE {old} IS NOT NULL AND {old} != ''")
            ).fetchall()
            for row_id, token in rows:
                bind.execute(
                    text(f"UPDATE {table} SET {new}_hash = :h, {new}_sealed = :s WHERE id = :id"),
                    {"h": token_vault.lookup_hash(token), "s": token_vault.seal(token), "id": row_id},
                )
            converted += len(rows)
            if f"ix_{table}_{old}" in _indexes(table):
                op.drop_index(f"ix_{table}_{old}", table_name=table)
            op.execute(f"ALTER TABLE {table} DROP COLUMN {old}")

        index = f"ix_{table}_{new}_hash"
        if index not in _indexes(table):
            op.create_index(index, table, [f"{new}_hash"], unique=True)

    if converted:
        bind.execute(
            text("INSERT OR REPLACE INTO app_settings (key, value) VALUES (:k, '1')"),
            {"k": "db_compact_pending"},
        )


def downgrade() -> None:
    from backend import token_vault

    bind = op.get_bind()
    for table, old, new in _TOKENS:
        cols = _columns(table)
        if old not in cols:
            op.add_column(table, sa.Column(old, sa.String(length=64), nullable=True))
        if f"{new}_sealed" in cols:
            rows = bind.execute(
                text(f"SELECT id, {new}_sealed FROM {table} WHERE {new}_sealed IS NOT NULL")
            ).fetchall()
            for row_id, sealed in rows:
                # A token sealed under a different SECRET_KEY is unrecoverable;
                # such a row goes back without one, as if never issued.
                token = token_vault.unseal(sealed)
                if token is not None:
                    bind.execute(
                        text(f"UPDATE {table} SET {old} = :t WHERE id = :id"),
                        {"t": token, "id": row_id},
                    )
        if table == "share_links":
            # The plaintext column was NOT NULL; a link that could not be
            # recovered cannot be served by the older code either.
            bind.execute(text("DELETE FROM share_links WHERE token IS NULL"))
        index = f"ix_{table}_{new}_hash"
        if index in _indexes(table):
            op.drop_index(index, table_name=table)
        for column in (f"{new}_hash", f"{new}_sealed"):
            if column in _columns(table):
                op.execute(f"ALTER TABLE {table} DROP COLUMN {column}")
        index = f"ix_{table}_{old}"
        if index not in _indexes(table):
            op.create_index(index, table, [old], unique=True)
