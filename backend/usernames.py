"""Usernames are unique regardless of case.

Signing in matches a username case-insensitively, so "Admin" and "admin" have
to be one account: two of them would leave the sign-in form picking one
arbitrarily. Every place that checks whether a name is taken goes through
:func:`username_taken`.

Names are compared with full Unicode case folding (:func:`fold_username`, stored
per account in ``users.username_folded``), so "Émile" and "émile" are one name
too. The database backs this with a unique index on ``lower(username)``
(:func:`ensure_unique_index`); the database's ``lower()`` folds less than Python
does (SQLite's only A-Z), so the index is the narrower check and the
application's the stricter one. Accounts created before folding that differ only outside ASCII
are left as they are, and :func:`find_by_username` picks between them the same
way every time.
"""
import datetime
import logging
import re
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.orm import Query, Session

from .models import User
from .models.dialect import is_postgres
from .sql_functions import fold_text

logger = logging.getLogger("grimoire.users")

INDEX_NAME = "ix_users_username_lower"

#: The shortest and longest username an account can be given. The longest is
#: the column's width.
USERNAME_MIN_LENGTH = 2
USERNAME_MAX_LENGTH = 100

_CONTROL = re.compile("[\x00-\x1f\x7f-\x9f]")


def clean_username(raw: str) -> str:
    """A username as an account is given it - trimmed - or ``ValueError``.

    The one rule for every way a name is chosen: setup, an admin creating an
    account, and a guest converted to one. Blank names (which all fold to one,
    so the second was refused by the database), and control characters (a NUL
    PostgreSQL would drop), are refused.
    """
    name = (raw or "").strip()
    if len(name) < USERNAME_MIN_LENGTH:
        raise ValueError(f"Username must be at least {USERNAME_MIN_LENGTH} characters")
    if len(name) > USERNAME_MAX_LENGTH:
        raise ValueError(f"Username must be at most {USERNAME_MAX_LENGTH} characters")
    if _CONTROL.search(name):
        raise ValueError("Username must not contain control characters")
    return name

# SQLite's lower(): A-Z only.
_ASCII_LOWER = str.maketrans("ABCDEFGHIJKLMNOPQRSTUVWXYZ", "abcdefghijklmnopqrstuvwxyz")


def fold_username(username: Optional[str]) -> Optional[str]:
    """``username`` as usernames are compared: trimmed, NFKC, case-folded."""
    return fold_text(username.strip()) if username is not None else None


def match_username(query: "Query[User]", username: str) -> Optional[User]:
    """The account in ``query`` whose username folds to the same as ``username``.

    If several do (only possible for accounts made before folding), the exact
    spelling wins, then the one SQLite's ASCII ``lower()`` matched - which is
    the account this name reached before - then the oldest, so the same name
    always reaches the same account.
    """
    typed = username.strip()
    if not typed:
        return None
    candidates = query.filter(User.username_folded == fold_username(typed)).all()
    if len(candidates) <= 1:
        return candidates[0] if candidates else None
    oldest = datetime.datetime.min

    def preference(user: User) -> tuple:
        return (
            user.username != typed,
            # What sign-in compared before: SQLite's lower() on the stored name.
            user.username.translate(_ASCII_LOWER) != typed.lower(),
            user.created_at or oldest,
            user.id,
        )

    return min(candidates, key=preference)


def find_by_username(db: Session, username: str) -> Optional[User]:
    """The account with this username, compared without regard to case."""
    return match_username(db.query(User), username)


def username_taken(db: Session, username: str, exclude_id: Optional[str] = None) -> bool:
    """Whether another account already has this username in any case."""
    found = find_by_username(db, username)
    return found is not None and found.id != exclude_id


def ensure_unique_index(conn: Any) -> bool:
    """Create the case-insensitive unique index, unless duplicates prevent it.

    Returns whether the index exists afterwards. Accounts that differ only in
    case (possible before this check existed) are logged rather than failing
    start-up; the index is created on the first start after they are renamed.
    """
    if is_postgres(conn):
        lookup = "SELECT 1 FROM pg_indexes WHERE indexname = :n"
    else:
        lookup = "SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :n"
    if conn.execute(text(lookup), {"n": INDEX_NAME}).first():
        return True
    # Grouped in Python: the database's own lower() decides what clashes, but the
    # string aggregate differs by dialect (group_concat / string_agg).
    by_lower: dict[str, list[str]] = {}
    for lowered, name in conn.execute(text("SELECT lower(username), username FROM users")):
        by_lower.setdefault(lowered, []).append(name)
    duplicates = [names for names in by_lower.values() if len(names) > 1]
    if duplicates:
        for names in duplicates:
            logger.warning(
                "Accounts whose usernames differ only in case: %s. Rename all but "
                "one in Settings > Users; usernames are case-insensitive.",
                ", ".join(sorted(names)),
            )
        return False
    conn.execute(text(f"CREATE UNIQUE INDEX {INDEX_NAME} ON users (lower(username))"))
    return True
