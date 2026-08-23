"""book/system access levels and per-user access grants (#258)

Adds the storage behind hierarchical book restrictions: an ``access_level``
column on ``books`` and ``game_systems``, and the ``user_access_grants`` table
that lets an admin hand one user access to a restricted system or book without
lowering the restriction for anyone else.

Existing rows are left fully open — ``books.access_level`` defaults to NULL
("inherit", and with no system or category restriction to inherit that resolves
to open) and ``game_systems.access_level`` to ``''``. An upgraded library
therefore behaves exactly as it did until an admin restricts something, which is
the documented default for this feature.

Revision ID: b6e4f80a3d19
Revises: a1c37e4d9f28
Create Date: 2026-08-23 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "b6e4f80a3d19"
down_revision: Union[str, None] = "a1c37e4d9f28"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    insp = inspect(op.get_bind())
    tables = set(insp.get_table_names())

    if "books" in tables:
        cols = {c["name"] for c in insp.get_columns("books")}
        if "access_level" not in cols:
            # Nullable with no server default: NULL is the "inherit" state, and
            # every pre-existing book must land there rather than on an explicit
            # level, so a later system/category restriction actually applies to
            # them.
            op.add_column("books", sa.Column("access_level", sa.String(length=10), nullable=True))
        indexes = {i["name"] for i in insp.get_indexes("books")}
        if "ix_books_access_level" not in indexes:
            op.create_index("ix_books_access_level", "books", ["access_level"])

    if "game_systems" in tables:
        cols = {c["name"] for c in insp.get_columns("game_systems")}
        if "access_level" not in cols:
            op.add_column(
                "game_systems",
                sa.Column("access_level", sa.String(length=10), nullable=True, server_default=""),
            )

    if "user_access_grants" not in tables:
        op.create_table(
            "user_access_grants",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column(
                "user_id",
                sa.String(length=36),
                sa.ForeignKey("users.id"),
                nullable=False,
            ),
            sa.Column("scope_type", sa.String(length=10), nullable=False),
            sa.Column("scope_id", sa.String(length=36), nullable=False),
            sa.Column("level", sa.String(length=10), nullable=False, server_default="gm"),
            sa.UniqueConstraint(
                "user_id", "scope_type", "scope_id", name="uq_user_access_grants_scope"
            ),
        )
        op.create_index("ix_user_access_grants_user_id", "user_access_grants", ["user_id"])
        op.create_index("ix_user_access_grants_scope_id", "user_access_grants", ["scope_id"])


def downgrade() -> None:
    op.drop_table("user_access_grants")
    op.drop_index("ix_books_access_level", table_name="books")
    op.drop_column("game_systems", "access_level")
    op.drop_column("books", "access_level")
