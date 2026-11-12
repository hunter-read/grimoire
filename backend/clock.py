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


def to_naive_utc(value: datetime.datetime) -> datetime.datetime:
    """``value`` as naive UTC, the form a stored ``DateTime`` takes; naive is taken as UTC.

    An offset at the very edge of the calendar has no UTC equivalent -
    ``0001-01-01T00:00+14:00`` falls before ``datetime.min`` - and converting it
    raises OverflowError. Such a value is clamped to the nearest end instead, which
    compares against stored dates the way the unconvertible instant would.
    """
    if value.tzinfo is None:
        return value
    try:
        return value.astimezone(datetime.timezone.utc).replace(tzinfo=None)
    except OverflowError:
        offset = value.utcoffset() or datetime.timedelta(0)
        return datetime.datetime.min if offset > datetime.timedelta(0) else datetime.datetime.max
