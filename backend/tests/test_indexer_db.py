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
from pathlib import Path
from unittest.mock import patch

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


class TestDbCall:
    def test_runs_on_the_calling_thread_and_returns_the_result(self):
        seen = []

        def step():
            seen.append(threading.get_ident())
            return 42

        assert _db_call(step, "step") == 42
        assert seen == [threading.get_ident()]

    @pytest.mark.parametrize(
        "message", ["database is locked", "database table is locked", "Database is busy"]
    )
    def test_a_lock_timeout_becomes_database_busy(self, message):
        def step():
            raise _locked(message)

        with pytest.raises(DatabaseBusyError, match="commit book 'x.pdf'") as info:
            _db_call(step, "commit book 'x.pdf'")
        assert isinstance(info.value.__cause__, OperationalError)

    def test_other_operational_errors_pass_through(self):
        def step():
            raise _locked("disk I/O error")

        with pytest.raises(OperationalError) as info:
            _db_call(step, "step")
        assert not isinstance(info.value, DatabaseBusyError)

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

        def locked_book_commit(fn, label):
            if label.startswith("commit book"):

                def blocked():
                    raise _locked()

                return real(blocked, label)
            return real(fn, label)

        db = SessionLocal()
        try:
            with patch.object(_book_records, "_db_call", locked_book_commit):
                stats = scan_library(str(lib), tmp, db)
            assert stats["errors"] >= 1
            assert stats["new_books"] == 0
            assert db.query(Book).filter(Book.filepath.like(f"{lib}%")).count() == 0
        finally:
            db.close()
