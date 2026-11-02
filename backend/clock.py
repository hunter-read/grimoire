"""The current time in the form the database stores it.

Kept free of other imports so the background threads (scheduler, session
purger and creator) can use it without loading the models package.
"""
import datetime


def utcnow_naive() -> datetime.datetime:
    """Now in UTC with no offset, as SQLite hands a ``DateTime`` column back.

    For comparing with, or storing beside, values read from the database: an
    aware datetime compared with a naive one raises TypeError. Replaces
    ``datetime.utcnow()``, which Python has deprecated.
    """
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)
