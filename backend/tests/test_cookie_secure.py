"""The Secure flag on auth cookies follows the request when BASE_URL is not https."""
from types import SimpleNamespace

import pytest

from backend import auth, security


def _req(scheme="http", peer="127.0.0.1", proto=None):
    headers = {"x-forwarded-proto": proto} if proto else {}
    return SimpleNamespace(
        url=SimpleNamespace(scheme=scheme),
        client=SimpleNamespace(host=peer) if peer else None,
        headers=headers,
    )


@pytest.fixture(autouse=True)
def _http_base_url(monkeypatch):
    monkeypatch.setattr(auth, "COOKIE_SECURE", False)


class TestRequestIsHttps:
    def test_https_connection(self):
        assert security.request_is_https(_req(scheme="https", peer="203.0.113.9"))

    def test_trusted_proxy_header(self):
        assert security.request_is_https(_req(peer="172.18.0.2", proto="https"))

    def test_first_hop_of_a_list_wins(self):
        assert security.request_is_https(_req(peer="10.0.0.5", proto="https, http"))

    def test_untrusted_peer_cannot_claim_https(self):
        assert not security.request_is_https(_req(peer="203.0.113.9", proto="https"))

    def test_plain_http(self):
        assert not security.request_is_https(_req(peer="172.18.0.2"))
        assert not security.request_is_https(None)


class TestCookieSecure:
    def test_https_base_url_always_secure(self, monkeypatch):
        monkeypatch.setattr(auth, "COOKIE_SECURE", True)
        assert auth.cookie_secure(None)

    def test_follows_the_request(self):
        assert auth.cookie_secure(_req(peer="172.18.0.2", proto="https"))
        assert not auth.cookie_secure(_req(peer="172.18.0.2"))


def test_login_behind_https_proxy_sets_secure_cookies(client, admin_setup):
    """The TestClient connects from a loopback-style peer name, so trust it as a
    proxy here and send the header a TLS-terminating proxy would add."""
    username, password = "admin", "adminpass123"
    original = security._TRUSTED_NAMES
    security._TRUSTED_NAMES = frozenset({*original, "testclient"})
    try:
        resp = client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers={"X-Forwarded-Proto": "https"},
        )
    finally:
        security._TRUSTED_NAMES = original
    assert resp.status_code == 200, resp.text
    cookies = [v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"]
    for name in ("grimoire_session=", "grimoire_refresh="):
        cookie = next(c for c in cookies if c.startswith(name))
        assert "secure" in cookie.lower()


def test_plain_http_login_cookies_are_not_secure(client, admin_setup):
    resp = client.post(
        "/api/auth/login",
        json={"username": "admin", "password": "adminpass123"},
    )
    assert resp.status_code == 200
    cookies = [v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie"]
    session = next(c for c in cookies if c.startswith("grimoire_session="))
    assert "secure" not in session.lower()
