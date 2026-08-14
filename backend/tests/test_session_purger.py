"""Tests for the background auth-session purge thread (issue #157)."""
import datetime
import os
import tempfile
import threading
import time

import pytest

from backend import session_purger
from backend.config import SessionLocal
from backend.models import AuthSession, User
from backend.sessions import create_session, revoke_session


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


@pytest.fixture
def lock_dir():
    with tempfile.TemporaryDirectory() as path:
        yield path


@pytest.fixture(autouse=True)
def _stop_purger():
    """Never leave a thread or a held lock behind for the next test."""
    yield
    session_purger.stop()


@pytest.fixture
def purge_user(db):
    """A throwaway user written straight to the DB.

    Deliberately does not go through /api/auth/setup or the shared account
    fixtures: these tests only need a valid users.id to hang sessions off, and
    staying off the HTTP fixtures keeps the file runnable in any order.
    """
    user = User(username=f"purge_{os.urandom(4).hex()}", role="player")
    db.add(user)
    db.commit()
    db.refresh(user)
    yield user
    db.query(AuthSession).filter_by(user_id=user.id).delete(synchronize_session=False)
    db.delete(user)
    db.commit()


class TestPurgeOnce:
    def test_removes_long_expired_sessions(self, db, purge_user):
        session, _ = create_session(db, purge_user.id)
        session.expires_at = datetime.datetime.utcnow() - datetime.timedelta(days=60)
        db.commit()
        session_id = session.id

        session_purger._purge_once()

        db.expire_all()
        assert db.query(AuthSession).filter_by(id=session_id).first() is None

    def test_keeps_live_sessions(self, db, purge_user):
        session, _ = create_session(db, purge_user.id)
        session_id = session.id

        session_purger._purge_once()

        db.expire_all()
        assert db.query(AuthSession).filter_by(id=session_id).first() is not None

    def test_keeps_recently_revoked_sessions(self, db, purge_user):
        """Kept inside the retention window so token reuse stays detectable."""
        session, _ = create_session(db, purge_user.id)
        revoke_session(db, session)
        session_id = session.id

        session_purger._purge_once()

        db.expire_all()
        assert db.query(AuthSession).filter_by(id=session_id).first() is not None

    def test_removes_sessions_revoked_beyond_the_retention_window(self, db, purge_user):
        session, _ = create_session(db, purge_user.id)
        revoke_session(db, session)
        session.revoked_at = datetime.datetime.utcnow() - datetime.timedelta(
            days=session_purger.RETAIN_DAYS + 1
        )
        db.commit()
        session_id = session.id

        session_purger._purge_once()

        db.expire_all()
        assert db.query(AuthSession).filter_by(id=session_id).first() is None


class TestWorkerLock:
    def test_only_one_worker_claims_the_lock(self, lock_dir):
        assert session_purger._acquire_lock(lock_dir) is True
        # A second acquire in the same process still holds the same fd, so
        # simulate the second worker from a child process instead.
        pid = os.fork()
        if pid == 0:  # child
            # flock is per-open-file-description, so the child must open its own.
            session_purger._lock_file = None
            got = session_purger._acquire_lock(lock_dir)
            os._exit(1 if got else 0)
        _, status = os.waitpid(pid, 0)
        assert os.WEXITSTATUS(status) == 0, "second worker should not get the lock"

    def test_lock_is_released_on_stop(self, lock_dir):
        assert session_purger._acquire_lock(lock_dir) is True
        session_purger.stop()

        pid = os.fork()
        if pid == 0:
            session_purger._lock_file = None
            got = session_purger._acquire_lock(lock_dir)
            os._exit(0 if got else 1)
        _, status = os.waitpid(pid, 0)
        assert os.WEXITSTATUS(status) == 0, "lock should be free after stop()"

    def test_start_skips_when_another_worker_holds_the_lock(self, lock_dir, monkeypatch):
        held = open(os.path.join(lock_dir, ".session_purge.lock"), "w")
        import fcntl

        fcntl.flock(held, fcntl.LOCK_EX | fcntl.LOCK_NB)
        try:
            ran = threading.Event()
            monkeypatch.setattr(session_purger, "_purge_once", lambda: ran.set())

            session_purger.start(lock_dir)

            assert not ran.wait(0.3)
            assert session_purger._thread is None
        finally:
            fcntl.flock(held, fcntl.LOCK_UN)
            held.close()

    def test_unwritable_lock_path_does_not_start(self, monkeypatch):
        assert session_purger._acquire_lock("/nonexistent/path/for/grimoire") is False


class TestThreadLifecycle:
    def test_start_runs_a_purge_immediately(self, lock_dir, monkeypatch):
        ran = threading.Event()
        monkeypatch.setattr(session_purger, "_purge_once", lambda: ran.set())

        session_purger.start(lock_dir)

        assert ran.wait(2), "startup purge should run without waiting for the interval"

    def test_stop_ends_the_thread(self, lock_dir, monkeypatch):
        monkeypatch.setattr(session_purger, "_purge_once", lambda: None)
        session_purger.start(lock_dir)
        thread = session_purger._thread
        assert thread is not None

        session_purger.stop()

        assert session_purger._thread is None
        assert not thread.is_alive()

    def test_a_failing_pass_does_not_kill_the_thread(self, lock_dir, monkeypatch):
        """An unpurged table is a slow leak; a dead thread is a permanent one."""
        calls = []

        def boom():
            calls.append(1)
            raise RuntimeError("database on fire")

        monkeypatch.setattr(session_purger, "_purge_once", boom)
        # Wake the loop immediately instead of sleeping a day.
        monkeypatch.setattr(session_purger, "_PURGE_INTERVAL_SECONDS", 0.05)

        session_purger.start(lock_dir)
        time.sleep(0.3)

        assert len(calls) > 1, "loop should keep running after a failure"
        assert session_purger._thread.is_alive()


class TestNextRunAfter:
    def test_is_one_interval_ahead(self):
        now = datetime.datetime(2026, 8, 13, 4, 0, 0)
        assert session_purger.next_run_after(now) == now + datetime.timedelta(days=1)

    def test_defaults_to_now(self):
        assert session_purger.next_run_after() > datetime.datetime.utcnow()
