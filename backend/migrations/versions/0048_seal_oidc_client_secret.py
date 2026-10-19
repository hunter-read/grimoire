"""seal the OIDC client secret: store it encrypted under SECRET_KEY

The client secret entered in Settings > Authentication sat in ``app_settings``
as plaintext, so every database backup (which holds ``grimoire.db`` but not
``secret_key``) carried it. It is now sealed with ``token_vault.seal_secret``
and only unsealed when the callback presents it to the identity provider.

As in 0047, the old value survives in free pages until a VACUUM, so a
conversion sets ``db_compact_pending`` and runs with ``secure_delete`` on.

Revision ID: 7a2f9d4c1e85
Revises: 5e1b8c3a7d42
Create Date: 2026-10-18 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
from sqlalchemy import text


# revision identifiers, used by Alembic.
revision: str = "7a2f9d4c1e85"
down_revision: Union[str, None] = "5e1b8c3a7d42"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_KEY = "oidc_client_secret"


def _stored(bind) -> str:
    return bind.execute(
        text("SELECT value FROM app_settings WHERE key = :k"), {"k": _KEY}
    ).scalar() or ""


def upgrade() -> None:
    from backend import token_vault

    bind = op.get_bind()
    value = _stored(bind)
    # Already sealed (a re-run, or saved by a newer build): leave it.
    if not value or token_vault.unseal_secret(value) is not None:
        return
    previous = bind.execute(text("PRAGMA secure_delete")).scalar()
    op.execute("PRAGMA secure_delete = ON")
    try:
        bind.execute(
            text("UPDATE app_settings SET value = :v WHERE key = :k"),
            {"v": token_vault.seal_secret(value), "k": _KEY},
        )
        bind.execute(
            text("INSERT OR REPLACE INTO app_settings (key, value) VALUES (:k, '1')"),
            {"k": "db_compact_pending"},
        )
    finally:
        op.execute(f"PRAGMA secure_delete = {int(previous or 0)}")


def downgrade() -> None:
    from backend import token_vault

    bind = op.get_bind()
    secret = token_vault.unseal_secret(_stored(bind))
    if secret is not None:
        bind.execute(
            text("UPDATE app_settings SET value = :v WHERE key = :k"),
            {"v": secret, "k": _KEY},
        )
