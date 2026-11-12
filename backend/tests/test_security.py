"""Tests for auth rate limiting and security response headers."""
import logging

import pytest

from backend.security import client_ip, limiter, rate_limit_key


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

    def test_no_hsts_when_untrusted_peer_claims_https(self):
        from fastapi import FastAPI
        from fastapi.testclient import TestClient

        from backend.security import SecurityHeadersMiddleware

        app = FastAPI()
        app.add_api_route("/ping", lambda: {})
        app.add_middleware(SecurityHeadersMiddleware)
        untrusted = TestClient(app, client=("203.0.113.9", 50000))
        resp = untrusted.get("/ping", headers={"X-Forwarded-Proto": "https"})
        assert "Strict-Transport-Security" not in resp.headers


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


class TestDefaultTrustedProxies:
    """The default list: loopback and Docker's bridge networks, nothing wider.

    The test session trusts more (see conftest), so these swap the default in.
    """

    @pytest.fixture(autouse=True)
    def _default_list(self, monkeypatch):
        from backend import config, security

        networks, names = security._parse_trusted(config.DEFAULT_TRUSTED_PROXIES)
        monkeypatch.setattr(security, "_TRUSTED_NETWORKS", networks)
        monkeypatch.setattr(security, "_TRUSTED_NAMES", names)
        monkeypatch.setattr(security, "_HINTED_PEERS", set())

    _req = staticmethod(TestClientIp._req)

    @pytest.mark.parametrize("proxy", ["127.0.0.1", "::1", "172.17.0.1", "172.31.255.2"])
    def test_same_host_and_docker_proxies_are_trusted(self, proxy):
        assert client_ip(self._req(proxy, "203.0.113.7")) == "203.0.113.7"

    @pytest.mark.parametrize(
        "peer",
        [
            "192.168.1.10",  # another machine on the LAN
            "10.42.0.7",  # a Kubernetes pod network
            "10.88.0.4",  # Podman's default network
            "fd7a:115c:a1e0::5",  # Tailscale over IPv6
            "100.101.102.103",  # Tailscale over IPv4
        ],
    )
    def test_other_private_peers_are_not(self, peer):
        assert client_ip(self._req(peer, "203.0.113.7")) == peer

    def test_an_ignored_private_proxy_is_named_in_the_log_once(self, caplog):
        with caplog.at_level(logging.INFO, logger="grimoire"):
            for _ in range(3):
                client_ip(self._req("192.168.1.10", "203.0.113.7"))
        hints = [r for r in caplog.records if "TRUSTED_PROXIES" in r.getMessage()]
        assert len(hints) == 1
        assert "192.168.1.10" in hints[0].getMessage()

    def test_no_hint_for_a_public_peer_or_without_the_header(self, caplog):
        with caplog.at_level(logging.INFO, logger="grimoire"):
            # Not 198.51.100.x: Python counts the documentation ranges as private.
            client_ip(self._req("93.184.216.34", "203.0.113.7"))
            client_ip(self._req("192.168.1.11"))
            client_ip(self._req("not-an-address", "203.0.113.7"))
        assert not [r for r in caplog.records if "TRUSTED_PROXIES" in r.getMessage()]

    def test_hints_stop_after_a_few_addresses(self, caplog, monkeypatch):
        from backend import security

        monkeypatch.setattr(security, "_MAX_HINTED_PEERS", 2)
        with caplog.at_level(logging.INFO, logger="grimoire"):
            for host in range(1, 6):
                client_ip(self._req(f"192.168.1.{host}", "203.0.113.7"))
        assert len([r for r in caplog.records if "TRUSTED_PROXIES" in r.getMessage()]) == 2


class TestRateLimitKey:
    @staticmethod
    def _req(peer):
        class _Req:
            headers = {}
            client = type("C", (), {"host": peer})()

        return _Req()

    def test_ipv4_is_its_own_bucket(self):
        assert rate_limit_key(self._req("198.51.100.5")) == "198.51.100.5"

    def test_global_ipv6_is_grouped_by_64(self):
        a = rate_limit_key(self._req("2a01:4f8:c0c:1234::1"))
        b = rate_limit_key(self._req("2a01:4f8:c0c:1234:abcd:ef01:2345:6789"))
        assert a == b == "2a01:4f8:c0c:1234::/64"
        assert rate_limit_key(self._req("2a01:4f8:c0c:1235::1")) != a

    def test_private_ipv6_keeps_its_own_bucket(self):
        """Every device on one LAN segment shares a /64, so ULAs aren't grouped."""
        assert rate_limit_key(self._req("fd7a:115c:a1e0::5")) == "fd7a:115c:a1e0::5"
        assert rate_limit_key(self._req("fe80::1")) == "fe80::1"
        assert rate_limit_key(self._req("::1")) == "::1"

    def test_ipv4_mapped_ipv6_is_keyed_as_ipv4(self):
        assert rate_limit_key(self._req("::ffff:198.51.100.5")) == "198.51.100.5"

    def test_a_non_address_peer_is_kept(self):
        assert rate_limit_key(self._req("testclient")) == "testclient"


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

    def test_one_ipv6_64_shares_a_bucket(self, client, admin_setup, rate_limited):
        """Rotating addresses inside one /64 doesn't buy fresh attempts."""
        for i in range(30):
            resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "wrongpassword"},
                headers={"X-Forwarded-For": f"2a01:4f8:c0c:77::{i + 1:x}"},
            )
            if resp.status_code == 429:
                break
        # The per-IP limit (10/minute), well before the per-account one (20/hour)
        # that would refuse a fresh address per attempt anyway.
        assert resp.status_code == 429 and i <= 10
        resp = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "wrongpassword"},
            headers={"X-Forwarded-For": "2a01:4f8:c0c:78::1"},
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

    def test_every_spelling_that_reaches_an_account_shares_its_count(
        self, client, admin_setup, rate_limited, monkeypatch
    ):
        """The count follows the account the name matched, not the text typed."""
        from backend.routers.auth import core
        from backend.usernames import find_by_username

        def reach_admin(db, username):
            return find_by_username(db, "admin" if username.startswith("admin") else username)

        monkeypatch.setattr(core, "find_by_username", reach_admin)
        for i in range(25):
            self._attempt(client, "admin", "wrongpassword", i)
        for i, name in enumerate(["admin-1", "admin-2", "admin-3"]):
            assert self._attempt(client, name, "wrongpassword", 30 + i).status_code == 429
        assert self._attempt(client, "admin-4", "adminpass123", 40).status_code == 429

    @pytest.mark.parametrize("name", ["admin\n", "admin\x7f", "admin\x85"])
    def test_a_username_with_a_control_character_is_refused(self, client, admin_setup, name):
        resp = client.post("/api/auth/login", json={"username": name, "password": "adminpass123"})
        assert resp.status_code == 422

    @pytest.mark.parametrize("name", ["admin\x00", "ad\x00min"])
    def test_a_nul_in_a_username_is_dropped_before_it_is_read(self, client, admin_setup, name):
        """No JSON body keeps a NUL, so the name is the account's own on both databases."""
        resp = client.post("/api/auth/login", json={"username": name, "password": "adminpass123"})
        assert resp.status_code == 200
        resp = client.post("/api/auth/login", json={"username": name, "password": "wrongpassword"})
        assert resp.status_code == 401

    @pytest.mark.postgres_only
    def test_a_nul_cannot_get_round_a_limited_account(self, client, admin_setup, rate_limited):
        """PostgreSQL drops a NUL from the name it is sent, so it would match the account."""
        for i in range(25):
            self._attempt(client, "admin", "wrongpassword", i)
        assert self._attempt(client, "admin", "adminpass123", 50).status_code == 429
        for i, name in enumerate(["admin\x00", "ad\x00min"]):
            resp = self._attempt(client, name, "adminpass123", 60 + i)
            assert resp.status_code != 200 and "token" not in resp.text


class TestPasswordChangeLimit:
    """Wrong current passwords on the change-password form are counted per account."""

    @staticmethod
    def _account(client, admin_headers):
        import uuid

        username = f"pwc_{uuid.uuid4().hex[:8]}"
        created = client.post(
            "/api/users",
            json={"username": username, "password": "rightpassword-1", "role": "player"},
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text
        login = client.post(
            "/api/auth/login", json={"username": username, "password": "rightpassword-1"}
        )
        assert login.status_code == 200, login.text
        return username, {"Authorization": f"Bearer {login.json()['token']}"}

    @staticmethod
    def _change(client, headers, current, n):
        return client.patch(
            "/api/users/me/password",
            json={"current_password": current, "new_password": "brandnewpass-2"},
            headers={**headers, "X-Forwarded-For": f"198.51.100.{n % 250}"},
        )

    def test_the_21st_wrong_current_password_is_refused(
        self, client, admin_headers, rate_limited
    ):
        _, headers = self._account(client, admin_headers)
        codes = [self._change(client, headers, "wrongpassword", i).status_code for i in range(21)]
        assert codes[:20] == [400] * 20
        assert codes[20] == 429
        # The right one waits for the window too.
        assert self._change(client, headers, "rightpassword-1", 99).status_code == 429

    def test_it_does_not_use_up_the_sign_in_allowance(
        self, client, admin_headers, rate_limited
    ):
        username, headers = self._account(client, admin_headers)
        for i in range(21):
            self._change(client, headers, "wrongpassword", i)
        login = client.post(
            "/api/auth/login",
            json={"username": username, "password": "rightpassword-1"},
            headers={"X-Forwarded-For": "198.51.100.251"},
        )
        assert login.status_code == 200

    def test_a_right_current_password_is_not_counted(
        self, client, admin_headers, rate_limited
    ):
        _, headers = self._account(client, admin_headers)
        for i in range(19):
            self._change(client, headers, "wrongpassword", i)
        assert self._change(client, headers, "rightpassword-1", 20).status_code == 200
