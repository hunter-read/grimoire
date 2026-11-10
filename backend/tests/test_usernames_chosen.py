"""One rule for a username an account is given: trimmed, 2-100 characters, no
control characters - on create, on converting a guest, and at setup."""
import uuid

import pytest

from backend.usernames import USERNAME_MAX_LENGTH, clean_username

BAD = ["", "   ", "a", " a ", "ab\x00", "tab\there", "x" * (USERNAME_MAX_LENGTH + 1)]
BAD_IDS = ["empty", "blank", "one", "one-padded", "nul", "tab", "too-long"]


@pytest.mark.parametrize("name", BAD, ids=BAD_IDS)
def test_create_refuses_an_unusable_name(client, admin_headers, name):
    resp = client.post("/api/users", json={"username": name, "role": "player"}, headers=admin_headers)
    assert resp.status_code == 422, resp.text


def test_two_blank_names_are_both_refused(client, admin_headers):
    for name in ("", "   "):
        assert client.post(
            "/api/users", json={"username": name}, headers=admin_headers
        ).status_code == 422


def test_create_trims_the_name(client, admin_headers):
    name = f"trim{uuid.uuid4().hex[:6]}"
    resp = client.post("/api/users", json={"username": f"  {name}  "}, headers=admin_headers)
    assert resp.status_code == 201, resp.text
    assert resp.json()["username"] == name


@pytest.mark.parametrize("name", BAD, ids=BAD_IDS)
def test_converting_a_guest_refuses_an_unusable_name(client, admin_headers, gm_headers, name):
    client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)
    campaign = client.post(
        "/api/campaigns", json={"name": "Names", "is_gm_campaign": True}, headers=gm_headers
    ).json()["id"]
    guest = client.post(
        f"/api/campaigns/{campaign}/guests", json={"nickname": "Ivy"}, headers=gm_headers
    ).json()
    resp = client.post(
        f"/api/users/{guest['user_id']}/convert",
        json={"username": name, "password": "supersecret1"},
        headers=admin_headers,
    )
    assert resp.status_code == 422, resp.text


def test_the_rule_itself():
    assert clean_username("  Ada ") == "Ada"
    assert clean_username("x" * USERNAME_MAX_LENGTH) == "x" * USERNAME_MAX_LENGTH
    for name in BAD:
        with pytest.raises(ValueError):
            clean_username(name)
