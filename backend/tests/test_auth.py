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
        resp = client.get("/api/auth/me")
        assert resp.status_code == 401

    def test_me_invalid_token(self, client):
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

    def test_token_as_query_param(self, client, admin_token):
        resp = client.get(f"/api/auth/me?token={admin_token}")
        assert resp.status_code == 200
        assert resp.json()["username"] == "admin"
