"""league guests and books: invite guests to a league, and share books with it

* ``users.guest_scope`` - which side of the app a guest belongs to: ``ttrpg``
  (a campaign's guest) or ``wargame`` (a league's). Every guest made before
  this is a campaign's, so existing guests are set to ``ttrpg``.
* ``users.guest_code_hash`` / ``users.guest_code_sealed`` - a league guest's
  sign-in code, stored like a campaign guest's (0057) but on the account, so it
  outlives the league. Nothing to convert: no league has had guests.
* ``league_members.is_guest``.
* ``league_resources`` and ``league_resource_shares`` - books the organiser
  shares with a league, and the members a private one is shared with. Their
  references to leagues and resources cascade; references to users carry no
  ``ON DELETE``, like every other table's.

Idempotent: each column, table and index is added only when missing.

Revision ID: 4c8d2e6f1a93
Revises: 9a4e7b2c6d31
Create Date: 2026-11-09 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "4c8d2e6f1a93"
down_revision: Union[str, None] = "9a4e7b2c6d31"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_CODE_INDEX = "ix_users_guest_code_hash"


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _index(table: str, column: str) -> None:
    name = f"ix_{table}_{column}"
    if name not in _indexes(table):
        op.create_index(name, table, [column], unique=False)


def upgrade() -> None:
    cols = _columns("users")
    if "guest_scope" not in cols:
        op.add_column("users", sa.Column("guest_scope", sa.String(length=10), nullable=True))
    if "guest_code_hash" not in cols:
        op.add_column("users", sa.Column("guest_code_hash", sa.String(length=64), nullable=True))
    if "guest_code_sealed" not in cols:
        op.add_column("users", sa.Column("guest_code_sealed", sa.Text(), nullable=True))
    if _CODE_INDEX not in _indexes("users"):
        op.create_index(_CODE_INDEX, "users", ["guest_code_hash"], unique=True)
    op.execute("UPDATE users SET guest_scope = 'ttrpg' WHERE is_guest IS TRUE AND guest_scope IS NULL")

    if "is_guest" not in _columns("league_members"):
        op.add_column(
            "league_members",
            sa.Column("is_guest", sa.Boolean(), nullable=True, server_default=sa.false()),
        )

    tables = _tables()
    if "league_resources" not in tables:
        op.create_table(
            "league_resources",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("league_id", sa.String(length=36), nullable=False),
            sa.Column("resource_type", sa.String(length=20), nullable=False),
            sa.Column("resource_id", sa.String(length=36), nullable=False),
            sa.Column("visibility", sa.String(length=20), nullable=False),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["league_id"], ["leagues.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "league_id", "resource_type", "resource_id", name="uq_league_resources"
            ),
        )
    for column in ("league_id", "resource_id"):
        _index("league_resources", column)

    if "league_resource_shares" not in tables:
        op.create_table(
            "league_resource_shares",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("resource_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.ForeignKeyConstraint(
                ["resource_id"], ["league_resources.id"], ondelete="CASCADE"
            ),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("resource_id", "user_id", name="uq_league_resource_shares"),
        )
    for column in ("resource_id", "user_id"):
        _index("league_resource_shares", column)


def downgrade() -> None:
    tables = _tables()
    for table in ("league_resource_shares", "league_resources"):
        if table in tables:
            op.drop_table(table)
    if "is_guest" in _columns("league_members"):
        op.execute("ALTER TABLE league_members DROP COLUMN is_guest")
    if _CODE_INDEX in _indexes("users"):
        op.drop_index(_CODE_INDEX, table_name="users")
    for column in ("guest_code_hash", "guest_code_sealed", "guest_scope"):
        if column in _columns("users"):
            op.execute(f"ALTER TABLE users DROP COLUMN {column}")
