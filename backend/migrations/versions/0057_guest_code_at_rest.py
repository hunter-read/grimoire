"""guest codes: store them hashed and sealed, and drop campaigns.guest_invites_enabled

A guest's invite code is its login, and it was the one bearer credential still
kept as itself. It is now stored the way 0047 stores the OPDS, calendar and
share-link tokens:

* ``guest_code_hash`` - HMAC-SHA256 under a key derived from SECRET_KEY, which
  guest sign-ins are matched on, and
* ``guest_code_sealed`` - the code encrypted under another SECRET_KEY-derived
  key, so the GM can still copy and share it.

Existing codes are converted in place, so every invite already handed out keeps
working, and the plaintext column and its index are dropped. As in 0047, a
conversion sets ``db_compact_pending`` so startup VACUUMs the old row images out
of the file, with ``secure_delete`` on for the conversion itself.

``campaigns.guest_invites_enabled`` is dropped too: it was set on a campaign's
first guest and nothing ever read it. Guest access is switched on and off for
the whole server.

Revision ID: e50b2a525948
Revises: 5d1e8a3c7b20
Create Date: 2026-10-26 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

from backend.migrations._frozen import token_vault


# revision identifiers, used by Alembic.
revision: str = "e50b2a525948"
down_revision: Union[str, None] = "5d1e8a3c7b20"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_TABLE = "campaign_members"
_OLD_INDEX = "ix_campaign_members_guest_code"
_NEW_INDEX = "ix_campaign_members_guest_code_hash"


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def upgrade() -> None:
    bind = op.get_bind()
    previous = bind.execute(text("PRAGMA secure_delete")).scalar()
    op.execute("PRAGMA secure_delete = ON")
    try:
        _convert(bind, token_vault.secret_key())
    finally:
        op.execute(f"PRAGMA secure_delete = {int(previous or 0)}")
    if "guest_invites_enabled" in _columns("campaigns"):
        op.execute("ALTER TABLE campaigns DROP COLUMN guest_invites_enabled")


def _convert(bind, secret: str) -> None:
    cols = _columns(_TABLE)
    if "guest_code_hash" not in cols:
        op.add_column(_TABLE, sa.Column("guest_code_hash", sa.String(length=64), nullable=True))
    if "guest_code_sealed" not in cols:
        op.add_column(_TABLE, sa.Column("guest_code_sealed", sa.Text(), nullable=True))

    if "guest_code" in cols:
        rows = bind.execute(
            text(
                f"SELECT id, guest_code FROM {_TABLE} "
                "WHERE guest_code IS NOT NULL AND guest_code != ''"
            )
        ).fetchall()
        for row_id, code in rows:
            bind.execute(
                text(
                    f"UPDATE {_TABLE} SET guest_code_hash = :h, guest_code_sealed = :s "
                    "WHERE id = :id"
                ),
                {
                    "h": token_vault.lookup_hash(secret, code),
                    "s": token_vault.seal(secret, code),
                    "id": row_id,
                },
            )
        if _OLD_INDEX in _indexes(_TABLE):
            op.drop_index(_OLD_INDEX, table_name=_TABLE)
        op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN guest_code")
        if rows:
            bind.execute(
                text("INSERT OR REPLACE INTO app_settings (key, value) VALUES (:k, '1')"),
                {"k": "db_compact_pending"},
            )

    if _NEW_INDEX not in _indexes(_TABLE):
        op.create_index(_NEW_INDEX, _TABLE, ["guest_code_hash"], unique=True)


def downgrade() -> None:
    secret = token_vault.secret_key()
    bind = op.get_bind()
    if "guest_invites_enabled" not in _columns("campaigns"):
        op.add_column("campaigns", sa.Column("guest_invites_enabled", sa.Boolean(), nullable=True))
        # What the old code would have left: on for any campaign with a guest.
        bind.execute(
            text(
                "UPDATE campaigns SET guest_invites_enabled = EXISTS ("
                f"SELECT 1 FROM {_TABLE} m WHERE m.campaign_id = campaigns.id AND m.is_guest = 1)"
            )
        )
    cols = _columns(_TABLE)
    if "guest_code" not in cols:
        op.add_column(_TABLE, sa.Column("guest_code", sa.String(length=10), nullable=True))
    if "guest_code_sealed" in cols:
        rows = bind.execute(
            text(f"SELECT id, guest_code_sealed FROM {_TABLE} WHERE guest_code_sealed IS NOT NULL")
        ).fetchall()
        for row_id, sealed in rows:
            # A code sealed under a different SECRET_KEY is unrecoverable; that
            # guest goes back without one, and the GM can regenerate it.
            code = token_vault.unseal(secret, sealed)
            if code is not None:
                bind.execute(
                    text(f"UPDATE {_TABLE} SET guest_code = :c WHERE id = :id"),
                    {"c": code, "id": row_id},
                )
    if _NEW_INDEX in _indexes(_TABLE):
        op.drop_index(_NEW_INDEX, table_name=_TABLE)
    for column in ("guest_code_hash", "guest_code_sealed"):
        if column in _columns(_TABLE):
            op.execute(f"ALTER TABLE {_TABLE} DROP COLUMN {column}")
    if _OLD_INDEX not in _indexes(_TABLE):
        op.create_index(_OLD_INDEX, _TABLE, ["guest_code"], unique=False)
