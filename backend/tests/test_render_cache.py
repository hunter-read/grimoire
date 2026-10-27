"""The Valkey-then-disk render cache shared by page and tile renders."""
import asyncio
import os
import threading
from unittest.mock import MagicMock

import pytest
from fastapi import HTTPException

from backend import config
from backend.routers.books import _render_cache


@pytest.fixture
def cache_path(tmp_path):
    return str(tmp_path / "render.webp")


def _serve(cache_path, render):
    return _render_cache.serve_cached_render("page:k", cache_path, {"ETag": '"e"'}, render)


def _body(resp):
    if hasattr(resp, "body_iterator"):

        async def read():
            return b"".join([chunk async for chunk in resp.body_iterator])

        return asyncio.run(read())
    with open(resp.path, "rb") as f:
        return f.read()


class TestWithoutValkey:
    @pytest.fixture(autouse=True)
    def no_valkey(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)

    def test_renders_and_writes_the_disk_cache(self, cache_path):
        resp = _serve(cache_path, lambda: b"fresh")
        assert _body(resp) == b"fresh"
        assert resp.headers["etag"] == '"e"'
        with open(cache_path, "rb") as f:
            assert f.read() == b"fresh"

    def test_serves_the_disk_cache_without_rendering(self, cache_path):
        with open(cache_path, "wb") as f:
            f.write(b"cached")
        render = MagicMock()
        assert _body(_serve(cache_path, render)) == b"cached"
        render.assert_not_called()


class TestWithValkey:
    def test_a_valkey_hit_is_served_as_is(self, cache_path, monkeypatch):
        fake = MagicMock()
        fake.get.return_value = b"from-valkey"
        monkeypatch.setattr(config, "_valkey", fake)
        render = MagicMock()
        assert _body(_serve(cache_path, render)) == b"from-valkey"
        render.assert_not_called()

    def test_a_valkey_error_falls_through_to_rendering(self, cache_path, monkeypatch):
        fake = MagicMock()
        fake.get.side_effect = ConnectionError("down")
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)
        assert _body(_serve(cache_path, lambda: b"fresh")) == b"fresh"

    def test_a_disk_hit_warms_valkey(self, cache_path, monkeypatch):
        with open(cache_path, "wb") as f:
            f.write(b"cached")
        fake = MagicMock()
        fake.get.return_value = None
        stored = {}
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(
            _render_cache, "valkey_cache_set", lambda k, v: stored.update({k: v}) or True
        )
        assert _body(_serve(cache_path, MagicMock())) == b"cached"
        assert stored == {"page:k": b"cached"}

    def test_an_unreadable_disk_entry_still_serves(self, cache_path, monkeypatch):
        with open(cache_path, "wb") as f:
            f.write(b"cached")
        fake = MagicMock()
        fake.get.return_value = None
        monkeypatch.setattr(config, "_valkey", fake)
        real_open = open

        def flaky_open(path, mode="r", *a, **k):
            if path == cache_path and "r" in mode:
                raise OSError("busy")
            return real_open(path, mode, *a, **k)

        monkeypatch.setattr("builtins.open", flaky_open)
        resp = _serve(cache_path, MagicMock())
        monkeypatch.setattr("builtins.open", real_open)
        assert resp.path == cache_path

    def test_a_fresh_render_goes_to_valkey_not_disk(self, cache_path, monkeypatch):
        fake = MagicMock()
        fake.get.return_value = None
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: True)
        assert _body(_serve(cache_path, lambda: b"fresh")) == b"fresh"
        assert not os.path.exists(cache_path)


class TestSingleFlight:
    """A miss renders once, however many requests arrive for it (issue #640)."""

    @pytest.fixture(autouse=True)
    def no_valkey(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)

    def test_concurrent_misses_share_one_render(self, cache_path):
        started = threading.Event()
        release = threading.Event()
        calls = []

        def render():
            calls.append(1)
            started.set()
            assert release.wait(5)
            return b"fresh"

        bodies = []

        def request():
            bodies.append(_body(_serve(cache_path, render)))

        first = threading.Thread(target=request)
        first.start()
        assert started.wait(5)
        # The second request arrives while the first is still rendering, the way
        # a click lands on a page the prefetch already asked for.
        second = threading.Thread(target=request)
        second.start()
        release.set()
        first.join(5)
        second.join(5)
        assert len(calls) == 1
        assert bodies == [b"fresh", b"fresh"]
        assert _render_cache._inflight == {}

    def test_different_keys_render_independently(self, tmp_path):
        rendered = []
        for key in ("page:a", "page:b"):
            _render_cache.serve_cached_render(
                key, str(tmp_path / f"{key}.webp"), {}, lambda k=key: rendered.append(k) or b"x"
            )
        assert rendered == ["page:a", "page:b"]

    def test_a_failed_render_releases_the_key(self, cache_path):
        def boom():
            raise RuntimeError("worker died")

        with pytest.raises(RuntimeError):
            _serve(cache_path, boom)
        assert _render_cache._inflight == {}
        # The next request tries again rather than waiting on a dead render.
        assert _body(_serve(cache_path, lambda: b"retry")) == b"retry"


class TestAdmission:
    """Misses past RENDER_QUEUE_LIMIT are refused with a 503 (issue #701)."""

    @pytest.fixture(autouse=True)
    def no_valkey(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)
        monkeypatch.setattr(config, "RENDER_QUEUE_LIMIT", 1)

    def _hold(self, tmp_path, key="page:held"):
        """Start a render of ``key`` that runs until the returned event is set."""
        started, release = threading.Event(), threading.Event()

        def render():
            started.set()
            assert release.wait(5)
            return b"held"

        thread = threading.Thread(
            target=_render_cache.serve_cached_render,
            args=(key, str(tmp_path / "held.webp"), {}, render),
        )
        thread.start()
        assert started.wait(5)
        return thread, release

    def test_a_miss_over_the_limit_is_a_503(self, tmp_path):
        thread, release = self._hold(tmp_path)
        try:
            with pytest.raises(HTTPException) as exc:
                _render_cache.serve_cached_render(
                    "page:other", str(tmp_path / "other.webp"), {}, lambda: b"never"
                )
            assert exc.value.status_code == 503
            assert exc.value.headers["Retry-After"] == str(_render_cache.RETRY_AFTER)
        finally:
            release.set()
            thread.join(5)
        assert _render_cache._admitted == 0
        # With room again, the same miss renders.
        resp = _render_cache.serve_cached_render(
            "page:other", str(tmp_path / "other.webp"), {}, lambda: b"now"
        )
        assert _body(resp) == b"now"

    def test_waiting_on_the_same_key_counts_too(self, tmp_path):
        """A request for a page already rendering still holds a thread while it waits."""
        thread, release = self._hold(tmp_path)
        try:
            with pytest.raises(HTTPException):
                _render_cache.serve_cached_render(
                    "page:held", str(tmp_path / "held.webp"), {}, lambda: b"never"
                )
        finally:
            release.set()
            thread.join(5)

    def test_a_cache_hit_is_never_refused(self, tmp_path):
        cached = tmp_path / "cached.webp"
        cached.write_bytes(b"cached")
        thread, release = self._hold(tmp_path)
        try:
            resp = _render_cache.serve_cached_render("page:cached", str(cached), {}, lambda: b"x")
            assert _body(resp) == b"cached"
        finally:
            release.set()
            thread.join(5)

    def test_a_failed_render_gives_its_place_back(self, cache_path):
        def boom():
            raise RuntimeError("worker died")

        with pytest.raises(RuntimeError):
            _serve(cache_path, boom)
        assert _render_cache._admitted == 0


class TestDiskWrite:
    def test_leaves_no_temp_file_behind(self, tmp_path):
        path = str(tmp_path / "page.webp")
        _render_cache._write_disk_cache(path, b"data")
        assert os.listdir(tmp_path) == ["page.webp"]
        with open(path, "rb") as f:
            assert f.read() == b"data"

    def test_a_failed_write_removes_its_temp_file(self, tmp_path, monkeypatch):
        path = str(tmp_path / "page.webp")

        def no_replace(*_a):
            raise OSError("disk full")

        monkeypatch.setattr(_render_cache.os, "replace", no_replace)
        with pytest.raises(OSError):
            _render_cache._write_disk_cache(path, b"data")
        assert os.listdir(tmp_path) == []

    def test_a_temp_file_that_cannot_be_removed_still_raises(self, tmp_path, monkeypatch):
        path = str(tmp_path / "missing-dir" / "page.webp")
        # The open itself fails, so there is no temp file to remove either.
        with pytest.raises(OSError):
            _render_cache._write_disk_cache(path, b"data")
