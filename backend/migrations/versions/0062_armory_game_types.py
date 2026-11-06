"""armory: wargame systems and books, and their factions

Wargame books live in the library's ``armory/`` folder beside ``books/``. This
adds what the scan needs to keep the two apart:

* ``game_type`` on ``game_systems`` and ``books`` ("ttrpg" or "wargame").
  Every existing row is a role-playing one, so the server default backfills it.
* ``game_systems.name`` and ``.slug`` become unique per game type rather than
  globally, so BattleTech the RPG and BattleTech the wargame can both exist
  under their own name. SQLite cannot drop a UNIQUE constraint in place, so
  there this is a batch (copy-and-move) rebuild of ``game_systems``, run with
  foreign keys off (``models/db.py``) because ``books`` references the table.
  The baseline's constraints are unnamed on SQLite; the naming convention gives
  batch mode names to drop them by. PostgreSQL drops them by their reflected
  names in place.
* ``factions`` and the ``book_factions`` link table.

Idempotent: each step checks before it acts.

Revision ID: 8b2f5d1e7c40
Revises: 4d7e1c9b2a63
Create Date: 2026-11-06 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "8b2f5d1e7c40"
down_revision: Union[str, None] = "4d7e1c9b2a63"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Names batch mode gives the unnamed single-column UNIQUE constraints of the
# baseline schema on SQLite, so they can be dropped.
_NAMING = {"uq": "uq_%(table_name)s_%(column_0_name)s"}


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _uniques(table: str) -> dict:
    """``{column tuple: constraint name}`` for ``table``'s UNIQUE constraints."""
    return {
        tuple(u["column_names"]): u["name"]
        for u in inspect(op.get_bind()).get_unique_constraints(table)
    }


def _game_type_column() -> sa.Column:
    return sa.Column("game_type", sa.String(length=10), nullable=False, server_default="ttrpg")


def _swap_uniques(drop: tuple, create: tuple) -> None:
    """Replace ``game_systems``' unique constraints on ``drop`` columns with ``create``.

    Each is a tuple of column tuples. Names come from reflection, falling back
    to the naming convention for SQLite's unnamed baseline constraints.
    """
    uniques = _uniques("game_systems")
    stale = [cols for cols in drop if cols in uniques]
    missing = [cols for cols in create if cols not in uniques]
    if not stale and not missing:
        return
    op.execute('DROP TABLE IF EXISTS "_alembic_tmp_game_systems"')
    with op.batch_alter_table("game_systems", naming_convention=_NAMING) as batch:
        for cols in stale:
            batch.drop_constraint(
                uniques[cols] or "uq_game_systems_" + cols[0], type_="unique"
            )
        for cols in missing:
            batch.create_unique_constraint("uq_game_systems_" + "_".join(cols), list(cols))


def upgrade() -> None:
    if "game_type" not in _columns("books"):
        op.add_column("books", _game_type_column())
    if "ix_books_game_type" not in _indexes("books"):
        op.create_index("ix_books_game_type", "books", ["game_type"], unique=False)

    if "game_type" not in _columns("game_systems"):
        op.add_column("game_systems", _game_type_column())
    _swap_uniques(
        drop=(("name",), ("slug",)),
        create=(("game_type", "name"), ("game_type", "slug")),
    )

    tables = _tables()
    if "factions" not in tables:
        op.create_table(
            "factions",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("game_system_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("slug", sa.String(length=500), nullable=False),
            sa.Column("parent_id", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["game_system_id"], ["game_systems.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["parent_id"], ["factions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("game_system_id", "slug", name="uq_factions_system_slug"),
        )
        op.create_index("ix_factions_game_system_id", "factions", ["game_system_id"])
        op.create_index("ix_factions_parent_id", "factions", ["parent_id"])
    if "book_factions" not in tables:
        op.create_table(
            "book_factions",
            sa.Column("book_id", sa.String(length=36), nullable=False),
            sa.Column("faction_id", sa.String(length=36), nullable=False),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["faction_id"], ["factions.id"], ondelete="CASCADE"),
            sa.PrimaryKeyConstraint("book_id", "faction_id"),
        )
        op.create_index("ix_book_factions_faction_id", "book_factions", ["faction_id"])


def downgrade() -> None:
    tables = _tables()
    if "book_factions" in tables:
        op.drop_table("book_factions")
    if "factions" in tables:
        op.drop_table("factions")

    # Global uniqueness is coming back, and a wargame system may share its name
    # and slug with a role-playing one. Rename rather than delete, so its books,
    # tags and favourites survive the round trip.
    if "game_type" in _columns("game_systems"):
        op.get_bind().execute(
            sa.text(
                "UPDATE game_systems SET name = name || ' (Wargame)', "
                "slug = 'armory--' || slug WHERE game_type = 'wargame'"
            )
        )
    _swap_uniques(
        drop=(("game_type", "name"), ("game_type", "slug")),
        create=(("name",), ("slug",)),
    )
    if "game_type" in _columns("game_systems"):
        with op.batch_alter_table("game_systems") as batch:
            batch.drop_column("game_type")

    if "ix_books_game_type" in _indexes("books"):
        op.drop_index("ix_books_game_type", table_name="books")
    if "game_type" in _columns("books"):
        with op.batch_alter_table("books") as batch:
            batch.drop_column("game_type")
