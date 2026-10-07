"""character status and personal rulesets

Two columns the character builder grew after its first release.

**``characters.status``** - ``active``, ``retired`` or ``dead``, defaulting to
``active``. A player may have several characters in one campaign; when one falls
they mark it rather than delete it, and its sheet stays readable beside the one
they play next.

**``rulesets.owner_id``** - set for a **personal** ruleset, which only that user
can read or edit. Importing a character used to put the content embedded in its
file into a server ruleset - readable by everyone, and otherwise something only
an admin can create. It now goes into a personal one. The rulesets earlier
imports created are recognisable by the description the import gave them, and
become their importer's own.

SQLite cannot add a constraint with ALTER TABLE, so ``owner_id`` arrives without
its foreign key, like every column added after its table was created.
Idempotent.

Revision ID: 34e9f14ea065
Revises: 9d3f6a2c8e51
Create Date: 2026-10-07 00:00:00.000000+00:00

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy import inspect, text


revision: str = "34e9f14ea065"
down_revision: Union[str, None] = "9d3f6a2c8e51"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    bind = op.get_bind()
    insp = inspect(bind)
    tables = set(insp.get_table_names())

    if "characters" in tables:
        existing = {c["name"] for c in insp.get_columns("characters")}
        if "status" not in existing:
            op.add_column(
                "characters",
                sa.Column(
                    "status", sa.String(length=20), nullable=False, server_default="active"
                ),
            )

    if "rulesets" in tables:
        existing = {c["name"] for c in insp.get_columns("rulesets")}
        if "owner_id" not in existing:
            op.add_column("rulesets", sa.Column("owner_id", sa.String(length=36), nullable=True))
        indexes = {index["name"] for index in insp.get_indexes("rulesets")}
        if "ix_rulesets_owner_id" not in indexes:
            op.create_index("ix_rulesets_owner_id", "rulesets", ["owner_id"])
        # Content an import made public becomes the importer's own.
        bind.execute(
            text(
                "UPDATE rulesets SET owner_id = created_by_id "
                "WHERE owner_id IS NULL AND campaign_id IS NULL "
                "AND created_by_id IS NOT NULL "
                "AND description = 'Recreated from an imported character.'"
            )
        )


def downgrade() -> None:
    # Left in place: dropping them would break the current code against a
    # database this revision is no longer responsible for creating.
    pass
