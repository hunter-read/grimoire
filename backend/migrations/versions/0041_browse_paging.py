"""browse paging: natural sort keys and the indexes paged browsing reads

Issue #221. The browse views now page, sort, group and filter on the server
instead of downloading a whole collection, so the queries behind them need:

* ``sort_name`` on every media table and ``sort_title`` on books - a natural
  sort key ("Map 2" before "Map 10") computed in Python, since SQLite has no
  such collation - and ``folder_path``, the directory part of
  ``relative_path``. Backfilled here; the ORM keeps them current from then on
  (see ``backend/models/browse.py``).
* An index on each item's folder, so grouping by folder and opening one folder
  read an index rather than every row, plus one index per flat-list sort, plus an
  ``(id, variant_parent_id)`` index so a tag's live-link count checks each link
  without fetching the row.
* A covering ``(resource_type, tag_id, resource_id)`` index on resource_tags for
  per-type tag counts and tag filters.

``ANALYZE`` runs at the end. With several indexes leading on
``variant_parent_id`` the planner needs statistics to tell them apart; without
them it can pick the sort index for a folder query and read the whole table.

Idempotent: columns and indexes are only added when missing, and the backfill
only fills rows still missing a value.

Revision ID: 6b1e0c9d4a27
Revises: 1edcfbd4f21c
Create Date: 2026-10-07 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text

from backend.models.browse import folder_path_of, natural_key


# revision identifiers, used by Alembic.
revision: str = "6b1e0c9d4a27"
down_revision: Union[str, None] = "1edcfbd4f21c"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_MEDIA_TABLES = ("generic_maps", "tokens", "audio", "models_3d")
# Tables with an ``is_explicit`` column, which the covering indexes carry.
_EXPLICIT_TABLES = ("tokens", "models_3d")
_BATCH = 2000


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _backfill(table: str, key_column: str, key_source: str) -> None:
    """Fill the natural key (from ``key_source``) and ``folder_path`` where empty."""
    bind = op.get_bind()
    while True:
        rows = bind.execute(
            text(
                f"SELECT id, {key_source}, relative_path FROM {table} "
                f"WHERE {key_column} IS NULL OR folder_path IS NULL LIMIT :n"
            ),
            {"n": _BATCH},
        ).fetchall()
        if not rows:
            return
        bind.execute(
            text(f"UPDATE {table} SET {key_column} = :key, folder_path = :folder WHERE id = :id"),
            [
                {"id": rid, "key": natural_key(value), "folder": folder_path_of(path)}
                for rid, value, path in rows
            ],
        )


def _add_columns(table: str, key_column: str) -> None:
    present = _columns(table)
    if key_column not in present:
        op.add_column(table, sa.Column(key_column, sa.String(600), nullable=True))
    if "folder_path" not in present:
        op.add_column(table, sa.Column("folder_path", sa.String(1000), nullable=True))


def _create(table: str, name: str, columns: str) -> None:
    op.execute(f"CREATE INDEX IF NOT EXISTS {name} ON {table} ({columns})")


def upgrade() -> None:
    for table in _MEDIA_TABLES:
        _add_columns(table, "sort_name")
        _backfill(table, "sort_name", "filename")
        # Covering for the per-row filters - see _browse_indexes in models/media.py.
        covered = "filename, id" + (", is_explicit" if table in _EXPLICIT_TABLES else "")
        _create(
            table,
            f"ix_{table}_browse_folder",
            f"variant_parent_id, folder_path, sort_name, {covered}",
        )
        _create(
            table,
            f"ix_{table}_browse_name",
            f"variant_parent_id, sort_name, folder_path, {covered}",
        )
        _create(table, f"ix_{table}_browse_added", "variant_parent_id, added_at, sort_name")
        _create(table, f"ix_{table}_browse_size", "variant_parent_id, file_size, sort_name")
        _create(table, f"ix_{table}_live", "id, variant_parent_id")

    _add_columns("books", "sort_title")
    _backfill("books", "sort_title", "title")
    _create(
        "books",
        "ix_books_browse_folder",
        "game_system_id, variant_parent_id, category, folder_path, sort_title",
    )
    _create("books", "ix_books_browse_title", "game_system_id, variant_parent_id, sort_title")
    _create("books", "ix_books_live", "id, variant_parent_id")

    _create("resource_tags", "ix_resource_tags_type_tag", "resource_type, tag_id, resource_id")

    op.execute("ANALYZE")


def downgrade() -> None:
    for table in _MEDIA_TABLES:
        for suffix in ("folder", "name", "added", "size"):
            op.execute(f"DROP INDEX IF EXISTS ix_{table}_browse_{suffix}")
        op.execute(f"DROP INDEX IF EXISTS ix_{table}_live")
        for column in ("sort_name", "folder_path"):
            if column in _columns(table):
                op.drop_column(table, column)
    for name in ("ix_books_browse_folder", "ix_books_browse_title", "ix_books_live"):
        op.execute(f"DROP INDEX IF EXISTS {name}")
    for column in ("sort_title", "folder_path"):
        if column in _columns("books"):
            op.drop_column("books", column)
    op.execute("DROP INDEX IF EXISTS ix_resource_tags_type_tag")
