"""The scan's database steps run on the thread that owns the Session (issue #702).

The scan used to commit on a helper thread and roll the same Session back from
the caller when the helper overran, which could raise ``IllegalStateChangeError``
or drive one sqlite3 connection from two threads. These tests pin the
replacement: every step runs where it was called, and a database that stays
locked costs a clean rollback rather than a crashed scan.
"""
import os
import sqlite3
import tempfile
import threading
import uuid
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.exc import IntegrityError, OperationalError
from sqlalchemy.orm import Session

from backend.config import SessionLocal
from backend.indexer import _commit, scan_library
from backend.indexer._db import DatabaseBusyError, _db_call, is_busy
from backend.models import AppSetting, Book


def _locked(message: str = "database is locked") -> OperationalError:
    return OperationalError("COMMIT", {}, sqlite3.OperationalError(message))


def _session(nested=None) -> MagicMock:
    """A stand-in Session, with or without an open savepoint."""
    session = MagicMock(spec=Session)
    session.get_nested_transaction.return_value = nested
    return session


class TestDbCall:
    def test_runs_on_the_calling_thread_and_returns_the_result(self):
        seen = []

        def step():
            seen.append(threading.get_ident())
            return 42

        session = _session()
        assert _db_call(step, "step", session) == 42
        assert seen == [threading.get_ident()]
        session.rollback.assert_not_called()

    @pytest.mark.parametrize(
        "message", ["database is locked", "database table is locked", "Database is busy"]
    )
    def test_a_lock_timeout_becomes_database_busy(self, message):
        def step():
            raise _locked(message)

        with pytest.raises(DatabaseBusyError, match="commit book 'x.pdf'") as info:
            _db_call(step, "commit book 'x.pdf'", _session())
        assert isinstance(info.value.__cause__, OperationalError)

    def test_a_busy_step_rolls_the_session_back_before_raising(self):
        """So a caller that skips to the next file cannot forget to (on
        PostgreSQL the failed statement has aborted the transaction)."""
        session = _session()

        def step():
            raise _locked()

        with pytest.raises(DatabaseBusyError):
            _db_call(step, "step", session)
        session.rollback.assert_called_once_with()

    def test_inside_a_savepoint_only_the_savepoint_is_rolled_back(self):
        savepoint = MagicMock()
        session = _session(nested=savepoint)

        def step():
            raise _locked()

        with pytest.raises(DatabaseBusyError):
            _db_call(step, "step", session)
        savepoint.rollback.assert_called_once_with()
        session.rollback.assert_not_called()

    def test_other_operational_errors_pass_through(self):
        def step():
            raise _locked("disk I/O error")

        session = _session()
        with pytest.raises(OperationalError) as info:
            _db_call(step, "step", session)
        assert not isinstance(info.value, DatabaseBusyError)
        session.rollback.assert_not_called()

    @pytest.mark.parametrize("sqlstate", ["55P03", "40P01", "40001"])
    def test_postgres_lock_failures_are_busy(self, sqlstate):
        """lock_timeout, deadlock and serialization failures, by SQLSTATE."""

        class PgError(Exception):
            pass

        orig = PgError("canceling statement due to lock timeout")
        orig.sqlstate = sqlstate
        assert is_busy(OperationalError("UPDATE books", {}, orig))
        orig.sqlstate = "57014"  # query_canceled: not a lock
        assert not is_busy(OperationalError("UPDATE books", {}, orig))

    def test_is_busy_only_matches_operational_errors(self):
        assert is_busy(_locked())
        assert not is_busy(_locked("no such table: books"))
        assert not is_busy(IntegrityError("INSERT", {}, Exception("database is locked")))
        assert not is_busy(RuntimeError("database is locked"))


class TestLockedDatabase:
    """A real write lock held by another connection, not a stub."""

    @pytest.fixture
    def locked_db(self):
        path = os.path.join(tempfile.mkdtemp(), "locked.db")
        # A short busy timeout so the test waits milliseconds, not the app's 30 s.
        engine = create_engine(f"sqlite:///{path}", connect_args={"timeout": 0.05})
        AppSetting.__table__.create(engine)
        holder = sqlite3.connect(path, isolation_level=None)
        session = Session(engine)
        try:
            yield session, holder
        finally:
            session.close()
            holder.close()
            engine.dispose()

    def test_a_commit_blocked_by_another_writer_rolls_back_cleanly(self, locked_db):
        session, holder = locked_db
        holder.execute("BEGIN IMMEDIATE")  # take the write lock and keep it
        session.add(AppSetting(key="scan.probe", value="1"))

        _commit(session, "commit probe")  # must not raise IllegalStateChangeError

        assert not session.new, "the pending row was rolled back"
        holder.execute("ROLLBACK")
        # The Session is still usable once the lock is gone.
        session.add(AppSetting(key="scan.probe", value="2"))
        session.commit()
        assert session.query(AppSetting).filter_by(key="scan.probe").one().value == "2"


def _book_library() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    core = lib / "books" / f"Sys-{os.path.basename(tmp)}" / "core"
    core.mkdir(parents=True)
    (core / "tome.txt").write_text("A short rulebook.\n")
    return tmp, lib


class TestScanThreading:
    def test_every_commit_and_flush_runs_on_the_scanning_thread(self):
        tmp, lib = _book_library()
        threads: set[int] = set()
        db = SessionLocal()
        try:
            for name in ("before_commit", "before_flush"):
                event.listen(db, name, lambda *_a: threads.add(threading.get_ident()))
            stats = scan_library(str(lib), tmp, db)
        finally:
            db.close()

        assert stats["new_books"] == 1
        assert threads == {threading.get_ident()}

    def test_a_locked_database_on_a_book_commit_skips_that_book(self):
        tmp, lib = _book_library()
        from backend.indexer import _book_records

        real = _book_records._db_call

        def locked_book_commit(fn, label, session):
            if label.startswith("commit book"):

                def blocked():
                    raise _locked()

                return real(blocked, label, session)
            return real(fn, label, session)

        db = SessionLocal()
        try:
            with patch.object(_book_records, "_db_call", locked_book_commit):
                stats = scan_library(str(lib), tmp, db)
            assert stats["errors"] >= 1
            assert stats["new_books"] == 0
            assert db.query(Book).filter(Book.filepath.like(f"{lib}%")).count() == 0
        finally:
            db.close()


@pytest.mark.postgres_only
def test_a_postgres_row_lock_timeout_is_busy():
    """A real lock held by another connection, timed out by lock_timeout."""
    from sqlalchemy import text

    from backend.config import SessionLocal

    key = f"busy-{uuid.uuid4().hex}"
    setup = SessionLocal()
    setup.add(AppSetting(key=key, value="0"))
    setup.commit()
    setup.close()
    holder, waiter = SessionLocal(), SessionLocal()
    try:
        holder.execute(text("UPDATE app_settings SET value = '1' WHERE key = :k"), {"k": key})
        waiter.execute(text("SET LOCAL lock_timeout = '50ms'"))

        def step():
            waiter.execute(
                text("UPDATE app_settings SET value = '2' WHERE key = :k"), {"k": key}
            )

        with pytest.raises(DatabaseBusyError):
            _db_call(step, "step", waiter)
        # Rolled back already: the session is usable, not "transaction aborted".
        assert waiter.execute(text("SELECT 1")).scalar() == 1
    finally:
        waiter.rollback()
        holder.rollback()
        waiter.close()
        holder.close()


@pytest.mark.postgres_only
def test_a_postgres_lock_timeout_on_one_folder_leaves_the_rest_of_the_scan_working():
    """On PostgreSQL a statement that hits lock_timeout aborts its transaction.

    Another connection holds a lock on ``books`` while the scan looks up the
    first folder it reaches, so that lookup times out for real. The scan must
    skip that folder and still index the two after it - which needs the Session
    rolled back, or every later query fails with "current transaction is
    aborted".
    """
    from sqlalchemy import text

    from backend.indexer import books as books_mod

    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    system = lib / "books" / f"Sys-{os.path.basename(tmp)}"
    for folder in ("a", "b", "c"):
        (system / folder).mkdir(parents=True)
        (system / folder / f"{folder}-tome.txt").write_text("A short rulebook.\n")

    real = books_mod._db_call
    holder = SessionLocal()
    blocked = []

    def lock_first_folder(fn, label, session):
        if blocked or not label.startswith("query book "):
            return real(fn, label, session)
        blocked.append(label.split("'")[1])
        holder.execute(text("LOCK TABLE books IN ACCESS EXCLUSIVE MODE"))
        try:
            # The app's 30 s lock_timeout, cut short for this transaction only.
            session.execute(text("SET LOCAL lock_timeout = '100ms'"))
            return real(fn, label, session)
        finally:
            holder.rollback()

    db = SessionLocal()
    try:
        with patch.object(books_mod, "_db_call", lock_first_folder):
            stats = scan_library(str(lib), tmp, db)
        indexed = {
            os.path.basename(path)
            for (path,) in db.query(Book.filepath).filter(Book.filepath.like(f"{lib}%"))
        }
    finally:
        db.close()
        holder.close()

    assert blocked, "the scan never looked up a folder"
    assert stats["errors"] >= 1
    skipped = os.path.basename(blocked[0])
    assert indexed == {"a-tome.txt", "b-tome.txt", "c-tome.txt"} - {skipped}
