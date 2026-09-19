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
from sqlalchemy import (
    Column,
    DateTime,
    ForeignKey,
    JSON,
    String,
    Text,
    UniqueConstraint,
)

from .base import Base, _utcnow, _uuid


class CharacterSchema(Base):
    """A character sheet definition installed by one user, for that user only.

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

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # Stable identifier: the community id for a downloaded schema, or a slug
    # derived from the name for an authored one. Unique per user, so installing
    # the same schema twice updates it rather than duplicating it.
    schema_id = Column(String(100), nullable=False)
    name = Column(String(200), nullable=False)
    # The game this sheet is for, free text and display-only. Kept out of the
    # document so the picker can group by it without parsing every schema.
    system = Column(String(200), default="")
    description = Column(Text, default="")
    # Schema-author version (semver), distinct from source_version below: this
    # is what the document itself claims, which an authored schema also has.
    version = Column(String(20), default="1.0.0")
    document = Column(JSON, default=dict)

    source_id = Column(String(100), nullable=True)
    source_url = Column(Text, nullable=True)
    source_version = Column(String(20), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    __table_args__ = (UniqueConstraint("user_id", "schema_id"),)


class Character(Base):
    """One character, owned by a user and answering to one schema.

    ``data`` is the character's field values, keyed by field name. Computed
    values are deliberately *not* stored: they are derived from ``data`` on
    every read, so a schema whose formula changes immediately corrects every
    character built on it rather than leaving stale numbers behind.

    ``campaign_id`` scopes a character to a table. A campaign member may read
    another member's sheet but never edit it — the sheet belongs to the player
    who wrote it, the same rule homebrew follows.

    ``schema_ref`` stores the schema's ``schema_id`` string rather than a
    foreign key to ``character_schemas.id``. A character must survive its schema
    being uninstalled and reinstalled — which produces a new row id but the same
    schema_id — and a player must be able to keep a sheet whose schema they have
    temporarily removed. A dangling ref renders as a read-only raw-data view
    rather than an error, which is why it is not enforced at the database level.
    """

    __tablename__ = "characters"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    schema_ref = Column(String(100), nullable=False, index=True)
    name = Column(String(200), nullable=False, default="")
    data = Column(JSON, default=dict)

    # The campaign this character is played in, if any. Nullable because a
    # character may exist before a campaign does — a player rolls one up and
    # joins a table later — and because a character can outlive the game it was
    # made for. Setting it lets the party see the sheet.
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True, index=True)

    # Filename under DATA_PATH/uploads/characters/, not a path: the directory is
    # ours to choose and storing one would make moving it a migration.
    portrait_path = Column(String(255), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)
