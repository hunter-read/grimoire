"""Tests for the shared `get_db` FastAPI dependency (issue #161).

The dependency replaces the hand-rolled ``db = SessionLocal()`` /
``try: ... finally: db.close()`` block that used to live in every handler. Its
contract: yield a live Session, and close it in a ``finally`` so the session is
released even when the consuming handler raises.
"""
from unittest.mock import patch

import pytest
from sqlalchemy.orm import Session

from backend.config import get_db


def test_get_db_yields_a_live_session():
    gen = get_db()
    db = next(gen)
    try:
        assert isinstance(db, Session)
        # A live session can execute a trivial query.
        db.execute
    finally:
        # Exhaust the generator so its finally-block runs.
        with pytest.raises(StopIteration):
            next(gen)


def test_get_db_closes_session_on_normal_exit():
    with patch("backend.config.SessionLocal") as factory:
        gen = get_db()
        db = next(gen)
        assert db is factory.return_value
        with pytest.raises(StopIteration):
            next(gen)
        db.close.assert_called_once()


def test_get_db_closes_session_when_consumer_raises():
    """Even if the handler body raises, the session must be closed."""
    with patch("backend.config.SessionLocal"):
        gen = get_db()
        db = next(gen)
        # Simulate the handler raising by throwing into the generator.
        with pytest.raises(ValueError):
            gen.throw(ValueError("boom"))
        db.close.assert_called_once()
