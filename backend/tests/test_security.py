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

    @staticmethod
    def _req(peer, forwarded=None):
        class _Req:
            headers = {"x-forwarded-for": forwarded} if forwarded else {}
            client = type("C", (), {"host": peer})()

        return _Req()

    def test_header_from_a_public_peer_is_not_read(self):
        """Only a proxy on a trusted address speaks for the client."""
        assert client_ip(self._req("198.51.100.5", "203.0.113.7")) == "198.51.100.5"

    def test_appending_proxy_yields_the_address_it_saw(self):
        """nginx-style proxies append, so the right-most untrusted hop is the client."""
        assert client_ip(self._req("172.18.0.2", "203.0.113.99, 203.0.113.9")) == "203.0.113.9"

    def test_trusted_hops_are_skipped(self):
        """A tunnel daemon in front of a proxy adds its own private address."""
        req = self._req("172.18.0.2", "203.0.113.99, 203.0.113.9, 172.18.0.5")
        assert client_ip(req) == "203.0.113.9"

    def test_header_split_over_several_lines(self):
        """HAProxy adds its own header line instead of extending the client's."""
        from starlette.datastructures import Headers

        class _Req:
            headers = Headers(
                raw=[
                    (b"x-forwarded-for", b"203.0.113.99"),
                    (b"x-forwarded-for", b"203.0.113.9"),
                ]
            )
            client = type("C", (), {"host": "172.18.0.2"})()

        assert client_ip(_Req()) == "203.0.113.9"

    def test_client_on_the_private_network(self):
        assert client_ip(self._req("172.18.0.2", "192.168.1.50")) == "192.168.1.50"


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

    def test_failed_api_keys_rate_limited(self, client, rate_limited):
        """Guessing API keys is throttled per IP on any endpoint (issue #489)."""
        headers = {"X-Forwarded-For": "203.0.113.50", "X-API-Key": "wrong"}
        saw_429 = False
        for i in range(30):
            path = "/api/stats" if i % 2 else "/api/books"
            resp = client.get(path, headers=headers)
            if resp.status_code == 429:
                saw_429 = True
                break
        assert saw_429

    def test_valid_key_works_from_an_address_over_the_limit(
        self, client, admin_headers, rate_limited
    ):
        """Several people can share one address; a working key is never refused."""
        key = client.post(
            "/api/api-keys",
            json={"name": "rate", "permissions": {"stats": "read"}},
            headers=admin_headers,
        ).json()["key"]
        ip = {"X-Forwarded-For": "203.0.113.51"}
        for _ in range(30):
            client.get("/api/stats", headers={**ip, "X-API-Key": "wrong"})
        assert client.get("/api/stats", headers={**ip, "X-API-Key": "wrong"}).status_code == 429
        assert client.get("/api/stats", headers={**ip, "X-API-Key": key}).status_code == 200

    def test_working_key_is_never_throttled(self, client, admin_headers, rate_limited):
        """Only failures count: a dashboard polling often keeps working."""
        key = client.post(
            "/api/api-keys",
            json={"name": "poller", "permissions": {"stats": "read"}},
            headers=admin_headers,
        ).json()["key"]
        headers = {"X-Forwarded-For": "203.0.113.53", "X-API-Key": key}
        for _ in range(30):
            assert client.get("/api/stats", headers=headers).status_code == 200

    def test_disabled_by_default_under_pytest(self, client, admin_setup):
        """With the limiter disabled, many attempts never 429."""
        for _ in range(30):
            resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
                headers={"X-Forwarded-For": "203.0.113.30"},
            )
            assert resp.status_code != 429


class TestAccountLimits:
    """Failed sign-ins are also counted per account, whatever address they use."""

    @staticmethod
    def _attempt(client, username, password, n):
        return client.post(
            "/api/auth/login",
            json={"username": username, "password": password},
            headers={"X-Forwarded-For": f"203.0.113.{n % 250}"},
        )

    def test_failures_from_many_addresses_are_counted_per_account(
        self, client, admin_setup, rate_limited
    ):
        codes = [self._attempt(client, "admin", "wrongpassword", i).status_code for i in range(25)]
        assert codes[:20] == [401] * 20
        assert codes[-1] == 429
        # The right password from yet another address waits for the window too.
        assert self._attempt(client, "admin", "adminpass123", 251).status_code == 429

    def test_unknown_usernames_are_counted_the_same_way(self, client, rate_limited):
        codes = [self._attempt(client, "nobody-here", "whatever", i).status_code for i in range(22)]
        assert codes[:20] == [401] * 20
        assert codes[-1] == 429

    def test_a_browser_that_signed_in_before_keeps_its_own_allowance(
        self, client, admin_setup, rate_limited
    ):
        ok = self._attempt(client, "admin", "adminpass123", 1)
        assert ok.status_code == 200
        device = ok.cookies.get("grimoire_device")
        assert device
        client.cookies.clear()
        for i in range(25):
            self._attempt(client, "admin", "wrongpassword", i)
        assert self._attempt(client, "admin", "adminpass123", 99).status_code == 429
        client.cookies.set("grimoire_device", device, path="/api/auth")
        assert self._attempt(client, "admin", "adminpass123", 99).status_code == 200

    def test_a_device_cookie_only_counts_for_its_own_account(
        self, client, admin_setup, player_setup, rate_limited
    ):
        ok = self._attempt(client, "playeruser", "playerpass123", 1)
        device = ok.cookies.get("grimoire_device")
        client.cookies.clear()
        for i in range(25):
            self._attempt(client, "admin", "wrongpassword", i)
        client.cookies.set("grimoire_device", device, path="/api/auth")
        assert self._attempt(client, "admin", "adminpass123", 99).status_code == 429
