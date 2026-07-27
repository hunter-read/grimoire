"""parent_system/edition + license & dice/material lookups

Adds:
  * game_systems.parent_system, game_systems.edition
  * books.license (per-book override of the system license)
  * parent_systems, licenses, dice_materials lookup tables (seeded)

All operations are idempotent so partial/retried runs are safe.

Revision ID: 873d3303ba93
Revises: 96927e7cb35e
Create Date: 2026-07-26 00:00:00.000000+00:00

"""
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

from backend.models.lookup_defaults import (
    DEFAULT_DICE_MATERIALS,
    DEFAULT_LICENSES,
    DEFAULT_PARENT_SYSTEMS,
)


# revision identifiers, used by Alembic.
revision: str = "873d3303ba93"
down_revision: Union[str, None] = "96927e7cb35e"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _add(table: str, column: sa.Column) -> None:
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    # --- new columns ---
    _add(
        "game_systems",
        sa.Column("parent_system", sa.String(length=150), nullable=True, server_default=""),
    )
    _add(
        "game_systems",
        sa.Column("edition", sa.String(length=80), nullable=True, server_default=""),
    )
    _add(
        "books",
        sa.Column("license", sa.String(length=100), nullable=True, server_default=""),
    )

    tables = _tables()
    for name in ("parent_systems", "licenses"):
        if name not in tables:
            op.create_table(
                name,
                sa.Column("id", sa.String(length=36), nullable=False),
                sa.Column("name", sa.String(length=150), nullable=False),
                sa.Column("is_default", sa.Boolean(), nullable=True),
                sa.Column("sort_order", sa.Integer(), nullable=True),
                sa.PrimaryKeyConstraint("id"),
                sa.UniqueConstraint("name"),
            )
    if "dice_materials" not in tables:
        op.create_table(
            "dice_materials",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("group", sa.String(length=60), nullable=True, server_default="Custom"),
            sa.Column("is_default", sa.Boolean(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )

    _seed_lookups()


def _seed_named(bind, table: str, names: Sequence[str]) -> None:
    """Seed a simple (id, name, is_default, sort_order) lookup, skipping dupes."""
    existing = {
        row[0] for row in bind.execute(sa.text(f"SELECT name FROM {table}")).fetchall()
    }
    for idx, name in enumerate(names):
        if name in existing:
            continue
        bind.execute(
            sa.text(
                f"INSERT INTO {table} (id, name, is_default, sort_order) "
                "VALUES (:id, :name, 1, :sort_order)"
            ),
            {"id": str(uuid.uuid4()), "name": name, "sort_order": idx},
        )


def _seed_lookups() -> None:
    bind = op.get_bind()
    _seed_named(bind, "parent_systems", DEFAULT_PARENT_SYSTEMS)
    _seed_named(bind, "licenses", DEFAULT_LICENSES)

    existing_dice = {
        row[0] for row in bind.execute(sa.text("SELECT name FROM dice_materials")).fetchall()
    }
    for idx, (group, name) in enumerate(DEFAULT_DICE_MATERIALS):
        if name in existing_dice:
            continue
        bind.execute(
            sa.text(
                'INSERT INTO dice_materials (id, name, "group", is_default, sort_order) '
                "VALUES (:id, :name, :group, 1, :sort_order)"
            ),
            {"id": str(uuid.uuid4()), "name": name, "group": group, "sort_order": idx},
        )


def downgrade() -> None:
    tables = _tables()
    for name in ("dice_materials", "licenses", "parent_systems"):
        if name in tables:
            op.drop_table(name)
    if "license" in _columns("books"):
        op.drop_column("books", "license")
    for col in ("parent_system", "edition"):
        if col in _columns("game_systems"):
            op.drop_column("game_systems", col)
