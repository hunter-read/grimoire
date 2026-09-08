"""3D printable models as a fifth collection

TTRPG libraries increasingly hold printable minis and terrain beside the books,
maps, tokens and audio. Until now those files had nowhere to live: an ``.stl``
was only ever seen by the scanner as an opaque blob inside a map-pack archive,
so it could not be searched, tagged, favourited, or attached to a campaign.

Creates ``models_3d`` and its folder-tag table, matching the shape every other
media collection already has — the same content-identity columns
(``content_hash`` + ``file_mtime``, so a rescan reads no file content unless the
stat signature moved), the same soft variant grouping, and the same
``is_missing`` flag.

Two columns are specific to this collection:

``triangle_count``
    Mesh complexity, read from the binary STL header (84 bytes, no parse). 0
    when unknown — an ASCII mesh, or a format that is registered but not parsed.

``is_supported``
    Deliberately nullable and **not** defaulted to false. It is tri-state: true
    is presupported (the file ships with printing supports attached), false is
    unsupported, and NULL is "could not be told from the filename or folder".
    Defaulting to false would assert something about every model in a library
    that does not use the naming convention, and the distinction is the whole
    point of the column.

Like every other collection, ``variant_parent_id`` is a soft reference rather
than a foreign key — see the note in 0025 for why.

Revision ID: c7f5a2b81e64
Revises: b6e4f80a3d19
Create Date: 2026-09-05 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect


revision: str = "c7f5a2b81e64"
down_revision: Union[str, None] = "b6e4f80a3d19"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    tables = set(inspect(op.get_bind()).get_table_names())

    if "models_3d" not in tables:
        op.create_table(
            "models_3d",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("filename", sa.String(length=500), nullable=False),
            sa.Column("filepath", sa.String(length=1000), nullable=False, unique=True),
            sa.Column("relative_path", sa.String(length=1000), nullable=False),
            sa.Column("description", sa.Text(), nullable=True),
            sa.Column("is_explicit", sa.Boolean(), nullable=True),
            sa.Column("file_size", sa.Integer(), nullable=True),
            sa.Column("triangle_count", sa.Integer(), nullable=True),
            sa.Column("is_supported", sa.Boolean(), nullable=True),
            sa.Column("content_hash", sa.String(length=64), nullable=True),
            sa.Column("file_mtime", sa.Float(), nullable=True),
            sa.Column("variant_parent_id", sa.String(length=36), nullable=True),
            sa.Column("variant_kind", sa.String(length=30), nullable=True),
            sa.Column("variant_label", sa.String(length=120), nullable=True),
            sa.Column("has_thumbnail", sa.Boolean(), nullable=True),
            sa.Column("is_missing", sa.Boolean(), nullable=True),
            sa.Column("created_at", sa.DateTime(), nullable=True),
        )
        op.create_index(
            "ix_models_3d_content_hash", "models_3d", ["content_hash"]
        )
        op.create_index(
            "ix_models_3d_variant_parent_id", "models_3d", ["variant_parent_id"]
        )

    if "model_3d_folders" not in tables:
        op.create_table(
            "model_3d_folders",
            sa.Column("id", sa.String(length=36), primary_key=True),
            sa.Column("path", sa.String(length=1000), nullable=False, unique=True),
            sa.Column("tags", sa.JSON(), nullable=True),
        )


def downgrade() -> None:
    # These tables are this revision's own creation, so reversing it drops them.
    # Unlike a column added to a pre-existing table (where the user's data would
    # be collateral), nothing here predates the revision.
    existing = set(inspect(op.get_bind()).get_table_names())
    for table in ("model_3d_folders", "models_3d"):
        if table in existing:
            op.drop_table(table)
