"""shared cross-resource tags

Introduces the application-wide tag model (issue #235): a ``tags`` table
(internal match key + display label) and a polymorphic ``resource_tags`` join.
Backfills both from the existing per-row JSON ``tags`` arrays on systems, books,
maps, tokens, and audio. The JSON columns are intentionally left in place for now
(parallel-run safety); a later migration drops them once nothing reads them.

Display value for a migrated tag defaults to the first non-empty original casing
seen for that internal key, else the internal key itself. Idempotent: re-running
neither duplicates tables nor re-links resources.

Revision ID: c7a9e1f2b8d4
Revises: 1537716d5347
Create Date: 2026-07-27 00:00:00.000000+00:00

"""
import json
import uuid
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


# revision identifiers, used by Alembic.
revision: str = "c7a9e1f2b8d4"
down_revision: Union[str, None] = "1537716d5347"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


# (source table, resource_type) pairs holding a JSON ``tags`` column + string id.
_SOURCES = [
    ("game_systems", "system"),
    ("books", "book"),
    ("generic_maps", "map"),
    ("tokens", "token"),
    ("audio", "audio"),
]


def _title_case(text_value: str) -> str:
    """Title-case each whitespace-separated word (keeps existing inner casing per
    word intact, only upper-casing the first letter). "draw steel" → "Draw Steel"."""
    return " ".join(w[:1].upper() + w[1:] if w else w for w in text_value.split(" "))


def _has_table(bind, name: str) -> bool:
    return inspect(bind).has_table(name)


def _columns(bind, table: str) -> set:
    return {c["name"] for c in inspect(bind).get_columns(table)}


def upgrade() -> None:
    bind = op.get_bind()

    if not _has_table(bind, "tags"):
        op.create_table(
            "tags",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("internal", sa.String(length=200), nullable=False),
            sa.Column("display", sa.String(length=200), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.UniqueConstraint("internal", name="uq_tags_internal"),
        )

    if not _has_table(bind, "resource_tags"):
        op.create_table(
            "resource_tags",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("tag_id", sa.String(length=36), nullable=False),
            sa.Column("resource_type", sa.String(length=20), nullable=False),
            sa.Column("resource_id", sa.String(length=36), nullable=False),
            sa.Column("created_at", sa.DateTime(), nullable=True),
            sa.ForeignKeyConstraint(["tag_id"], ["tags.id"], ondelete="CASCADE"),
            sa.UniqueConstraint(
                "tag_id", "resource_type", "resource_id", name="uq_resource_tag"
            ),
        )
        op.create_index(
            "ix_resource_tags_resource",
            "resource_tags",
            ["resource_type", "resource_id"],
        )
        op.create_index("ix_resource_tags_tag", "resource_tags", ["tag_id"])

    _backfill(bind)


def _backfill(bind) -> None:
    # internal -> tag id (cache within this migration run).
    tag_ids: dict[str, str] = {
        row[0]: row[1]
        for row in bind.execute(text("SELECT internal, id FROM tags")).fetchall()
    }

    def ensure_tag(raw: str) -> str | None:
        internal = str(raw).strip().lower()
        if not internal:
            return None
        if internal in tag_ids:
            return tag_ids[internal]
        tid = str(uuid.uuid4())
        stripped = str(raw).strip()
        # Legacy JSON tags were stored lowercased, so an all-lowercase value has no
        # meaningful casing — default the display to Title Case. A value that
        # already carries uppercase is kept as the user entered it.
        display = stripped if stripped != stripped.lower() else _title_case(stripped)
        display = display or internal
        bind.execute(
            text(
                "INSERT INTO tags (id, internal, display, created_at) "
                "VALUES (:id, :internal, :display, CURRENT_TIMESTAMP)"
            ),
            {"id": tid, "internal": internal, "display": display},
        )
        tag_ids[internal] = tid
        return tid

    for table, resource_type in _SOURCES:
        if not _has_table(bind, table) or "tags" not in _columns(bind, table):
            continue
        rows = bind.execute(
            text(f"SELECT id, tags FROM {table} WHERE tags IS NOT NULL")
        ).fetchall()
        for res_id, raw in rows:
            try:
                tags = json.loads(raw) if isinstance(raw, str) else raw
            except (ValueError, TypeError):
                continue
            if not isinstance(tags, list):
                continue
            for raw_tag in tags:
                tid = ensure_tag(raw_tag)
                if tid is None:
                    continue
                # Idempotent link insert (skip if this resource already linked).
                exists = bind.execute(
                    text(
                        "SELECT 1 FROM resource_tags WHERE tag_id = :tid "
                        "AND resource_type = :rt AND resource_id = :rid"
                    ),
                    {"tid": tid, "rt": resource_type, "rid": res_id},
                ).first()
                if exists:
                    continue
                bind.execute(
                    text(
                        "INSERT INTO resource_tags "
                        "(id, tag_id, resource_type, resource_id, created_at) "
                        "VALUES (:id, :tid, :rt, :rid, CURRENT_TIMESTAMP)"
                    ),
                    {
                        "id": str(uuid.uuid4()),
                        "tid": tid,
                        "rt": resource_type,
                        "rid": res_id,
                    },
                )


def downgrade() -> None:
    bind = op.get_bind()
    if _has_table(bind, "resource_tags"):
        op.drop_index("ix_resource_tags_tag", table_name="resource_tags")
        op.drop_index("ix_resource_tags_resource", table_name="resource_tags")
        op.drop_table("resource_tags")
    if _has_table(bind, "tags"):
        op.drop_table("tags")
