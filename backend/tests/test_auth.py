"""Tests for authentication endpoints."""


class TestAuthStatus:
    def test_status_initialized(self, client, admin_setup):
        resp = client.get("/api/auth/status")
        assert resp.status_code == 200
        assert resp.json()["initialized"] is True


class TestAuthSetup:
    def test_setup_already_initialized(self, client, admin_setup):
        """Setup fails when users already exist."""
        resp = client.post(
            "/api/auth/setup",
            json={
                "username": "another_admin",
                "password": "anotherpass123",
            },
        )
        assert resp.status_code == 400
        assert "already initialized" in resp.json()["detail"].lower()

    def test_setup_username_too_short(self, client):
        resp = client.post(
            "/api/auth/setup",
            json={
                "username": "a",
                "password": "validpassword",
            },
        )
        assert resp.status_code == 422

    def test_setup_password_too_short(self, client):
        resp = client.post(
            "/api/auth/setup",
            json={
                "username": "validuser",
                "password": "short",
            },
        )
        assert resp.status_code == 422


class TestAuthLogin:
    def test_login_success(self, client, admin_setup):
        resp = client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "adminpass123",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "token" in body
        assert body["user"]["username"] == "admin"
        assert body["user"]["role"] == "admin"
        # display_name is included so the client can show it immediately without
        # waiting for a /auth/me round-trip.
        assert "display_name" in body["user"]

    def test_login_wrong_password(self, client, admin_setup):
        resp = client.post(
            "/api/auth/login",
            json={
                "username": "admin",
                "password": "wrongpassword",
            },
        )
        assert resp.status_code == 401

    def test_login_unknown_user(self, client, admin_setup):
        resp = client.post(
            "/api/auth/login",
            json={
                "username": "nobody",
                "password": "doesnotmatter",
            },
        )
        assert resp.status_code == 401

    def test_login_case_insensitive_username(self, client, admin_setup):
        """A differently-cased username still logs into the same account."""
        for username in ("ADMIN", "Admin", "aDmIn"):
            resp = client.post(
                "/api/auth/login",
                json={
                    "username": username,
                    "password": "adminpass123",
                },
            )
            assert resp.status_code == 200, username
            assert resp.json()["user"]["username"] == "admin"

    def test_login_password_still_case_sensitive(self, client, admin_setup):
        """Case-insensitive usernames must not leak into password matching."""
        resp = client.post(
            "/api/auth/login",
            json={
                "username": "ADMIN",
                "password": "ADMINPASS123",
            },
        )
        assert resp.status_code == 401


class TestAuthMe:
    def test_me_returns_current_user(self, client, admin_headers, admin_id):
        resp = client.get("/api/auth/me", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == admin_id
        assert body["username"] == "admin"
        assert body["role"] == "admin"

    def test_me_no_token(self, client):
        # Clear any ambient session cookie left by the shared session client so
        # "no token" really means no credentials of any kind.
        client.cookies.clear()
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_invalid_token(self, client):
        client.cookies.clear()
        resp = client.get("/api/auth/me", headers={"Authorization": "Bearer invalid.token.here"})
        assert resp.status_code == 401

    def test_me_gm(self, client, gm_headers):
        resp = client.get("/api/auth/me", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json()["role"] == "gm"

    def test_me_player(self, client, player_headers):
        resp = client.get("/api/auth/me", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["role"] == "player"

    def test_token_as_query_param_is_refused(self, client, admin_token):
        # The old ?token= fallback (issue #156) is gone: a JWT in a URL leaks
        # into logs and history. Clear the cookie jar so only the param is sent.
        client.cookies.clear()
        resp = client.get(f"/api/auth/me?token={admin_token}")
        assert resp.status_code == 401


def _cookie_header(resp):
    """Raw Set-Cookie header for the session cookie, or '' if absent."""
    for key, value in resp.headers.items():
        if key.lower() == "set-cookie" and "grimoire_session=" in value:
            return value
    return ""


class TestAuthCookie:
    """The session cookie lets image/download GETs authenticate without the JWT
    appearing in the URL (issue #156)."""

    def test_login_sets_httponly_cookie(self, client, admin_setup):
        resp = client.post(
            "/api/auth/login",
            json={"username": "admin", "password": "adminpass123"},
        )
        assert resp.status_code == 200
        # Cookie value matches the JWT returned in the body.
        assert client.cookies.get("grimoire_session") == resp.json()["token"]
        raw = _cookie_header(resp)
        assert "httponly" in raw.lower()
        assert "samesite=lax" in raw.lower()

    def test_cookie_authenticates_request(self, client, admin_token):
        """A bare cookie (no Authorization header) authenticates — this is what
        <img>/download GETs rely on."""
        client.cookies.clear()
        client.cookies.set("grimoire_session", admin_token)
        resp = client.get("/api/auth/me")
        assert resp.status_code == 200
        assert resp.json()["username"] == "admin"

    def test_header_takes_priority_over_cookie(self, client, admin_token):
        """A valid header wins even if a garbage cookie is present."""
        client.cookies.clear()
        client.cookies.set("grimoire_session", "not-a-real-token")
        resp = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200
        assert resp.json()["username"] == "admin"

    def test_invalid_cookie_rejected(self, client, admin_setup):
        client.cookies.clear()
        client.cookies.set("grimoire_session", "garbage")
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_reestablishes_cookie_for_header_only_client(self, client, admin_token):
        """Users logged in before cookies existed present a Bearer header but no
        cookie; /auth/me re-issues the cookie from their existing token."""
        client.cookies.clear()
        resp = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200
        # The same token is reused, not a freshly minted one.
        assert client.cookies.get("grimoire_session") == admin_token

    def test_me_does_not_reset_cookie_when_already_present(self, client, admin_token):
        """When the cookie is already sent, /auth/me issues no new Set-Cookie."""
        client.cookies.clear()
        client.cookies.set("grimoire_session", admin_token)
        resp = client.get(
            "/api/auth/me", headers={"Authorization": f"Bearer {admin_token}"}
        )
        assert resp.status_code == 200
        assert _cookie_header(resp) == ""


class TestAuthLogout:
    def test_logout_clears_cookie(self, client, admin_token):
        client.cookies.set("grimoire_session", admin_token)
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200
        assert resp.json() == {"ok": True}
        # The Set-Cookie expires the cookie (empty value / Max-Age=0).
        raw = _cookie_header(resp).lower()
        assert 'grimoire_session=""' in raw or "grimoire_session=;" in raw or "max-age=0" in raw

    def test_logout_without_cookie_still_ok(self, client, admin_setup):
        """Logout requires no auth so a client with an unusable cookie can still
        clear it."""
        client.cookies.clear()
        resp = client.post("/api/auth/logout")
        assert resp.status_code == 200


def test_login_unknown_user_still_runs_password_check(client, monkeypatch):
    """An unknown username must cost a hash verify like a wrong password does, or
    the response time reveals which usernames exist."""
    from backend.routers.auth import core as auth_core

    calls = []
    real = auth_core.verify_password

    def spy(plain, hashed):
        calls.append(hashed)
        return real(plain, hashed)

    monkeypatch.setattr(auth_core, "verify_password", spy)
    resp = client.post(
        "/api/auth/login", json={"username": "nobody-by-this-name", "password": "whatever1"}
    )
    assert resp.status_code == 401
    assert calls == [None]



class TestTokenType:
    """Only a session access token is a session: other JWTs under the same key,
    or ones missing their claims, are a 401 rather than a 500 or a sign-in."""

    def _jwt(self, claims):
        import datetime

        import jwt

        from backend import auth

        now = datetime.datetime.now(datetime.timezone.utc)
        payload = {"iat": now, "exp": now + datetime.timedelta(minutes=5), **claims}
        return jwt.encode(payload, auth._secret_key(), algorithm=auth.ALGORITHM)

    def _me(self, client, token):
        client.cookies.clear()
        return client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})

    def test_new_tokens_carry_the_access_type(self, admin_token):
        from backend.auth import ACCESS_TOKEN_TYPE, decode_token

        assert decode_token(admin_token)["typ"] == ACCESS_TOKEN_TYPE

    def test_other_type_is_refused(self, client, admin_id):
        token = self._jwt({"typ": "share-unlock", "sub": admin_id, "username": "admin",
                           "role": "admin"})
        assert self._me(client, token).status_code == 401

    def test_missing_claims_are_a_401_not_a_500(self, client):
        assert self._me(client, self._jwt({"typ": "access", "sub": "x"})).status_code == 401
        assert self._me(client, self._jwt({"sl": "link", "pw": "f"})).status_code == 401

    def test_token_from_before_the_type_claim_still_works(self, client, admin_id):
        token = self._jwt({"sub": admin_id, "username": "admin", "role": "admin"})
        assert self._me(client, token).status_code == 200

    def test_share_unlock_token_is_not_signed_with_the_session_key(self):
        import jwt
        import pytest

        from backend import auth
        from backend.models import ShareLink
        from backend.routers.share._links import unlock_token

        token = unlock_token(ShareLink(id="l1", password_hash="h"))
        with pytest.raises(jwt.InvalidSignatureError):
            jwt.decode(token, auth._secret_key(), algorithms=[auth.ALGORITHM])
