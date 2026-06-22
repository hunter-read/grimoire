"""Tests for the guest invite system (issue #96)."""
import pytest


def _set_guest_access(client, admin_headers, enabled: bool):
    resp = client.patch(
        "/api/settings",
        json={"guest_access_enabled": enabled},
        headers=admin_headers,
    )
    assert resp.status_code == 200, resp.text
    assert resp.json()["guest_access_enabled"] is enabled


@pytest.fixture
def gm_campaign(client, gm_headers):
    """A fresh GM campaign owned by the gm fixture user."""
    resp = client.post(
        "/api/campaigns",
        json={"name": "Guest Test Campaign", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["id"]


def test_create_guest_requires_global_setting(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, False)
    resp = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Alice"},
        headers=gm_headers,
    )
    assert resp.status_code == 403

    _set_guest_access(client, admin_headers, True)
    resp = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Alice"},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    body = resp.json()
    assert body["nickname"] == "Alice"
    assert len(body["guest_code"]) == 10
    assert body["guest_code"].isalnum() and body["guest_code"].isupper()


def test_only_owner_manages_guests(client, gm_headers, player_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    # A non-owner (player) cannot create guests.
    resp = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Bob"},
        headers=player_headers,
    )
    assert resp.status_code == 403


def test_guest_login_and_scope(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    created = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Carol"},
        headers=gm_headers,
    ).json()
    code = created["guest_code"]

    # Bad code is rejected.
    bad = client.post("/api/auth/guest-login", json={"code": "NOPENOPE00"})
    assert bad.status_code == 401

    # Valid code mints a token + returns the campaign id.
    login = client.post("/api/auth/guest-login", json={"code": code.lower()})
    assert login.status_code == 200, login.text
    data = login.json()
    assert data["user"]["role"] == "guest"
    assert data["campaign_id"] == gm_campaign
    guest_headers = {"Authorization": f"Bearer {data['token']}"}

    # Guest can view their campaign.
    resp = client.get(f"/api/campaigns/{gm_campaign}", headers=guest_headers)
    assert resp.status_code == 200

    # Guest can update their own character name + availability.
    member_id = created["id"]
    user_id = created["user_id"]
    patch = client.patch(
        f"/api/campaigns/{gm_campaign}/members/{user_id}",
        json={"character_name": "Sir Carol"},
        headers=guest_headers,
    )
    assert patch.status_code == 200, patch.text
    assert patch.json()["character_name"] == "Sir Carol"

    # Guest is locked out of library browsing, maps, tokens, search, systems.
    for path in ("/api/books", "/api/maps", "/api/tokens", "/api/search?q=x", "/api/systems"):
        r = client.get(path, headers=guest_headers)
        assert r.status_code == 403, f"{path} should be 403 for guests, got {r.status_code}"

    # Guest cannot create a campaign.
    r = client.post(
        "/api/campaigns",
        json={"name": "Sneaky", "is_gm_campaign": False},
        headers=guest_headers,
    )
    assert r.status_code == 403


def test_regenerate_invalidates_old_code(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    created = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Dave"},
        headers=gm_headers,
    ).json()
    old_code = created["guest_code"]
    member_id = created["id"]

    regen = client.post(
        f"/api/campaigns/{gm_campaign}/guests/{member_id}/regenerate",
        headers=gm_headers,
    )
    assert regen.status_code == 200, regen.text
    new_code = regen.json()["guest_code"]
    assert new_code != old_code

    assert client.post("/api/auth/guest-login", json={"code": old_code}).status_code == 401
    assert client.post("/api/auth/guest-login", json={"code": new_code}).status_code == 200


def test_share_template(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    created = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Eve"},
        headers=gm_headers,
    ).json()
    member_id = created["id"]
    code = created["guest_code"]

    resp = client.get(
        f"/api/campaigns/{gm_campaign}/guests/{member_id}/share-template",
        headers=gm_headers,
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert code in body["message"]
    assert code in body["link"]
    assert body["mailto_url"].startswith("mailto:?")


def test_remove_guest_deletes_account(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    created = client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Frank"},
        headers=gm_headers,
    ).json()
    member_id = created["id"]
    code = created["guest_code"]

    resp = client.delete(
        f"/api/campaigns/{gm_campaign}/guests/{member_id}",
        headers=gm_headers,
    )
    assert resp.status_code == 204

    # The code no longer logs in.
    assert client.post("/api/auth/guest-login", json={"code": code}).status_code == 401

    # The guest does not appear in the global user list.
    users = client.get("/api/users", headers=admin_headers).json()
    assert all(u["id"] != created["user_id"] for u in users)


def test_guests_not_in_eligible_members(client, gm_headers, admin_headers, gm_campaign):
    _set_guest_access(client, admin_headers, True)
    client.post(
        f"/api/campaigns/{gm_campaign}/guests",
        json={"nickname": "Grace"},
        headers=gm_headers,
    )
    eligible = client.get(
        f"/api/campaigns/{gm_campaign}/eligible-members", headers=gm_headers
    ).json()
    assert all(u["role"] != "guest" for u in eligible)


def test_non_gm_campaign_rejects_guests(client, gm_headers, admin_headers):
    _set_guest_access(client, admin_headers, True)
    personal = client.post(
        "/api/campaigns",
        json={"name": "Personal", "is_gm_campaign": False},
        headers=gm_headers,
    ).json()["id"]
    resp = client.post(
        f"/api/campaigns/{personal}/guests",
        json={"nickname": "Heidi"},
        headers=gm_headers,
    )
    assert resp.status_code == 400
