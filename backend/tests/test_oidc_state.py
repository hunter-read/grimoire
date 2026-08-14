"""Tests for the OIDC state store / JWKS cache backends (in-memory and Valkey)."""
import json

from unittest.mock import patch

from backend.routers.oidc import _state


class FakeValkey:
    """Minimal stand-in for the redis-py client used by the Valkey backends.

    Stores values with no expiry tracking — TTL enforcement is the server's job,
    so the tests assert we *pass* the right ``ex`` rather than simulating it.
    """

    def __init__(self, supports_getdel=True):
        self.data: dict[str, str] = {}
        self.ttls: dict[str, int] = {}
        self.supports_getdel = supports_getdel

    def set(self, key, value, ex=None):
        self.data[key] = value
        self.ttls[key] = ex

    def get(self, key):
        return self.data.get(key)

    def getdel(self, key):
        if not self.supports_getdel:
            raise Exception("unknown command 'GETDEL'")
        return self.data.pop(key, None)

    def delete(self, key):
        self.data.pop(key, None)


class BrokenValkey:
    """Client whose every operation fails, to exercise the error paths."""

    def set(self, key, value, ex=None):
        raise Exception("valkey down")

    def get(self, key):
        raise Exception("valkey down")


# ---------------------------------------------------------------------------
# State store
# ---------------------------------------------------------------------------


class TestMemoryStateStore:
    def test_put_pop_roundtrip_is_single_use(self):
        store = _state.MemoryStateStore()
        store.put("s1", {"nonce": "n", "code_verifier": "v"})
        popped = store.pop("s1")
        assert popped["nonce"] == "n"
        assert popped["code_verifier"] == "v"
        assert store.pop("s1") is None

    def test_missing_state_returns_none(self):
        assert _state.MemoryStateStore().pop("nope") is None

    def test_expired_state_is_dropped(self):
        store = _state.MemoryStateStore()
        store.put("old", {"nonce": "n"})
        store._d["old"]["_ts"] = 0
        assert store.pop("old") is None

    def test_gc_on_put_drops_other_expired_entries(self):
        store = _state.MemoryStateStore()
        store.put("old", {"nonce": "n"})
        store._d["old"]["_ts"] = 0
        store.put("fresh", {"nonce": "n2"})
        assert "old" not in store._d
        assert store.pop("fresh") is not None


class TestValkeyStateStore:
    def test_put_pop_roundtrip_is_single_use(self):
        fake = FakeValkey()
        store = _state.ValkeyStateStore(fake)
        store.put("s1", {"nonce": "n", "code_verifier": "v"})

        stored = json.loads(fake.data["oidc:state:s1"])
        assert stored["nonce"] == "n"
        assert fake.ttls["oidc:state:s1"] == _state._STATE_TTL

        popped = store.pop("s1")
        assert popped["nonce"] == "n"
        assert popped["code_verifier"] == "v"
        # GETDEL removed it, so a replayed callback finds nothing.
        assert store.pop("s1") is None

    def test_missing_state_returns_none(self):
        assert _state.ValkeyStateStore(FakeValkey()).pop("nope") is None

    def test_falls_back_to_get_delete_without_getdel(self):
        fake = FakeValkey(supports_getdel=False)
        store = _state.ValkeyStateStore(fake)
        store.put("s1", {"nonce": "n"})
        assert store.pop("s1")["nonce"] == "n"
        assert "oidc:state:s1" not in fake.data
        assert store.pop("s1") is None

    def test_undecodable_payload_returns_none(self):
        fake = FakeValkey()
        fake.data["oidc:state:s1"] = "not json"
        assert _state.ValkeyStateStore(fake).pop("s1") is None

    def test_non_dict_payload_returns_none(self):
        fake = FakeValkey()
        fake.data["oidc:state:s1"] = json.dumps(["not", "a", "dict"])
        assert _state.ValkeyStateStore(fake).pop("s1") is None

    def test_state_written_by_one_worker_is_readable_by_another(self):
        # The whole point of the Valkey backend: two processes, one shared store.
        fake = FakeValkey()
        _state.ValkeyStateStore(fake).put("s1", {"nonce": "n"})
        assert _state.ValkeyStateStore(fake).pop("s1")["nonce"] == "n"


# ---------------------------------------------------------------------------
# JWKS cache
# ---------------------------------------------------------------------------


class TestMemoryJWKSCache:
    def test_miss_then_hit(self):
        cache = _state.MemoryJWKSCache()
        assert cache.get("https://idp/jwks") is None
        cache.set("https://idp/jwks", {"keys": [{"kid": "a"}]})
        assert cache.get("https://idp/jwks") == {"keys": [{"kid": "a"}]}

    def test_expired_entry_is_a_miss(self):
        cache = _state.MemoryJWKSCache()
        cache.set("https://idp/jwks", {"keys": []})
        cache._d["https://idp/jwks"] = (0.0, {"keys": []})
        assert cache.get("https://idp/jwks") is None

    def test_clear_drops_entries(self):
        cache = _state.MemoryJWKSCache()
        cache.set("https://idp/jwks", {"keys": []})
        cache.clear()
        assert cache.get("https://idp/jwks") is None


class TestValkeyJWKSCache:
    def test_miss_then_hit_with_ttl(self):
        fake = FakeValkey()
        cache = _state.ValkeyJWKSCache(fake)
        assert cache.get("https://idp/jwks") is None
        cache.set("https://idp/jwks", {"keys": [{"kid": "a"}]})
        assert fake.ttls["oidc:jwks:https://idp/jwks"] == _state._JWKS_TTL
        assert cache.get("https://idp/jwks") == {"keys": [{"kid": "a"}]}

    def test_undecodable_value_is_a_miss(self):
        fake = FakeValkey()
        fake.data["oidc:jwks:https://idp/jwks"] = "not json"
        assert _state.ValkeyJWKSCache(fake).get("https://idp/jwks") is None

    def test_non_dict_value_is_a_miss(self):
        fake = FakeValkey()
        fake.data["oidc:jwks:https://idp/jwks"] = json.dumps([1, 2])
        assert _state.ValkeyJWKSCache(fake).get("https://idp/jwks") is None

    def test_valkey_errors_degrade_to_a_miss(self):
        # A JWKS cache blip must never fail a login — it just refetches.
        cache = _state.ValkeyJWKSCache(BrokenValkey())
        cache.set("https://idp/jwks", {"keys": []})  # logged, not raised
        assert cache.get("https://idp/jwks") is None


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


class TestBackendSelection:
    def test_falls_back_to_memory_without_valkey(self):
        with patch.object(_state, "_valkey", None):
            assert isinstance(_state.make_state_store(), _state.MemoryStateStore)
            assert isinstance(_state.make_jwks_cache(), _state.MemoryJWKSCache)

    def test_uses_valkey_when_configured(self):
        fake = FakeValkey()
        with patch.object(_state, "_valkey", fake):
            assert isinstance(_state.make_state_store(), _state.ValkeyStateStore)
            assert isinstance(_state.make_jwks_cache(), _state.ValkeyJWKSCache)

    def test_explicit_client_overrides_module_default(self):
        fake = FakeValkey()
        with patch.object(_state, "_valkey", None):
            assert isinstance(_state.make_state_store(fake), _state.ValkeyStateStore)
            assert isinstance(_state.make_jwks_cache(fake), _state.ValkeyJWKSCache)
