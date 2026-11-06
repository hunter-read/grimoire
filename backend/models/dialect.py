"""Which database the app is talking to: SQLite (the default) or PostgreSQL.

Most code is dialect-neutral through SQLAlchemy. The few places that are not -
full-text search, a handful of JSON functions, lock handling, start-up - ask
here rather than sniffing URLs themselves.
"""
from typing import Any

POSTGRES = "postgresql"
SQLITE = "sqlite"


def dialect_name(bind: Any) -> str:
    """The dialect name of a Session, Connection or Engine ("sqlite" or "postgresql")."""
    get_bind = getattr(bind, "get_bind", None)
    if callable(get_bind):
        bind = get_bind()
    return str(bind.dialect.name)


def is_postgres(bind: Any) -> bool:
    """True when ``bind`` (a Session, Connection or Engine) is PostgreSQL."""
    return dialect_name(bind) == POSTGRES


def is_database_url(target: str) -> bool:
    """True for a SQLAlchemy URL, False for a bare SQLite file path."""
    return "://" in target
