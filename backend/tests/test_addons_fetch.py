"""Tests for add-on HTTP fetching, its limits, and the on-disk response cache.

No test here touches the network: httpx is stubbed throughout.
"""
import json
import os
import time

import httpx
import pytest

from backend.addons import fetch
from backend.addons.constants import HTTP_MAX_BYTES
from backend.addons.fetch import AddonFetchError


@pytest.fixture(autouse=True)
def cache_dir(tmp_path, monkeypatch):
    directory = tmp_path / "cache"
    directory.mkdir()
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(directory))
    return directory


class _FakeResponse:
    def __init__(self, status=200, body=b"{}", headers=None):
        self.status_code = status
        self._body = body
        self.headers = headers or {}
        self.content = body

    def iter_bytes(self):
        # Chunked, so the streaming size guard is genuinely exercised.
        for i in range(0, len(self._body), 8):
            yield self._body[i : i + 8]

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


class _FakeClient:
    """Minimal httpx.Client stand-in."""

    def __init__(self, response=None, raises=None, **kwargs):
        self._response = response
        self._raises = raises
        self.kwargs = kwargs
        self.requests = []

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def stream(self, method, url):
        self.requests.append(url)
        if self._raises:
            raise self._raises
        return self._response

    def get(self, url):
        self.requests.append(url)
        if self._raises:
            raise self._raises
        return self._response


def _patch_client(monkeypatch, **kwargs):
    holder = {}

    def factory(**client_kwargs):
        client = _FakeClient(**kwargs, **client_kwargs)
        holder["client"] = client
        return client

    monkeypatch.setattr(httpx, "Client", factory)
    return holder


class TestFetchJson:
    def test_parses_a_json_response(self, monkeypatch):
        _patch_client(monkeypatch, response=_FakeResponse(body=b'{"a": 1}'))
        assert fetch.fetch_json("https://x/d.json") == {"a": 1}

    def test_non_200_is_reported(self, monkeypatch):
        _patch_client(monkeypatch, response=_FakeResponse(status=503))
        with pytest.raises(AddonFetchError, match="HTTP 503"):
            fetch.fetch_json("https://x/d.json")

    def test_invalid_json_is_reported(self, monkeypatch):
        _patch_client(monkeypatch, response=_FakeResponse(body=b"<html>nope"))
        with pytest.raises(AddonFetchError, match="valid JSON"):
            fetch.fetch_json("https://x/d.json")

    def test_timeout_is_reported(self, monkeypatch):
        _patch_client(monkeypatch, raises=httpx.TimeoutException("slow"))
        with pytest.raises(AddonFetchError, match="timed out"):
            fetch.fetch_json("https://x/d.json")

    def test_transport_error_is_reported(self, monkeypatch):
        _patch_client(monkeypatch, raises=httpx.ConnectError("refused"))
        with pytest.raises(AddonFetchError, match="could not reach"):
            fetch.fetch_json("https://x/d.json")

    def test_declared_oversize_is_refused_before_reading(self, monkeypatch):
        response = _FakeResponse(
            body=b"{}", headers={"content-length": str(HTTP_MAX_BYTES + 1)}
        )
        _patch_client(monkeypatch, response=response)
        with pytest.raises(AddonFetchError, match="too large"):
            fetch.fetch_json("https://x/d.json")

    def test_streamed_oversize_is_refused_mid_read(self, monkeypatch):
        """A response that lies about (or omits) its length must still be capped."""
        monkeypatch.setattr("backend.addons.fetch.HTTP_MAX_BYTES", 16)
        _patch_client(monkeypatch, response=_FakeResponse(body=b"x" * 64))
        with pytest.raises(AddonFetchError, match="too large"):
            fetch.fetch_json("https://x/d.json")

    def test_limits_are_applied_to_the_client(self, monkeypatch):
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b"{}"))
        fetch.fetch_json("https://x/d.json")
        assert holder["client"].kwargs["max_redirects"] == 3
        assert holder["client"].kwargs["follow_redirects"] is True

    def test_user_agent_substitutes_the_version(self, monkeypatch):
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b"{}"))
        fetch.fetch_json("https://x/d.json", user_agent="Grimoire/{version} (+url)")
        agent = holder["client"].kwargs["headers"]["User-Agent"]
        assert "{version}" not in agent and agent.startswith("Grimoire/")

    def test_default_user_agent_identifies_grimoire(self, monkeypatch):
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b"{}"))
        fetch.fetch_json("https://x/d.json")
        assert holder["client"].kwargs["headers"]["User-Agent"].startswith("Grimoire/")


class TestCache:
    def test_write_then_read(self):
        fetch.write_cache("https://x/d.json", {"a": 1})
        assert fetch.read_cache("https://x/d.json", 3600) == {"a": 1}

    def test_miss_when_absent(self):
        assert fetch.read_cache("https://x/absent.json", 3600) is None

    def test_expired_entry_is_a_miss(self, cache_dir):
        fetch.write_cache("https://x/d.json", {"a": 1})
        stale = time.time() - 7200
        for name in os.listdir(cache_dir):
            os.utime(os.path.join(cache_dir, name), (stale, stale))
        assert fetch.read_cache("https://x/d.json", 3600) is None

    def test_zero_ttl_never_reads_cache(self):
        fetch.write_cache("https://x/d.json", {"a": 1})
        assert fetch.read_cache("https://x/d.json", 0) is None

    def test_corrupt_cache_file_is_a_miss(self, cache_dir):
        fetch.write_cache("https://x/d.json", {"a": 1})
        for name in os.listdir(cache_dir):
            (cache_dir / name).write_text("{ broken")
        assert fetch.read_cache("https://x/d.json", 3600) is None

    def test_urls_do_not_collide(self):
        fetch.write_cache("https://x/a.json", {"which": "a"})
        fetch.write_cache("https://x/b.json", {"which": "b"})
        assert fetch.read_cache("https://x/a.json", 3600) == {"which": "a"}
        assert fetch.read_cache("https://x/b.json", 3600) == {"which": "b"}

    def test_clear_one_url(self):
        fetch.write_cache("https://x/a.json", {"which": "a"})
        fetch.write_cache("https://x/b.json", {"which": "b"})
        fetch.clear_cache("https://x/a.json")
        assert fetch.read_cache("https://x/a.json", 3600) is None
        assert fetch.read_cache("https://x/b.json", 3600) is not None

    def test_clear_everything(self):
        fetch.write_cache("https://x/a.json", {"which": "a"})
        fetch.clear_cache()
        assert fetch.read_cache("https://x/a.json", 3600) is None

    def test_cache_write_failure_is_not_fatal(self, monkeypatch):
        """A read-only cache dir must degrade to "no caching", not an error."""
        monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", "/proc/nope/cannot-create")
        fetch.write_cache("https://x/d.json", {"a": 1})  # must not raise

    def test_no_partial_file_is_left_behind(self, cache_dir):
        fetch.write_cache("https://x/d.json", {"a": 1})
        assert not any(n.endswith(".tmp") for n in os.listdir(cache_dir))


class TestFetchDocument:
    def test_first_call_fetches_and_caches(self, monkeypatch):
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 1}'))
        assert fetch.fetch_document("https://x/d.json", cache_ttl=3600) == {"n": 1}
        assert len(holder["client"].requests) == 1

    def test_second_call_is_served_from_cache(self, monkeypatch):
        """The whole point of cache_ttl: repeated lookups must not re-request."""
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 1}'))
        fetch.fetch_document("https://x/d.json", cache_ttl=3600)
        first_client = holder["client"]
        fetch.fetch_document("https://x/d.json", cache_ttl=3600)
        assert len(first_client.requests) == 1
        assert holder["client"] is first_client  # no second client was built

    def test_force_bypasses_the_cache(self, monkeypatch):
        _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 1}'))
        fetch.fetch_document("https://x/d.json", cache_ttl=3600)
        holder = _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 2}'))
        assert fetch.fetch_document("https://x/d.json", cache_ttl=3600, force=True) == {
            "n": 2
        }
        assert len(holder["client"].requests) == 1

    def test_zero_ttl_does_not_write_a_cache_entry(self, monkeypatch, cache_dir):
        _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 1}'))
        fetch.fetch_document("https://x/d.json", cache_ttl=0)
        assert os.listdir(cache_dir) == []

    def test_fetch_failure_propagates(self, monkeypatch):
        _patch_client(monkeypatch, raises=httpx.ConnectError("down"))
        with pytest.raises(AddonFetchError):
            fetch.fetch_document("https://x/d.json", cache_ttl=3600)

    def test_cached_document_survives_a_later_outage(self, monkeypatch):
        """A source going down must not break lookups while the cache is warm."""
        _patch_client(monkeypatch, response=_FakeResponse(body=b'{"n": 1}'))
        fetch.fetch_document("https://x/d.json", cache_ttl=3600)
        _patch_client(monkeypatch, raises=httpx.ConnectError("down"))
        assert fetch.fetch_document("https://x/d.json", cache_ttl=3600) == {"n": 1}


def test_cache_file_is_json(cache_dir):
    fetch.write_cache("https://x/d.json", {"a": [1, 2]})
    name = os.listdir(cache_dir)[0]
    assert json.loads((cache_dir / name).read_text()) == {"a": [1, 2]}
