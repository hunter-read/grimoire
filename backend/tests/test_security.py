"""Tests for auth rate limiting and security response headers."""
import pytest

from backend.security import client_ip, limiter


@pytest.fixture
def rate_limited():
    """Enable the (test-disabled-by-default) limiter for a single test."""
    limiter.reset()
    limiter.enabled = True
    try:
        yield
    finally:
        limiter.enabled = False
        limiter.reset()


class TestSecurityHeaders:
    def test_headers_on_api_response(self, client):
        resp = client.get("/api/auth/status")
        assert resp.headers["X-Content-Type-Options"] == "nosniff"
        assert resp.headers["X-Frame-Options"] == "DENY"
        assert resp.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        csp = resp.headers["Content-Security-Policy"]
        assert "default-src 'self'" in csp
        assert "frame-ancestors 'none'" in csp
        assert "img-src 'self' data: blob:" in csp

    def test_no_hsts_over_http(self, client):
        """HSTS must only be emitted over HTTPS."""
        resp = client.get("/api/auth/status")
        assert "Strict-Transport-Security" not in resp.headers

    def test_hsts_over_forwarded_https(self, client):
        resp = client.get(
            "/api/auth/status",
            headers={"X-Forwarded-Proto": "https"},
        )
        assert "max-age=" in resp.headers["Strict-Transport-Security"]


class TestClientIp:
    def test_forwarded_for_takes_precedence(self):
        class _Req:
            headers = {"x-forwarded-for": "203.0.113.7, 10.0.0.1"}
            client = type("C", (), {"host": "10.0.0.1"})()

        assert client_ip(_Req()) == "203.0.113.7"

    def test_falls_back_to_socket_peer(self):
        class _Req:
            headers = {}
            client = type("C", (), {"host": "198.51.100.5"})()

        assert client_ip(_Req()) == "198.51.100.5"


class TestRateLimiting:
    def test_login_rate_limited(self, client, admin_setup, rate_limited):
        """Repeated logins from one IP eventually get 429."""
        headers = {"X-Forwarded-For": "203.0.113.10"}
        saw_429 = False
        for _ in range(30):
            resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
                headers=headers,
            )
            if resp.status_code == 429:
                saw_429 = True
                break
        assert saw_429, "expected a 429 after exceeding the auth rate limit"

    def test_limit_keyed_per_ip(self, client, admin_setup, rate_limited):
        """A different forwarded IP has its own bucket."""
        # Exhaust one IP.
        for _ in range(30):
            client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
                headers={"X-Forwarded-For": "203.0.113.20"},
            )
        # A fresh IP is not blocked on its first request.
        resp = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrongpassword"},
            headers={"X-Forwarded-For": "203.0.113.21"},
        )
        assert resp.status_code != 429

    def test_guest_login_rate_limited(self, client, rate_limited):
        """guest-login is throttled the same as password login."""
        headers = {"X-Forwarded-For": "203.0.113.40"}
        saw_429 = False
        for _ in range(30):
            resp = client.post(
                "/api/auth/guest-login",
                json={"code": "nope"},
                headers=headers,
            )
            if resp.status_code == 429:
                saw_429 = True
                break
        assert saw_429

    def test_stats_rate_limited(self, client, rate_limited):
        """The API-key-guarded /api/stats endpoint is throttled too."""
        headers = {"X-Forwarded-For": "203.0.113.50", "X-API-Key": "wrong"}
        saw_429 = False
        for _ in range(30):
            resp = client.get("/api/stats", headers=headers)
            if resp.status_code == 429:
                saw_429 = True
                break
        assert saw_429

    def test_disabled_by_default_under_pytest(self, client, admin_setup):
        """With the limiter disabled, many attempts never 429."""
        for _ in range(30):
            resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
                headers={"X-Forwarded-For": "203.0.113.30"},
            )
            assert resp.status_code != 429
