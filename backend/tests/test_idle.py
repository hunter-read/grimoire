"""The idle memory release (backend/idle.py)."""
import asyncio
import threading
import time

import pytest

from backend import idle


@pytest.fixture(autouse=True)
def _reset_idle():
    yield
    idle.stop()
    idle._released = False
    idle._wake.clear()


def _wait_for(predicate, timeout=5.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if predicate():
            return True
        time.sleep(0.01)
    return False


class TestSecondsUntilIdle:
    def test_counts_down_from_the_last_request(self):
        idle.note_request()
        last = idle._last_request
        assert idle.seconds_until_idle(60, now=last) == 60
        assert idle.seconds_until_idle(60, now=last + 45) == 15
        assert idle.seconds_until_idle(60, now=last + 90) == -30


class TestReleaseMemory:
    def test_collects_garbage_and_reclaims(self, monkeypatch):
        calls = []
        monkeypatch.setattr(idle.gc, "collect", lambda: calls.append("gc"))
        monkeypatch.setattr(
            "backend.render.memory.reclaim_render_memory", lambda: calls.append("reclaim")
        )
        idle.release_memory()
        assert calls == ["gc", "reclaim"]


class TestIdleThread:
    def test_releases_once_idle_then_waits_for_a_request(self, monkeypatch):
        released = []
        monkeypatch.setattr(idle, "release_memory", lambda: released.append(time.monotonic()))
        idle.start(0.05)
        assert _wait_for(lambda: len(released) == 1)
        # Parked: staying idle does not release again.
        time.sleep(0.2)
        assert len(released) == 1
        assert idle._released is True

        # A request wakes it, and the next quiet spell releases again.
        idle.note_request()
        assert idle._released is False
        assert _wait_for(lambda: len(released) == 2)

    def test_requests_keep_pushing_the_deadline_back(self, monkeypatch):
        released = []
        monkeypatch.setattr(idle, "release_memory", lambda: released.append(1))
        idle.start(0.3)
        for _ in range(6):
            time.sleep(0.1)
            idle.note_request()
        assert released == []
        assert _wait_for(lambda: released == [1])

    def test_a_request_during_the_release_is_not_lost(self, monkeypatch):
        released = []

        def slow_release():
            released.append(1)
            if len(released) == 1:
                idle.note_request()  # arrives while _released is still False

        monkeypatch.setattr(idle, "release_memory", slow_release)
        idle.start(0.05)
        # Had the thread parked after the first release, nothing would wake it.
        assert _wait_for(lambda: len(released) >= 2)

    def test_a_failing_release_does_not_end_the_thread(self, monkeypatch):
        attempts = []

        def boom():
            attempts.append(1)
            raise RuntimeError("no")

        monkeypatch.setattr(idle, "release_memory", boom)
        idle.start(0.05)
        assert _wait_for(lambda: len(attempts) == 1)
        idle.note_request()
        assert _wait_for(lambda: len(attempts) == 2)
        assert idle._thread is not None and idle._thread.is_alive()

    def test_zero_turns_it_off(self):
        idle.start(0)
        assert idle._thread is None

    def test_start_twice_keeps_one_thread_and_stop_ends_it(self, monkeypatch):
        monkeypatch.setattr(idle, "release_memory", lambda: None)
        idle.start(60)
        first = idle._thread
        idle.start(60)
        assert idle._thread is first
        idle.stop()
        assert idle._thread is None
        assert not first.is_alive()
        assert "grimoire-idle-release" not in {t.name for t in threading.enumerate()}


class TestMiddleware:
    @staticmethod
    def _call(path, scope_type="http"):
        seen = []

        async def app(scope, receive, send):
            seen.append(scope["path"])

        middleware = idle.IdleTrackingMiddleware(app)
        asyncio.run(middleware({"type": scope_type, "path": path}, None, None))
        return seen

    def test_a_request_counts_as_use(self, monkeypatch):
        noted = []
        monkeypatch.setattr(idle, "note_request", lambda: noted.append(1))
        assert self._call("/api/books") == ["/api/books"]
        assert noted == [1]

    def test_the_health_probe_does_not(self, monkeypatch):
        noted = []
        monkeypatch.setattr(idle, "note_request", lambda: noted.append(1))
        assert self._call("/api/health") == ["/api/health"]
        assert noted == []

    def test_non_http_scopes_pass_through(self, monkeypatch):
        noted = []
        monkeypatch.setattr(idle, "note_request", lambda: noted.append(1))
        assert self._call("/", scope_type="lifespan") == ["/"]
        assert noted == []

    def test_the_app_has_it_installed(self):
        from backend.main import app

        assert any(m.cls is idle.IdleTrackingMiddleware for m in app.user_middleware)
