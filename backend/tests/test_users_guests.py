"""Admin listing + conversion of per-campaign guest accounts (1.5.0)."""
import pytest


def _set_guest_access(client, admin_headers, enabled: bool):
    resp = client.patch(
        "/api/settings",
        json={"guest_access_enabled": enabled},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text


def _set_password_auth(client, admin_headers, enabled: bool):
    resp = client.patch(
        "/api/settings",
        json={"password_auth_enabled": enabled},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text


@pytest.fixture
def guest(client, gm_headers, admin_headers):
    """A guest invited to a fresh GM campaign; yields the created guest payload."""
    _set_guest_access(client, admin_headers, True)
    campaign_id = client.post(
        "/api/campaigns",
        json={"name": "Convert Test Campaign", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()["id"]
    created = client.post(
        f"/api/campaigns/{campaign_id}/guests",
        json={"nickname": "Ivy"},
        headers=gm_headers,
    ).json()
    created["campaign_id"] = campaign_id
    return created


class TestListGuests:
    def test_lists_guest_with_campaign_and_inviter(self, client, admin_headers, guest):
        resp = client.get("/api/users/guests", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        row = next(g for g in resp.json() if g["id"] == guest["user_id"])
        assert row["display_name"] == "Ivy"
        assert row["campaign_id"] == guest["campaign_id"]
        assert row["campaign_name"] == "Convert Test Campaign"
        # Inviter is the campaign owner (the gm fixture user).
        assert row["invited_by"]

    def test_guests_not_in_regular_user_list(self, client, admin_headers, guest):
        users = client.get("/api/users", headers=admin_headers).json()
        assert all(u["id"] != guest["user_id"] for u in users)

    def test_requires_admin(self, client, gm_headers, guest):
        assert client.get("/api/users/guests", headers=gm_headers).status_code == 403


class TestConvertGuest:
    def test_convert_with_password(self, client, admin_headers, guest):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "ivy_perm", "password": "supersecret1", "role": "player"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["username"] == "ivy_perm"
        assert body["role"] == "player"
        # Keeps the GM-set nickname.
        assert body["display_name"] == "Ivy"

        # Now shows in the regular user list and no longer as a guest.
        users = client.get("/api/users", headers=admin_headers).json()
        assert any(u["id"] == guest["user_id"] for u in users)
        remaining = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in remaining)

        # Can log in with the new credentials.
        login = client.post(
            "/api/auth/login",
            json={"username": "ivy_perm", "password": "supersecret1"},
        )
        assert login.status_code == 200

        # The old invite code no longer mints a token.
        assert (
            client.post("/api/auth/guest-login", json={"code": guest["guest_code"]}).status_code
            == 401
        )

    def test_convert_requires_password_when_password_auth_enabled(
        self, client, admin_headers, guest
    ):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "nopass"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_without_password_when_password_auth_disabled(
        self, client, admin_headers, guest
    ):
        _set_password_auth(client, admin_headers, False)
        try:
            resp = client.post(
                f"/api/users/{guest['user_id']}/convert",
                json={"username": "oidc_only", "role": "player"},
                headers=admin_headers,
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["username"] == "oidc_only"
        finally:
            _set_password_auth(client, admin_headers, True)

    def test_convert_rejects_duplicate_username(self, client, admin_headers, guest):
        _set_password_auth(client, admin_headers, True)
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "admin", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_rejects_guest_role(self, client, admin_headers, guest):
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "still_guest", "password": "supersecret1", "role": "guest"},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_convert_non_guest_rejected(self, client, admin_headers, admin_id):
        resp = client.post(
            f"/api/users/{admin_id}/convert",
            json={"username": "whatever", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_convert_missing_user(self, client, admin_headers):
        resp = client.post(
            "/api/users/does-not-exist/convert",
            json={"username": "ghost", "password": "supersecret1"},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_convert_requires_admin(self, client, gm_headers, guest):
        resp = client.post(
            f"/api/users/{guest['user_id']}/convert",
            json={"username": "sneaky", "password": "supersecret1"},
            headers=gm_headers,
        )
        assert resp.status_code == 403
