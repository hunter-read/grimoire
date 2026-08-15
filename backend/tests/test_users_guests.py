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


@pytest.fixture
def guest_pair(client, gm_headers, admin_headers):
    """The same person invited to two campaigns — two separate guest accounts.

    This is the situation merging exists for: without it the player has one
    login per campaign and no way to join them up.
    """
    _set_guest_access(client, admin_headers, True)
    created = []
    for name in ("Merge Campaign A", "Merge Campaign B"):
        campaign_id = client.post(
            "/api/campaigns",
            json={"name": name, "is_gm_campaign": True},
            headers=gm_headers,
        ).json()["id"]
        guest = client.post(
            f"/api/campaigns/{campaign_id}/guests",
            json={"nickname": "Rowan"},
            headers=gm_headers,
        ).json()
        guest["campaign_id"] = campaign_id
        created.append(guest)
    return created


class TestMergeGuests:
    def test_merges_second_guest_into_first(self, client, admin_headers, guest_pair):
        keep, absorb = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["id"] == keep["user_id"]
        assert body["merged_ids"] == [absorb["user_id"]]
        # The absorbed account's campaign membership moved across.
        assert body["memberships_moved"] == 1

        # Only the surviving account remains, and it now covers both campaigns.
        guests = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != absorb["user_id"] for g in guests)
        assert any(g["id"] == keep["user_id"] for g in guests)

    def test_merged_guest_code_stops_working(self, client, admin_headers, guest_pair):
        keep, absorb = guest_pair
        client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        # The absorbed account is gone, so its invite code must not mint a token.
        resp = client.post("/api/auth/guest-login", json={"code": absorb["guest_code"]})
        assert resp.status_code == 401
        # The surviving account still logs in.
        assert (
            client.post(
                "/api/auth/guest-login", json={"code": keep["guest_code"]}
            ).status_code
            == 200
        )

    def test_cannot_merge_account_into_itself(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [keep["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_cannot_merge_away_a_permanent_account(
        self, client, admin_headers, guest_pair, player_id
    ):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [player_id]},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_merge_into_a_converted_permanent_user(self, client, admin_headers, guest_pair):
        """A guest can be folded into the real account the same person already has."""
        _set_password_auth(client, admin_headers, True)
        keep, absorb = guest_pair
        client.post(
            f"/api/users/{keep['user_id']}/convert",
            json={"username": "rowan_perm", "password": "supersecret1", "role": "player"},
            headers=admin_headers,
        )
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["memberships_moved"] == 1

    def test_rejects_empty_source_list(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": []},
            headers=admin_headers,
        )
        assert resp.status_code == 422

    def test_missing_source_is_404(self, client, admin_headers, guest_pair):
        keep, _ = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": ["does-not-exist"]},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_missing_target_is_404(self, client, admin_headers, guest_pair):
        _, absorb = guest_pair
        resp = client.post(
            "/api/users/does-not-exist/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=admin_headers,
        )
        assert resp.status_code == 404

    def test_requires_admin(self, client, gm_headers, guest_pair):
        keep, absorb = guest_pair
        resp = client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [absorb["user_id"]]},
            headers=gm_headers,
        )
        assert resp.status_code == 403


class TestDeleteGuest:
    def test_admin_can_delete_a_guest(self, client, admin_headers, guest):
        resp = client.delete(f"/api/users/{guest['user_id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        remaining = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in remaining)

    def test_can_delete_guest_with_no_campaign_or_inviter(
        self, client, admin_headers, gm_headers, guest
    ):
        """An orphaned guest — its campaign deleted out from under it — is still
        removable. It lists with null campaign/inviter and previously had no
        action that could clear it."""
        client.delete(f"/api/campaigns/{guest['campaign_id']}", headers=gm_headers)

        rows = client.get("/api/users/guests", headers=admin_headers).json()
        orphan = next(g for g in rows if g["id"] == guest["user_id"])
        assert orphan["campaign_id"] is None
        assert orphan["invited_by"] is None

        resp = client.delete(f"/api/users/{guest['user_id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        after = client.get("/api/users/guests", headers=admin_headers).json()
        assert all(g["id"] != guest["user_id"] for g in after)
