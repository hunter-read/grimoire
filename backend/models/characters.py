"""Character sheets and the schemas that describe them.

A *schema* is a JSON document describing a character sheet: its fields, its
computed values, and its layout. A *character* is one set of answers to that
schema. Grimoire core renders any schema without knowing anything about the game
it came from — that is the whole point of the feature, so nothing here is
allowed to name a system.

Both tables are **per user**, following ``UserTheme`` rather than the add-on
registry. A schema is a small document, so a copy per user costs almost nothing,
and it means one person editing their sheet never changes what anyone else in a
shared library sees. It also means installing a sheet needs no admin approval —
the opposite of add-ons, which are global.

``source_id`` / ``source_url`` / ``source_version`` record where a downloaded
schema came from so it can be traced back and updated later; all three are null
for a schema the user wrote or pasted. That is the same provenance triple
``UserTheme`` and ``WikiTemplate`` carry, and it means the three features stay
recognisably one pattern.
"""
import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
    text,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class CharacterSchema(Base):
    """A character sheet definition installed by one user, or for everyone.

    ``user_id`` names the user who installed it for themselves. Null makes it a
    **server-wide** sheet, installed by an admin so every account has it without
    installing it: the sheet a system's compendium reads its content types from,
    and the one a new player can start a character on straight away. A user's
    own copy of the same ``schema_id`` wins over the server's, so someone who
    edited a sheet keeps their edit (``services.characters.user_schemas``).

    ``document`` holds the whole schema JSON — ``fields``, ``computed``,
    ``layout``, and the optional ``layout_html`` / ``styles`` pair. It is stored
    as one blob rather than shredded into columns because the engine reads it
    whole on every render, and because a schema's shape is the feature's public
    contract: normalising it here would mean a migration every time the schema
    language grows a key.

    The document is re-validated on the way *out* as well as in. A row edited
    directly in the database must be no more dangerous than an uploaded file —
    the same rule ``UserTheme`` follows for colour tokens, and it matters more
    here because a schema carries layout markup rather than just values.
    """

    __tablename__ = "character_schemas"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    # Null for a server-wide sheet (see the class docstring).
    user_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=True, index=True
    )
    # Stable identifier: the community id for a downloaded schema, or a slug
    # derived from the name for an authored one. Unique per user, and once
    # among the server-wide sheets, so installing the same schema twice updates
    # it rather than duplicating it.
    schema_id: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    # The game this sheet is for, free text and display-only. Kept out of the
    # document so the picker can group by it without parsing every schema.
    system: Mapped[Optional[str]] = mapped_column(String(200), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, default="")
    # Schema-author version (semver), distinct from source_version below: this
    # is what the document itself claims, which an authored schema also has.
    version: Mapped[Optional[str]] = mapped_column(String(20), default="1.0.0")
    document: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)

    source_id: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    source_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (
        UniqueConstraint("user_id", "schema_id"),
        # The constraint above cannot see server-wide rows: NULLs never compare
        # equal, so it would let two of them share a schema id. A partial index
        # covers them, on both databases.
        Index(
            "uq_character_schemas_server",
            "schema_id",
            unique=True,
            sqlite_where=text("user_id IS NULL"),
            postgresql_where=text("user_id IS NULL"),
        ),
    )


class Character(Base):
    """One character, owned by a user and answering to one schema.

    ``data`` is the character's field values, keyed by field name. Computed
    values are deliberately *not* stored: they are derived from ``data`` on
    every read, so a schema whose formula changes immediately corrects every
    character built on it rather than leaving stale numbers behind.

    ``campaign_id`` scopes a character to a table. A campaign member may read
    another member's sheet but never edit it — the sheet belongs to the player
    who wrote it, the same rule a campaign ruleset follows. The one exception is
    ``gm_can_edit``: a player may let their campaign's GM edit the sheet too.

    ``schema_ref`` stores the schema's ``schema_id`` string rather than a
    foreign key to ``character_schemas.id``. A character must survive its schema
    being uninstalled and reinstalled — which produces a new row id but the same
    schema_id — and a player must be able to keep a sheet whose schema they have
    temporarily removed. A dangling ref renders as a read-only raw-data view
    rather than an error, which is why it is not enforced at the database level.
    """

    __tablename__ = "characters"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    schema_ref: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    data: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)

    # The campaign this character is played in, if any. Nullable because a
    # character may exist before a campaign does — a player rolls one up and
    # joins a table later — and because a character can outlive the game it was
    # made for. Setting it lets the party see the sheet. Deleting the campaign
    # unlinks it (``ON DELETE SET NULL``; the campaign delete also clears
    # ``gm_can_edit``, as moving the character out of a campaign does).
    campaign_id: Mapped[Optional[str]] = mapped_column(
        String(36), ForeignKey("campaigns.id", ondelete="SET NULL"), nullable=True, index=True
    )

    # Where the character stands in their story: "active", "retired" or
    # "dead". A player whose character falls rolls a new one in the same
    # campaign; the old sheet stays, marked, rather than being deleted to make
    # room. Nothing limits a player to one character per campaign.
    status: Mapped[str] = mapped_column(String(20), nullable=False, default="active", server_default="active")

    # Whether the GM of the character's campaign may edit the sheet as well as
    # read it - to fix a typo, apply damage, hand out loot. Off by default, and
    # only the owner flips it. Moving the character to another campaign turns
    # it off again, so a sheet is never handed to a GM the player did not pick.
    gm_can_edit: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False, server_default="0")

    # Filename under DATA_PATH/character_portraits/, not a path: the directory
    # is ours to choose and storing one would make moving it a migration.
    portrait_path: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    # Which part of the portrait a frame shows: ``{"x", "y", "zoom"}``, the
    # focus point as percentages of the image and a magnification from 1. A
    # frame of any shape keeps that point in view, so tall art can be framed on
    # the face rather than cut off at the neck. Null means centred, unzoomed.
    portrait_crop: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)


class UserImporter(Base):
    """A character importer one user installed for themselves.

    Importers are add-ons, normally installed server-wide by an admin under
    ``DATA_PATH/add-ons/``. One that only reads uploaded files with a YAML
    mapping makes no network request and runs no code, so it is no riskier
    than a pasted character sheet - and like a sheet, any user may install it
    for their own account without asking. Importers that fetch links or run
    scripts stay admin-only.

    ``manifest`` is the parsed YAML as downloaded. It is re-validated, and
    re-checked as one a user may install, every time it is loaded, so a row
    edited in the database cannot smuggle in a script or a fetch URL.
    """

    __tablename__ = "user_importers"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    importer_id: Mapped[str] = mapped_column(String(100), nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False, default="")
    version: Mapped[Optional[str]] = mapped_column(String(20), default="")
    manifest: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    # Which index it came from and the digest it matched, for updates.
    source_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    sha256: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)

    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    updated_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "importer_id"),)
