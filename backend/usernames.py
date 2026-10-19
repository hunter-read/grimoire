"""Usernames are unique regardless of case.

Signing in matches a username case-insensitively, so "Admin" and "admin" have
to be one account: two of them would leave the sign-in form picking one
arbitrarily. Every place that checks whether a name is taken goes through
:func:`username_taken`, and the database backs it with a unique index on
``lower(username)`` (:func:`ensure_unique_index`).
"""
import logging
from typing import Any, Optional

from sqlalchemy import func, text
from sqlalchemy.orm import Session

from .models import User

logger = logging.getLogger("grimoire.users")

INDEX_NAME = "ix_users_username_lower"


def find_by_username(db: Session, username: str) -> Optional[User]:
    """The account with this username, compared without regard to case."""
    return db.query(User).filter(func.lower(User.username) == username.strip().lower()).first()


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
    exists = conn.execute(
        text("SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = :n"),
        {"n": INDEX_NAME},
    ).first()
    if exists:
        return True
    duplicates = conn.execute(
        text(
            "SELECT lower(username), group_concat(username, ', ') FROM users "
            "GROUP BY lower(username) HAVING count(*) > 1"
        )
    ).all()
    if duplicates:
        for _, names in duplicates:
            logger.warning(
                "Accounts whose usernames differ only in case: %s. Rename all but "
                "one in Settings > Users; usernames are case-insensitive.",
                names,
            )
        return False
    conn.execute(text(f"CREATE UNIQUE INDEX {INDEX_NAME} ON users (lower(username))"))
    return True
