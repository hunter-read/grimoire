"""users.username_folded: the folded username sign-in matches on

Sign-in compares usernames with NFKC + full Unicode case folding. That used to
run in SQL through ``grimoire_fold``, a Python function registered on every
SQLite connection, which PostgreSQL does not have - and neither database's own
``lower()`` folds the same way ("Straße" / "STRASSE"). The folded name is now
stored per account and indexed, so the match is a plain equality on either
database. The model keeps it in step when a username is set.

Backfilled in Python for every existing account. Idempotent.

Revision ID: 521c4f179a46
Revises: 6e92be54a9d4
Create Date: 2026-11-06 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

from backend.migrations._frozen.username_fold import fold_text


revision: str = "521c4f179a46"
down_revision: Union[str, None] = "6e92be54a9d4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

INDEX = "ix_users_username_folded"


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    if "username_folded" not in {c["name"] for c in insp.get_columns("users")}:
        op.add_column("users", sa.Column("username_folded", sa.String(400), nullable=True))
    if INDEX not in {i["name"] for i in insp.get_indexes("users")}:
        op.create_index(INDEX, "users", ["username_folded"])
    for user_id, username in bind.execute(text("SELECT id, username FROM users")).fetchall():
        bind.execute(
            text("UPDATE users SET username_folded = :f WHERE id = :id"),
            {"f": fold_text(username), "id": user_id},
        )


def downgrade() -> None:
    insp = inspect(op.get_bind())
    if INDEX in {i["name"] for i in insp.get_indexes("users")}:
        op.drop_index(INDEX, table_name="users")
    if "username_folded" in {c["name"] for c in insp.get_columns("users")}:
        with op.batch_alter_table("users") as batch:
            batch.drop_column("username_folded")
