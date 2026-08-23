"""Access-level vocabulary and the per-user grant model (issue #258).

Books can be restricted so that only privileged roles may see them at all. A
restriction is expressed as an *access level* — the minimum role required to see
the item — and is resolved through a three-tier cascade (book → system →
category default) implemented in ``backend.services.access_control``.

The levels are deliberately named for who *can* see an item rather than who is
blocked, so they line up one-to-one with the existing role names:

    ``""``      open              — every user, including players and guests
    ``"gm"``    Player-Restricted — GMs and admins
    ``"admin"`` Admin-Only        — admins only

On a *book*, NULL is a fourth state meaning **inherit**: no book-level opinion,
so the cascade falls through to the system and then the category default. The
empty string on a book is therefore not the same as NULL — it is an explicit
"open", which is how a single freely-shared book stays visible inside an
otherwise-restricted system. Use ``is_inherit`` rather than a falsiness check
anywhere that distinction matters; ``normalize`` collapses both to open and is
only for call sites that have already resolved the cascade.
"""
from typing import Optional

from sqlalchemy import Column, ForeignKey, String, UniqueConstraint

from .base import Base, _uuid

# Open: no restriction at all. The default for every book, system, and category.
LEVEL_OPEN = ""
# Player-Restricted: visible to GMs and admins.
LEVEL_GM = "gm"
# Admin-Only: visible to admins.
LEVEL_ADMIN = "admin"

# Ordered least- to most-restrictive. Index into this is the comparison key, so
# "is level A at least as restrictive as level B" is a pair of lookups rather
# than a chain of conditionals.
LEVEL_ORDER = (LEVEL_OPEN, LEVEL_GM, LEVEL_ADMIN)

# The levels an admin may actually assign to a book/system/category.
ASSIGNABLE_LEVELS = frozenset(LEVEL_ORDER)

# The restriction levels only — what a *grant* can be issued against, and what
# the settings matrix may set a category to.
RESTRICTED_LEVELS = frozenset({LEVEL_GM, LEVEL_ADMIN})

# Categories that can never be restricted app-wide (issue #258). Core rulebooks
# and character sheets are the two every player at the table needs by
# definition, so restricting them library-wide is always a misconfiguration
# rather than a choice someone meant to make.
UNRESTRICTABLE_CATEGORIES = frozenset({"core", "character-sheet"})

# app_settings key holding the category → level map, as a JSON object. Absent or
# unparseable means "no category defaults", i.e. everything open.
CATEGORY_DEFAULTS_KEY = "restricted_categories"

# Grant scopes. A grant is always attached to one system or one book.
SCOPE_SYSTEM = "system"
SCOPE_BOOK = "book"
GRANT_SCOPES = frozenset({SCOPE_SYSTEM, SCOPE_BOOK})


def is_inherit(level: Optional[str]) -> bool:
    """Whether a stored book-level value means "inherit" rather than a real level.

    Only NULL/None inherits. ``""`` is an explicit "open" that overrides a
    restricted system, so it must not be conflated with an unset column.
    """
    return level is None


def normalize(level: Optional[str]) -> str:
    """Coerce a stored/level-ish value to one of ``LEVEL_ORDER``.

    NULL, empty, and any unrecognised string all mean "open". Failing open is
    the right default *here* specifically because an unrecognised value can only
    come from a hand-edited database or a downgrade, and the alternative —
    failing closed — would hide a library from its owner with no way to tell why.
    Untrusted input never reaches this function: the API validates against
    ``ASSIGNABLE_LEVELS`` on the way in.
    """
    if not level:
        return LEVEL_OPEN
    return level if level in ASSIGNABLE_LEVELS else LEVEL_OPEN


def rank(level: Optional[str]) -> int:
    """Restrictiveness of ``level`` as an index into ``LEVEL_ORDER``."""
    return LEVEL_ORDER.index(normalize(level))


def most_restrictive(*levels: Optional[str]) -> str:
    """The strictest of ``levels``. No arguments (or all open) yields open."""
    return max((normalize(x) for x in levels), key=rank, default=LEVEL_OPEN)


class UserAccessGrant(Base):
    """An override letting one user reach content their role otherwise cannot.

    Grants exist so a library can be locked down by default and then opened up
    for the people who need it — "this GM runs the Strahd campaign, give them
    the whole Ravenloft shelf" — without demoting the restriction for everyone.

    ``scope_type``/``scope_id`` name what is being granted (a system or a single
    book) and ``level`` is the ceiling the grant raises the user to *within that
    scope*: a grant of ``"admin"`` on a system lets the user see even the
    admin-only books in it, while a grant of ``"gm"`` covers only the
    player-restricted ones.

    Deliberately *not* a foreign key on ``scope_id``: the column addresses two
    different tables depending on ``scope_type``, which no single FK can
    express. Rows orphaned by a deleted book or system are harmless (they can
    never match anything) and are swept up by the maintenance cleanup.
    """

    __tablename__ = "user_access_grants"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    scope_type = Column(String(10), nullable=False)  # system | book
    scope_id = Column(String(36), nullable=False, index=True)
    level = Column(String(10), nullable=False, default=LEVEL_GM)

    __table_args__ = (UniqueConstraint("user_id", "scope_type", "scope_id"),)
