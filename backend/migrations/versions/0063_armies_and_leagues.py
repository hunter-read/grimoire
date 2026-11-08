"""armies and leagues: the army builder and league tracking for wargames

New tables, nothing altered:

* ``armies`` - a player's army list (the parsed roster as JSON, plus progress)
* ``publication_links`` - a roster's cited publication -> a library book
* ``leagues``, ``league_members``, ``league_games``

References to ``users.id`` carry no ``ON DELETE``, like every other table's:
deleting or merging an account is handled in code. References to systems,
factions, books, leagues and armies do, so a rescan pruning a system or a book
leaves nothing dangling on either database.

Creating tables, so there is nothing to backfill. Idempotent: each table and
index is created only when missing.

Revision ID: 3f6a9d2c8e15
Revises: 8b2f5d1e7c40
Create Date: 2026-11-06 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "3f6a9d2c8e15"
down_revision: Union[str, None] = "8b2f5d1e7c40"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

# Dropped children first, so no table outlives one it references.
_TABLES = ("league_games", "league_members", "leagues", "publication_links", "armies")


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _indexes(table: str) -> set:
    return {i["name"] for i in inspect(op.get_bind()).get_indexes(table)}


def _index(table: str, column: str) -> None:
    name = f"ix_{table}_{column}"
    if name not in _indexes(table):
        op.create_index(name, table, [column], unique=False)


def upgrade() -> None:
    tables = _tables()
    if "armies" not in tables:
        op.create_table(
            "armies",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("game_system_id", sa.String(length=36), nullable=True),
            sa.Column("faction_id", sa.String(length=36), nullable=True),
            sa.Column("system_name", sa.String(length=255), nullable=True),
            sa.Column("points", sa.Integer(), nullable=True),
            sa.Column("points_limit", sa.Integer(), nullable=True),
            sa.Column("cost_name", sa.String(length=40), nullable=True),
            sa.Column("source", sa.String(length=20), nullable=True),
            sa.Column("source_filename", sa.String(length=255), nullable=True),
            sa.Column("data", sa.JSON(), nullable=True),
            sa.Column("progress", sa.JSON(), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.Column("updated_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["game_system_id"], ["game_systems.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["faction_id"], ["factions.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    for column in ("user_id", "game_system_id", "faction_id"):
        _index("armies", column)

    if "publication_links" not in tables:
        op.create_table(
            "publication_links",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("system_name", sa.String(length=255), nullable=False),
            sa.Column("publication", sa.String(length=255), nullable=False),
            sa.Column("book_id", sa.String(length=36), nullable=False),
            sa.Column("page_offset", sa.Integer(), nullable=True),
            sa.Column("created_by", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["book_id"], ["books.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["created_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint(
                "system_name", "publication", name="uq_publication_links_system_pub"
            ),
        )
    _index("publication_links", "book_id")

    if "leagues" not in tables:
        op.create_table(
            "leagues",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=255), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("organizer_id", sa.String(length=36), nullable=False),
            sa.Column("game_system_id", sa.String(length=36), nullable=True),
            sa.Column("points_limit", sa.Integer(), nullable=True),
            sa.Column("points_win", sa.Integer(), nullable=True),
            sa.Column("points_draw", sa.Integer(), nullable=True),
            sa.Column("points_loss", sa.Integer(), nullable=True),
            sa.Column("status", sa.String(length=20), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["organizer_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["game_system_id"], ["game_systems.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
        )
    _index("leagues", "organizer_id")

    if "league_members" not in tables:
        op.create_table(
            "league_members",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("league_id", sa.String(length=36), nullable=False),
            sa.Column("user_id", sa.String(length=36), nullable=False),
            sa.Column("army_id", sa.String(length=36), nullable=True),
            sa.Column("joined_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["league_id"], ["leagues.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["user_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["army_id"], ["armies.id"], ondelete="SET NULL"),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("league_id", "user_id", name="uq_league_members"),
        )
    _index("league_members", "league_id")
    _index("league_members", "user_id")

    if "league_games" not in tables:
        op.create_table(
            "league_games",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("league_id", sa.String(length=36), nullable=False),
            sa.Column("played_on", sa.Date(), nullable=True),
            sa.Column("mission", sa.String(length=255), nullable=True),
            sa.Column("notes", sa.Text(), nullable=True),
            sa.Column("player_a_id", sa.String(length=36), nullable=False),
            sa.Column("army_a_id", sa.String(length=36), nullable=True),
            sa.Column("score_a", sa.Integer(), nullable=True),
            sa.Column("player_b_id", sa.String(length=36), nullable=False),
            sa.Column("army_b_id", sa.String(length=36), nullable=True),
            sa.Column("score_b", sa.Integer(), nullable=True),
            sa.Column("result", sa.String(length=10), nullable=False),
            sa.Column("recorded_by", sa.String(length=36), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["league_id"], ["leagues.id"], ondelete="CASCADE"),
            sa.ForeignKeyConstraint(["player_a_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["player_b_id"], ["users.id"]),
            sa.ForeignKeyConstraint(["army_a_id"], ["armies.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["army_b_id"], ["armies.id"], ondelete="SET NULL"),
            sa.ForeignKeyConstraint(["recorded_by"], ["users.id"]),
            sa.PrimaryKeyConstraint("id"),
        )
    _index("league_games", "league_id")


def downgrade() -> None:
    tables = _tables()
    for table in _TABLES:
        if table in tables:
            op.drop_table(table)
