"""The Valkey-then-disk render cache shared by page and tile renders."""
import asyncio
import os
from unittest.mock import MagicMock

import pytest

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
        monkeypatch.setattr(_render_cache, "_valkey", None)
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
        monkeypatch.setattr(_render_cache, "_valkey", fake)
        render = MagicMock()
        assert _body(_serve(cache_path, render)) == b"from-valkey"
        render.assert_not_called()

    def test_a_valkey_error_falls_through_to_rendering(self, cache_path, monkeypatch):
        fake = MagicMock()
        fake.get.side_effect = ConnectionError("down")
        monkeypatch.setattr(_render_cache, "_valkey", fake)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)
        assert _body(_serve(cache_path, lambda: b"fresh")) == b"fresh"

    def test_a_disk_hit_warms_valkey(self, cache_path, monkeypatch):
        with open(cache_path, "wb") as f:
            f.write(b"cached")
        fake = MagicMock()
        fake.get.return_value = None
        stored = {}
        monkeypatch.setattr(_render_cache, "_valkey", fake)
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
        monkeypatch.setattr(_render_cache, "_valkey", fake)
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
        monkeypatch.setattr(_render_cache, "_valkey", fake)
        monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: True)
        assert _body(_serve(cache_path, lambda: b"fresh")) == b"fresh"
        assert not os.path.exists(cache_path)
