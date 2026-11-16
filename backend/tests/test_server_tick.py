"""uvicorn's housekeeping loop, slowed to once a second (backend/server_tick.py)."""
import asyncio

import pytest
from uvicorn.server import Server

from backend import server_tick


@pytest.fixture
def stock_loop():
    """Run a test against uvicorn's own loop, and put back whatever was there.

    The app's lifespan may already have replaced it earlier in the session.
    """
    original = Server.main_loop
    if original is server_tick._main_loop:
        Server.main_loop = server_tick._stock_main_loop
    yield
    Server.main_loop = original


class TestSlowDown:
    def test_replaces_the_pinned_uvicorn_loop(self, stock_loop):
        # Fails when a uvicorn upgrade reshapes main_loop: read the new one and
        # update _is_stock_loop, or the idle server goes back to 10 wake-ups/s.
        assert server_tick._is_stock_loop(Server)
        assert server_tick.slow_down() is True
        assert Server.main_loop is server_tick._main_loop
        assert server_tick.slow_down() is True  # idempotent

    def test_leaves_an_unfamiliar_loop_alone(self, stock_loop):
        async def main_loop(self):
            await asyncio.sleep(5)

        Server.main_loop = main_loop
        assert server_tick.slow_down() is False
        assert Server.main_loop is main_loop

    def test_a_loop_without_source_is_unfamiliar(self):
        class Opaque:
            main_loop = len

        assert server_tick._is_stock_loop(Opaque) is False

    def test_without_uvicorn_does_nothing(self, monkeypatch):
        import sys

        monkeypatch.setitem(sys.modules, "uvicorn.server", None)
        assert server_tick.slow_down() is False


class TestMainLoop:
    def test_ticks_once_a_second_with_counts_uvicorn_treats_as_whole_seconds(self, monkeypatch):
        sleeps = []

        async def fake_sleep(seconds):
            sleeps.append(seconds)

        monkeypatch.setattr(server_tick.asyncio, "sleep", fake_sleep)

        class FakeServer:
            def __init__(self):
                self.counters = []

            async def on_tick(self, counter):
                self.counters.append(counter)
                return len(self.counters) == 4

        server = FakeServer()
        asyncio.run(server_tick._main_loop(server))
        assert server.counters == [0, 10, 20, 30]
        assert all(c % 10 == 0 for c in server.counters)
        assert sleeps == [1.0, 1.0, 1.0]

    def test_exits_at_once_when_the_first_tick_says_so(self):
        class FakeServer:
            async def on_tick(self, counter):
                return True

        asyncio.run(server_tick._main_loop(FakeServer()))

    def test_the_counter_wraps(self, monkeypatch):
        async def fake_sleep(seconds):
            return None

        monkeypatch.setattr(server_tick.asyncio, "sleep", fake_sleep)
        monkeypatch.setattr(server_tick, "_COUNT_WRAP", 30)

        class FakeServer:
            def __init__(self):
                self.counters = []

            async def on_tick(self, counter):
                self.counters.append(counter)
                return len(self.counters) == 5

        server = FakeServer()
        asyncio.run(server_tick._main_loop(server))
        assert server.counters == [0, 10, 20, 0, 10]
