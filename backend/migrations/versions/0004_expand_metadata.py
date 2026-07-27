"""expand system & book metadata; genre/system-family lookups (issue #202)

Additive schema changes only (SQLite-safe — no column drops):

game_systems: genres, dice_materials, system_family, license, year, urls,
    character_builder_urls, is_one_page
books: artists, genres, isbn, version, language, month, day, urls

New lookup tables ``genres`` (tiered via parent_id) and ``system_families``,
seeded with defaults. Backfills the new multi-value columns from the legacy
single-value ones (game_systems.genre / .character_builder_url,
books.publisher_url).

Revision ID: 6be3e9a796c4
Revises: b2e5d3f0c8a1
Create Date: 2026-07-25 00:00:00.000000+00:00

"""
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect

from backend.models.lookup_defaults import DEFAULT_GENRES, DEFAULT_SYSTEM_FAMILIES


# revision identifiers, used by Alembic.
revision: str = "6be3e9a796c4"
down_revision: Union[str, None] = "b2e5d3f0c8a1"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _columns(table: str) -> set:
    return {c["name"] for c in inspect(op.get_bind()).get_columns(table)}


def _tables() -> set:
    return set(inspect(op.get_bind()).get_table_names())


def _add(table: str, column: sa.Column) -> None:
    """Add a column only if it isn't already present (idempotent retries)."""
    if column.name not in _columns(table):
        op.add_column(table, column)


def upgrade() -> None:
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_books")
    op.execute("DROP TABLE IF EXISTS _alembic_tmp_game_systems")

    # --- game_systems columns ---
    _add("game_systems", sa.Column("genres", sa.JSON(), nullable=True))
    _add("game_systems", sa.Column("dice_materials", sa.JSON(), nullable=True))
    _add(
        "game_systems",
        sa.Column("system_family", sa.String(length=150), nullable=True, server_default=""),
    )
    _add(
        "game_systems",
        sa.Column("license", sa.String(length=100), nullable=True, server_default=""),
    )
    _add("game_systems", sa.Column("year", sa.Integer(), nullable=True))
    _add("game_systems", sa.Column("urls", sa.JSON(), nullable=True))
    _add("game_systems", sa.Column("character_builder_urls", sa.JSON(), nullable=True))
    _add(
        "game_systems",
        sa.Column("is_one_page", sa.Boolean(), nullable=True, server_default=sa.text("0")),
    )

    # --- books columns ---
    _add("books", sa.Column("artists", sa.JSON(), nullable=True))
    _add("books", sa.Column("genres", sa.JSON(), nullable=True))
    _add("books", sa.Column("isbn", sa.String(length=20), nullable=True, server_default=""))
    _add("books", sa.Column("version", sa.String(length=50), nullable=True, server_default=""))
    _add("books", sa.Column("language", sa.String(length=20), nullable=True, server_default=""))
    _add("books", sa.Column("month", sa.Integer(), nullable=True))
    _add("books", sa.Column("day", sa.Integer(), nullable=True))
    _add("books", sa.Column("urls", sa.JSON(), nullable=True))

    # --- lookup tables ---
    tables = _tables()
    if "genres" not in tables:
        op.create_table(
            "genres",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=120), nullable=False),
            sa.Column("parent_id", sa.String(length=36), nullable=True),
            sa.Column("is_default", sa.Boolean(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.ForeignKeyConstraint(["parent_id"], ["genres.id"]),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )
        op.create_index("ix_genres_parent_id", "genres", ["parent_id"])
    if "system_families" not in tables:
        op.create_table(
            "system_families",
            sa.Column("id", sa.String(length=36), nullable=False),
            sa.Column("name", sa.String(length=150), nullable=False),
            sa.Column("is_default", sa.Boolean(), nullable=True),
            sa.Column("sort_order", sa.Integer(), nullable=True),
            sa.PrimaryKeyConstraint("id"),
            sa.UniqueConstraint("name"),
        )

    _seed_lookups()
    _backfill()


def _seed_lookups() -> None:
    """Insert default genres/families. Skips names that already exist."""
    bind = op.get_bind()

    existing_genres = {
        row[0] for row in bind.execute(sa.text("SELECT name FROM genres")).fetchall()
    }
    order = 0
    for name, children in DEFAULT_GENRES:
        order += 1
        parent_id = _ensure_genre(bind, existing_genres, name, None, order)
        child_order = 0
        for child_name, _grandchildren in children:
            child_order += 1
            _ensure_genre(bind, existing_genres, child_name, parent_id, child_order)

    existing_families = {
        row[0]
        for row in bind.execute(sa.text("SELECT name FROM system_families")).fetchall()
    }
    for idx, fam in enumerate(DEFAULT_SYSTEM_FAMILIES):
        if fam in existing_families:
            continue
        bind.execute(
            sa.text(
                "INSERT INTO system_families (id, name, is_default, sort_order) "
                "VALUES (:id, :name, 1, :sort_order)"
            ),
            {"id": str(uuid.uuid4()), "name": fam, "sort_order": idx},
        )


def _ensure_genre(bind, existing: set, name: str, parent_id, sort_order: int) -> str:
    """Insert a genre if absent; return its id either way."""
    if name in existing:
        row = bind.execute(
            sa.text("SELECT id FROM genres WHERE name = :name"), {"name": name}
        ).fetchone()
        return row[0]
    new_id = str(uuid.uuid4())
    bind.execute(
        sa.text(
            "INSERT INTO genres (id, name, parent_id, is_default, sort_order) "
            "VALUES (:id, :name, :parent_id, 1, :sort_order)"
        ),
        {"id": new_id, "name": name, "parent_id": parent_id, "sort_order": sort_order},
    )
    existing.add(name)
    return new_id


def _backfill() -> None:
    """Populate new multi-value columns from the legacy single-value ones."""
    bind = op.get_bind()

    # game_systems.genre -> genres; character_builder_url -> character_builder_urls
    rows = bind.execute(
        sa.text(
            "SELECT id, genre, character_builder_url, genres, "
            "character_builder_urls, urls FROM game_systems"
        )
    ).fetchall()
    for gid, genre, cb_url, genres, cb_urls, urls in rows:
        updates = {}
        if _empty(genres) and genre:
            updates["genres"] = json.dumps([genre])
        if _empty(cb_urls) and cb_url:
            updates["character_builder_urls"] = json.dumps(
                [{"label": "", "url": cb_url}]
            )
        if _empty(genres) and _empty(urls):
            updates.setdefault("urls", json.dumps([]))
        # Ensure JSON list columns are never left NULL.
        _default_json(updates, "genres", genres)
        _default_json(updates, "dice_materials", None)
        _default_json(updates, "urls", urls)
        _default_json(updates, "character_builder_urls", cb_urls)
        if updates:
            _apply_update(bind, "game_systems", gid, updates)

    # books.publisher_url -> urls
    rows = bind.execute(
        sa.text("SELECT id, publisher_url, urls, genres, artists FROM books")
    ).fetchall()
    for bid, pub_url, urls, genres, artists in rows:
        updates = {}
        if _empty(urls) and pub_url:
            updates["urls"] = json.dumps([{"label": "Publisher", "url": pub_url}])
        _default_json(updates, "urls", urls)
        _default_json(updates, "genres", genres)
        _default_json(updates, "artists", artists)
        if updates:
            _apply_update(bind, "books", bid, updates)


def _empty(raw) -> bool:
    if raw is None:
        return True
    try:
        val = json.loads(raw) if isinstance(raw, str) else raw
    except (ValueError, TypeError):
        return True
    return not val


def _default_json(updates: dict, key: str, current) -> None:
    """Ensure a JSON list column gets an empty-list default when NULL."""
    if key not in updates and current is None:
        updates[key] = json.dumps([])


def _apply_update(bind, table: str, row_id: str, updates: dict) -> None:
    set_clause = ", ".join(f"{k} = :{k}" for k in updates)
    params = dict(updates)
    params["row_id"] = row_id
    bind.execute(
        sa.text(f"UPDATE {table} SET {set_clause} WHERE id = :row_id"), params
    )


def downgrade() -> None:
    tables = _tables()
    if "system_families" in tables:
        op.drop_table("system_families")
    if "genres" in tables:
        op.drop_index("ix_genres_parent_id", table_name="genres")
        op.drop_table("genres")

    for col in ("artists", "genres", "isbn", "version", "language", "month", "day", "urls"):
        if col in _columns("books"):
            op.drop_column("books", col)
    for col in (
        "genres",
        "dice_materials",
        "system_family",
        "license",
        "year",
        "urls",
        "character_builder_urls",
        "is_one_page",
    ):
        if col in _columns("game_systems"):
            op.drop_column("game_systems", col)
