"""Tests for the Valkey page-cache TTL and the startup purge.

Rendered pages are a regenerable cache, so they expire (they used to be written
with no TTL and accumulated forever) and are dropped on startup — their keys
carry no content hash, so a file replaced while the server was down would
otherwise be served stale behind an immutable Cache-Control header.
"""
from unittest.mock import MagicMock

from backend import config


class _FakeValkey:
    """Minimal stand-in recording set/scan/unlink calls."""

    def __init__(self, keys=None, unlink_raises=False):
        self.store = dict.fromkeys(keys or [], b"x")
        self.sets: list = []
        self.unlinked: list = []
        self.deleted: list = []
        self._unlink_raises = unlink_raises

    def set(self, key, value, ex=None):
        self.sets.append((key, value, ex))
        self.store[key] = value

    def scan_iter(self, match=None, count=None):
        prefix = (match or "*").rstrip("*")
        # Snapshot: deleting while iterating the live dict would raise.
        return list(k for k in list(self.store) if k.startswith(prefix))

    def unlink(self, *keys):
        if self._unlink_raises:
            raise RuntimeError("UNLINK unsupported")
        self.unlinked.extend(keys)
        for k in keys:
            self.store.pop(k, None)
        return len(keys)

    def delete(self, *keys):
        self.deleted.extend(keys)
        for k in keys:
            self.store.pop(k, None)
        return len(keys)


class TestValkeyCacheSet:
    def test_applies_the_configured_ttl(self, monkeypatch):
        fake = _FakeValkey()
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(config, "PAGE_CACHE_TTL", 3600)
        assert config.valkey_cache_set("page:b:1:1200", b"webp") is True
        assert fake.sets == [("page:b:1:1200", b"webp", 3600)]

    def test_zero_ttl_writes_without_expiry(self, monkeypatch):
        fake = _FakeValkey()
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(config, "PAGE_CACHE_TTL", 0)
        config.valkey_cache_set("page:b:1:1200", b"webp")
        assert fake.sets == [("page:b:1:1200", b"webp", None)]

    def test_returns_false_without_valkey(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        assert config.valkey_cache_set("page:b:1:1200", b"webp") is False

    def test_returns_false_and_swallows_errors(self, monkeypatch):
        fake = MagicMock()
        fake.set.side_effect = RuntimeError("connection reset")
        monkeypatch.setattr(config, "_valkey", fake)
        monkeypatch.setattr(config, "PAGE_CACHE_TTL", 60)
        # Caller falls back to the disk cache rather than losing the render.
        assert config.valkey_cache_set("page:b:1:1200", b"webp") is False


class TestPurgeValkeyPageCache:
    def test_removes_book_and_map_page_keys(self, monkeypatch):
        fake = _FakeValkey(["page:b1:1:1200", "page:b1:2:1200", "mappage:/m.pdf:1:900"])
        monkeypatch.setattr(config, "_valkey", fake)
        assert config.purge_valkey_page_cache() == 3
        assert fake.store == {}

    def test_preserves_scan_state_keys(self, monkeypatch):
        # Scan status/stop flags live under "grimoire:" and must survive — a
        # purge that wiped them would clobber a running scan's state.
        fake = _FakeValkey(
            ["page:b1:1:1200", "grimoire:scan_status", "grimoire:scan_stop"]
        )
        monkeypatch.setattr(config, "_valkey", fake)
        assert config.purge_valkey_page_cache() == 1
        assert set(fake.store) == {"grimoire:scan_status", "grimoire:scan_stop"}

    def test_noop_without_valkey(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        assert config.purge_valkey_page_cache() == 0

    def test_returns_zero_when_cache_empty(self, monkeypatch):
        fake = _FakeValkey([])
        monkeypatch.setattr(config, "_valkey", fake)
        assert config.purge_valkey_page_cache() == 0

    def test_falls_back_to_del_when_unlink_unsupported(self, monkeypatch):
        fake = _FakeValkey(["page:b1:1:1200"], unlink_raises=True)
        monkeypatch.setattr(config, "_valkey", fake)
        assert config.purge_valkey_page_cache() == 1
        assert fake.deleted == ["page:b1:1:1200"]

    def test_survives_a_scan_failure(self, monkeypatch):
        fake = MagicMock()
        fake.scan_iter.side_effect = RuntimeError("connection lost")
        monkeypatch.setattr(config, "_valkey", fake)
        # Startup must not be blocked by an unreachable cache.
        assert config.purge_valkey_page_cache() == 0

    def test_batches_large_key_sets(self, monkeypatch):
        fake = _FakeValkey([f"page:b:{i}:1200" for i in range(1200)])
        monkeypatch.setattr(config, "_valkey", fake)
        assert config.purge_valkey_page_cache() == 1200
        assert fake.store == {}
