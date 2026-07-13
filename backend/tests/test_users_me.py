"""Tests for self-service user endpoints (/api/users/me/*).

Covers the preferences, password-change and account-deletion routes in
backend/routers/users/me.py. Each mutating test creates its own throwaway
account so it never disturbs the session-scoped admin/gm/player fixtures.
"""
import uuid


def _make_user(client, admin_headers, role="player", password="password123", **extra):
    """Create a fresh account and return (user dict, auth headers)."""
    username = f"me_{uuid.uuid4().hex[:8]}"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": role, **extra},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    user = resp.json()
    login = client.post(
        "/api/auth/login", json={"username": username, "password": password}
    )
    assert login.status_code == 200, login.text
    headers = {"Authorization": f"Bearer {login.json()['token']}"}
    return user, headers


class TestUpdatePreferences:
    def test_update_allow_explicit_and_display_name(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers)
        resp = client.patch(
            "/api/users/me/preferences",
            json={"allow_explicit": True, "display_name": "  Gandalf  "},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["allow_explicit"] is True
        assert body["display_name"] == "Gandalf"

    def test_blank_display_name_clears_to_none(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers)
        client.patch(
            "/api/users/me/preferences",
            json={"display_name": "Frodo"},
            headers=headers,
        )
        resp = client.patch(
            "/api/users/me/preferences",
            json={"display_name": "   "},
            headers=headers,
        )
        assert resp.status_code == 200
        assert resp.json()["display_name"] is None

    def test_empty_body_leaves_values_unchanged(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers)
        resp = client.patch(
            "/api/users/me/preferences", json={}, headers=headers
        )
        assert resp.status_code == 200
        # allow_explicit defaults to falsey; nothing was changed.
        assert resp.json()["display_name"] is None

    def test_requires_authentication(self, client):
        resp = client.patch("/api/users/me/preferences", json={"allow_explicit": True})
        assert resp.status_code == 401


class TestChangePassword:
    def test_change_password_success(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers, password="oldpassword1")
        resp = client.patch(
            "/api/users/me/password",
            json={"current_password": "oldpassword1", "new_password": "newpassword2"},
            headers=headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["status"] == "ok"

        # Old password no longer works; new one does.
        old = client.post(
            "/api/auth/login",
            json={"username": user["username"], "password": "oldpassword1"},
        )
        assert old.status_code == 401
        new = client.post(
            "/api/auth/login",
            json={"username": user["username"], "password": "newpassword2"},
        )
        assert new.status_code == 200

    def test_wrong_current_password_rejected(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers, password="rightpassword1")
        resp = client.patch(
            "/api/users/me/password",
            json={"current_password": "wrongpassword", "new_password": "newpassword2"},
            headers=headers,
        )
        assert resp.status_code == 400
        assert "incorrect" in resp.json()["detail"].lower()

    def test_requires_authentication(self, client):
        resp = client.patch(
            "/api/users/me/password",
            json={"current_password": "a", "new_password": "newpassword2"},
        )
        assert resp.status_code == 401


class TestDeleteOwnAccount:
    def test_player_can_delete_own_account(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers)
        resp = client.delete("/api/users/me", headers=headers)
        assert resp.status_code == 204, resp.text

        # And it no longer appears in the admin listing.
        listing = client.get("/api/users", headers=admin_headers).json()
        assert user["username"] not in [u["username"] for u in listing]

    def test_gm_can_delete_own_account(self, client, admin_headers):
        user, headers = _make_user(client, admin_headers, role="gm")
        resp = client.delete("/api/users/me", headers=headers)
        assert resp.status_code == 204, resp.text

        listing = client.get("/api/users", headers=admin_headers).json()
        assert user["username"] not in [u["username"] for u in listing]

    def test_admin_cannot_self_delete(self, client, admin_headers):
        # A second admin so we never delete the shared bootstrap admin.
        user, headers = _make_user(client, admin_headers, role="admin")
        resp = client.delete("/api/users/me", headers=headers)
        assert resp.status_code == 400
        assert "admin" in resp.json()["detail"].lower()
        # Cleanup via admin endpoint.
        client.delete(f"/api/users/{user['id']}", headers=admin_headers)

    def test_requires_authentication(self, client):
        resp = client.delete("/api/users/me")
        assert resp.status_code == 401
