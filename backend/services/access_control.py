"""Who may see which books (issue #258).

A shared library holds things not everyone at the table should browse — the
adventure module the players are currently inside, the campaign notes shelf, the
GM screen. This module owns the single rule that decides it, so that every
surface which can leak a book (browse, search, OPDS, downloads, favourites,
duplicates, campaign resource pickers) asks the same question and gets the same
answer.

**The cascade.** A book's effective level is resolved most-specific-first:

    book.access_level  →  system.access_level  →  category default  →  open

``books.access_level`` is three-state. NULL means *inherit* — this book has no
opinion, keep looking. Any non-NULL value, including ``""``, is an explicit
decision that ends the cascade, which is what lets a freely-shared player's
guide stay visible inside an otherwise admin-only adventure line. The book level
always wins when it is set, in either direction.

**The ceiling.** A user's role sets how far down the cascade they can see:
admins reach everything, GMs reach ``gm``, and players and guests reach only
open content. Guests are players with a further campaign restriction layered on
top by the campaign code — they never gain access here, only lose it.

**Grants** raise one user's ceiling within one scope. They exist so a library can
be locked down by default and then opened for the people who need it, without
weakening the restriction for everyone else. Per the feature's design, grants
are only meaningful for GMs and only against admin-only content: a player cannot
be granted their way past a restriction, because "restricted from players" is
the entire point of the player-restricted level.

**Failing closed vs. open.** Every query helper here takes the deny path when it
cannot prove access — a missing user row yields the player ceiling, not the
admin one. The one deliberate exception is ``models.access.normalize``, which
treats an unrecognised stored level as open; see its docstring.
"""
from __future__ import annotations

import json
from typing import Any, Iterable, Optional

from sqlalchemy import and_, false, or_, true
from sqlalchemy.orm import Query, Session

from ..models import AppSetting, Book, GameSystem, User, UserAccessGrant
from ..models.access import (
    ASSIGNABLE_LEVELS,
    CATEGORY_DEFAULTS_KEY,
    LEVEL_ADMIN,
    LEVEL_GM,
    LEVEL_OPEN,
    RESTRICTED_LEVELS,
    SCOPE_BOOK,
    SCOPE_SYSTEM,
    UNRESTRICTABLE_CATEGORIES,
    is_inherit,
    normalize,
    rank,
)

# Role → the most restrictive level that role can see unaided. Anything not
# listed (including "guest" and any future role) falls to the player ceiling,
# so a new role is locked out by default rather than silently granted access.
_ROLE_CEILING = {
    "admin": LEVEL_ADMIN,
    "gm": LEVEL_GM,
}


class AccessError(Exception):
    """An access-level write was refused. Routers map this to a 400."""


def role_ceiling(role: Optional[str]) -> str:
    """The highest restriction level ``role`` can see without a grant."""
    return _ROLE_CEILING.get(role or "", LEVEL_OPEN)


def can_receive_grants(role: Optional[str]) -> bool:
    """Whether grants may be issued to a user in ``role``.

    Only GMs. Admins already see everything (a grant would be a no-op), and
    players/guests are exactly who the restrictions exist to exclude — granting
    one past a restriction would make the level meaningless.
    """
    return role == "gm"


def category_defaults(db: Session) -> dict[str, str]:
    """The ``{category: level}`` map restricting whole categories app-wide.

    Reads the ``restricted_categories`` app setting. Anything unparseable, or
    naming a category that may not be restricted, is dropped rather than raising
    — a corrupt setting must not take the library down, and the stricter
    interpretation of a malformed value would hide books nobody chose to hide.
    """
    row = db.query(AppSetting).filter_by(key=CATEGORY_DEFAULTS_KEY).first()
    if not row or not row.value:
        return {}
    try:
        raw = json.loads(row.value)
    except (ValueError, TypeError):
        return {}
    if not isinstance(raw, dict):
        return {}
    out: dict[str, str] = {}
    for category, level in raw.items():
        if not isinstance(category, str) or category in UNRESTRICTABLE_CATEGORIES:
            continue
        if level in RESTRICTED_LEVELS:
            out[category] = level
    return out


def validate_category_defaults(raw: Any) -> dict[str, str]:
    """Validate an incoming category→level map, raising ``AccessError`` on junk.

    Unlike :func:`category_defaults`, which forgives a bad stored value, this is
    the write path: an admin who mistypes a category or a level should be told,
    not silently ignored.
    """
    if not isinstance(raw, dict):
        raise AccessError("restricted_categories must be an object")
    out: dict[str, str] = {}
    for category, level in raw.items():
        if not isinstance(category, str) or not category.strip():
            raise AccessError("category names must be non-empty strings")
        category = category.strip()
        if category in UNRESTRICTABLE_CATEGORIES:
            raise AccessError(f"the '{category}' category cannot be restricted")
        if level in (None, LEVEL_OPEN):
            continue  # "open" is the absence of an entry, not a stored value
        if level not in RESTRICTED_LEVELS:
            raise AccessError(f"invalid access level for '{category}': {level!r}")
        out[category] = level
    return out


def validate_level(level: Any, *, allow_inherit: bool = True) -> Optional[str]:
    """Validate an incoming ``access_level`` for a book or system.

    Returns the value to store. ``None`` means inherit and is only valid where
    the caller allows it (books do, systems do not — a system's empty value is
    already its "open").
    """
    if level is None:
        if not allow_inherit:
            return LEVEL_OPEN
        return None
    if level not in ASSIGNABLE_LEVELS:
        raise AccessError(f"invalid access level: {level!r}")
    return level


# --------------------------------------------------------------------------
# Resolution
# --------------------------------------------------------------------------


def resolve_level(
    db: Session,
    book: Book,
    *,
    system: Optional[GameSystem] = None,
    defaults: Optional[dict[str, str]] = None,
) -> str:
    """The effective access level for ``book``, following the full cascade.

    ``system`` and ``defaults`` may be passed by callers resolving many books at
    once, so a list view does not re-query the system row or re-parse the
    settings JSON per book.
    """
    if not is_inherit(book.access_level):
        return normalize(book.access_level)

    if system is None and book.game_system_id:
        system = db.query(GameSystem).filter_by(id=book.game_system_id).first()
    if system is not None and normalize(system.access_level) != LEVEL_OPEN:
        return normalize(system.access_level)

    if defaults is None:
        defaults = category_defaults(db)
    return normalize(defaults.get(book.category or ""))


def effective_levels(db: Session, books: Iterable[Book]) -> dict[str, str]:
    """Resolve the effective level for many books at once.

    A list view needs the resolved level per row to render a badge. Doing that
    through :func:`resolve_level` per book would re-read the settings row and
    re-query a system for every entry; this batches both into one pass.
    """
    books = list(books)
    if not books:
        return {}
    defaults = category_defaults(db)
    system_ids = {b.game_system_id for b in books if b.game_system_id}
    systems = {}
    if system_ids:
        systems = {
            row.id: row
            for row in db.query(GameSystem).filter(GameSystem.id.in_(system_ids)).all()
        }
    return {
        b.id: resolve_level(
            db, b, system=systems.get(b.game_system_id), defaults=defaults
        )
        for b in books
    }


def granted_level(db: Session, user: Any, book: Book) -> str:
    """The ceiling ``user``'s grants raise them to for ``book``, else open.

    A book-scoped grant outranks a system-scoped one; both are considered so a
    broad "this whole system" grant still covers a book with no grant of its own.
    """
    if not can_receive_grants(getattr(user, "role", None)):
        return LEVEL_OPEN

    scopes = [(SCOPE_BOOK, book.id)]
    if book.game_system_id:
        scopes.append((SCOPE_SYSTEM, book.game_system_id))

    rows = (
        db.query(UserAccessGrant)
        .filter(
            UserAccessGrant.user_id == user.id,
            or_(
                *[
                    and_(
                        UserAccessGrant.scope_type == scope_type,
                        UserAccessGrant.scope_id == scope_id,
                    )
                    for scope_type, scope_id in scopes
                ]
            ),
        )
        .all()
    )
    if not rows:
        return LEVEL_OPEN

    by_scope = {r.scope_type: normalize(r.level) for r in rows}
    # Book grant is the more specific statement and stands alone when present.
    if SCOPE_BOOK in by_scope:
        return by_scope[SCOPE_BOOK]
    return by_scope.get(SCOPE_SYSTEM, LEVEL_OPEN)


def can_access_book(
    db: Session,
    user: Any,
    book: Book,
    *,
    system: Optional[GameSystem] = None,
    defaults: Optional[dict[str, str]] = None,
) -> bool:
    """Whether ``user`` may see ``book`` at all."""
    required = resolve_level(db, book, system=system, defaults=defaults)
    if required == LEVEL_OPEN:
        return True

    ceiling = role_ceiling(getattr(user, "role", None))
    if rank(ceiling) >= rank(required):
        return True

    # A grant only ever helps against admin-only content, and only for GMs;
    # granted_level enforces the role half, this comparison the level half.
    return rank(granted_level(db, user, book)) >= rank(required)


def can_access_system(db: Session, user: Any, system: GameSystem) -> bool:
    """Whether ``user`` may see ``system`` itself (its card, its detail page).

    A restricted system is hidden outright rather than shown empty: an empty
    "Curse of Strahd" shelf is the same spoiler as the books inside it.
    """
    required = normalize(system.access_level)
    if required == LEVEL_OPEN:
        return True
    if rank(role_ceiling(getattr(user, "role", None))) >= rank(required):
        return True
    if not can_receive_grants(getattr(user, "role", None)):
        return False
    grant = (
        db.query(UserAccessGrant)
        .filter_by(user_id=user.id, scope_type=SCOPE_SYSTEM, scope_id=system.id)
        .first()
    )
    return grant is not None and rank(normalize(grant.level)) >= rank(required)


# --------------------------------------------------------------------------
# Query filters
# --------------------------------------------------------------------------


def _visible_levels(user: Any) -> set[str]:
    """The set of required-levels ``user`` clears on role alone."""
    ceiling = rank(role_ceiling(getattr(user, "role", None)))
    return {level for level in ASSIGNABLE_LEVELS if rank(level) <= ceiling}


def _grant_scope_ids(db: Session, user: Any, scope_type: str) -> dict[str, str]:
    """``{scope_id: level}`` for this user's grants of one scope type."""
    if not can_receive_grants(getattr(user, "role", None)):
        return {}
    rows = db.query(UserAccessGrant).filter_by(user_id=user.id, scope_type=scope_type).all()
    return {r.scope_id: normalize(r.level) for r in rows}


def visible_books(db: Session, q: Query, user: Any) -> Query:
    """Narrow a ``Book`` query to the rows ``user`` may see.

    Expresses the whole cascade in SQL so a browse list stays one query. The
    shape is: for each level the user *cannot* see, exclude the books that
    resolve to it — via their own explicit level, via their system's level, or
    via their category's default — then add back anything a grant covers.
    """
    ceiling = role_ceiling(getattr(user, "role", None))
    if ceiling == LEVEL_ADMIN:
        return q  # admins see everything; no filter, no joins

    visible = _visible_levels(user)
    blocked = [level for level in ASSIGNABLE_LEVELS if level not in visible]
    if not blocked:
        return q

    defaults = category_defaults(db)
    blocked_categories = [c for c, level in defaults.items() if level in blocked]

    # Two different sets, and conflating them is a real bug. ``blocked`` systems
    # are the ones this user cannot clear — they hide their inheriting books.
    # ``levelled`` systems are those setting *any* non-open level: they end the
    # cascade whether or not the user clears them, so a category default must
    # not apply underneath one. A GM looking at a gm-level system holding an
    # admin-only category is exactly the case that separates them.
    restricted_system_ids = [
        row[0]
        for row in db.query(GameSystem.id).filter(GameSystem.access_level.in_(blocked)).all()
    ]
    levelled_system_ids = [
        row[0]
        for row in db.query(GameSystem.id)
        .filter(GameSystem.access_level.isnot(None), GameSystem.access_level != LEVEL_OPEN)
        .all()
    ]

    # A book is hidden when its *effective* level is blocked. Mirrors
    # resolve_level branch for branch, in the same precedence order.
    #
    # The ``true()``/``false()`` literals matter: a bare Python bool inside
    # ``and_``/``or_`` is not a SQL expression, and an empty ``IN ()`` is not
    # portable, so each optional clause is spelled out as an explicit constant
    # when its id list is empty.
    in_restricted_system = (
        Book.game_system_id.in_(restricted_system_ids) if restricted_system_ids else false()
    )
    in_levelled_system = (
        Book.game_system_id.in_(levelled_system_ids) if levelled_system_ids else false()
    )
    in_blocked_category = (
        Book.category.in_(blocked_categories) if blocked_categories else false()
    )
    # NULL is "inherit", and SQL three-valued logic makes that a live hazard
    # here: ``NULL IN ('gm','admin')`` is NULL, not false, so ``NOT (...)`` over
    # a bare IN drops every inheriting book instead of keeping it. Each branch
    # is therefore written to produce a definite true/false for a NULL level —
    # branch 1 tests non-NULL explicitly, and branches 2 and 3 test IS NULL.
    has_explicit_level = Book.access_level.isnot(None)
    hidden = or_(
        # 1. Explicit book level that the user cannot clear.
        and_(has_explicit_level, Book.access_level.in_(blocked)),
        # 2. Inherit → restricted system.
        and_(Book.access_level.is_(None), in_restricted_system),
        # 3. Inherit → system that sets no level → restricted category. Guarded
        #    on ``levelled`` rather than ``restricted``: a system the user *can*
        #    clear still terminates the cascade, so its books must not pick up a
        #    stricter category default. A book with no system row at all reaches
        #    the default here, matching resolve_level.
        and_(
            Book.access_level.is_(None),
            ~in_levelled_system,
            in_blocked_category,
        ),
    )

    book_grants = _grant_scope_ids(db, user, SCOPE_BOOK)
    system_grants = _grant_scope_ids(db, user, SCOPE_SYSTEM)
    granted_book_ids = [bid for bid, level in book_grants.items() if rank(level) > rank(ceiling)]
    granted_system_ids = [
        sid for sid, level in system_grants.items() if rank(level) > rank(ceiling)
    ]

    if granted_book_ids or granted_system_ids:
        # A book-scoped grant wins outright. A system-scoped one covers the
        # books in that system that carry no book-scoped grant of their own,
        # which is where an explicitly-denied book inside a granted system stays
        # hidden — the book's own (absent) grant is the more specific statement.
        exempt = []
        if granted_book_ids:
            exempt.append(Book.id.in_(granted_book_ids))
        if granted_system_ids:
            exempt.append(
                and_(
                    Book.game_system_id.in_(granted_system_ids),
                    ~Book.id.in_(list(book_grants)) if book_grants else true(),
                )
            )
        return q.filter(or_(~hidden, or_(*exempt)))

    return q.filter(~hidden)


def visible_book_ids(db: Session, user: Any) -> list[str]:
    """The ids of every book ``user`` may see.

    For the callers that cannot express the filter in their own query — the FTS
    search path, which selects from a virtual table, and the archive builders.
    Returns every id for an admin rather than short-circuiting, so callers have
    one code path; see :func:`sees_everything` to skip the query entirely.
    """
    return [row[0] for row in visible_books(db, db.query(Book.id), user).all()]


def restricted_book_ids(db: Session, user: Any) -> list[str]:
    """The ids of the books ``user`` may **not** see.

    The complement of :func:`visible_book_ids`, for callers that must express
    the restriction as a SQL ``NOT IN`` against a table this module cannot
    filter directly — chiefly the FTS ``book_search`` virtual table, whose
    LIMIT runs before any Python-side filtering could be applied.

    Returning the excluded set rather than the allowed one keeps that list
    small in the normal case: a library with three restricted books sends three
    ids, not ten thousand.
    """
    if sees_everything(user):
        return []
    visible = set(visible_book_ids(db, user))
    return [row[0] for row in db.query(Book.id).all() if row[0] not in visible]


def sees_everything(user: Any) -> bool:
    """Whether ``user`` clears every restriction on role alone (i.e. is an admin).

    Lets hot paths skip building a filter or an id list at all.
    """
    return role_ceiling(getattr(user, "role", None)) == LEVEL_ADMIN


def visible_systems(db: Session, q: Query, user: Any) -> Query:
    """Narrow a ``GameSystem`` query to the systems ``user`` may see."""
    ceiling = role_ceiling(getattr(user, "role", None))
    if ceiling == LEVEL_ADMIN:
        return q
    blocked = [level for level in ASSIGNABLE_LEVELS if level not in _visible_levels(user)]
    if not blocked:
        return q
    granted = [
        sid
        for sid, level in _grant_scope_ids(db, user, SCOPE_SYSTEM).items()
        if rank(level) > rank(ceiling)
    ]
    hidden = GameSystem.access_level.in_(blocked)
    if granted:
        return q.filter(or_(~hidden, GameSystem.id.in_(granted)))
    return q.filter(~hidden)


def load_user(db: Session, current_user: Any) -> Any:
    """Resolve the ORM ``User`` behind a ``CurrentUser`` token payload.

    Access decisions read ``role``, which the token carries, but the ORM row is
    what the grant queries join against. Returns the token object itself when
    the row is gone, so a user deleted mid-session is evaluated at their token's
    role rather than crashing the request.
    """
    if isinstance(current_user, User):
        return current_user
    row = db.query(User).filter_by(id=getattr(current_user, "id", None)).first()
    return row if row is not None else current_user
