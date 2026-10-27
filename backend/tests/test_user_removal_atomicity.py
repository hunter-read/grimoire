"""Removing or merging users lands or rolls back as one.

Each path ends a user's sessions partway through a larger change. The session
helpers used to commit on their own, so a failure after them left the sessions
gone while everything else stayed: a user who could no longer sign in, a
campaign deletion committed up to the first guest, a merge half applied. Each
test here fails the step after the sessions go and checks nothing changed.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import AuthSession, Campaign, CampaignMember, User


class _Injected(RuntimeError):
    pass


def _fail(*_args, **_kwargs):
    raise _Injected("failure injected after the sessions were ended")


def _session_count(user_id: str) -> int:
    db = SessionLocal()
    try:
        return db.query(AuthSession).filter_by(user_id=user_id).count()
    finally:
        db.close()


def _exists(model, row_id: str) -> bool:
    db = SessionLocal()
    try:
        return db.query(model).filter_by(id=row_id).first() is not None
    finally:
        db.close()


def _user_with_session(client, admin_headers) -> tuple[str, str]:
    """A fresh permanent player, signed in once. Returns (user id, token)."""
    username = f"atomic-{uuid.uuid4().hex[:8]}"
    password = "atomic-test-passphrase"
    created = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": "player"},
        headers=admin_headers,
    )
    assert created.status_code == 201, created.text
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    client.cookies.clear()
    return created.json()["id"], login.json()["token"]


@pytest.fixture
def guest_campaign(client, gm_headers, admin_headers):
    """Returns a factory: invite a guest to a fresh campaign and sign them in."""
    client.patch("/api/settings", json={"guest_access_enabled": True}, headers=admin_headers)

    def make(campaign_id: str | None = None) -> dict:
        if campaign_id is None:
            campaign_id = client.post(
                "/api/campaigns",
                json={"name": f"Atomic {uuid.uuid4().hex[:6]}", "is_gm_campaign": True},
                headers=gm_headers,
            ).json()["id"]
        guest = client.post(
            f"/api/campaigns/{campaign_id}/guests",
            json={"nickname": "Wren"},
            headers=gm_headers,
        ).json()
        login = client.post("/api/auth/guest-login", json={"code": guest["guest_code"]})
        assert login.status_code == 200, login.text
        client.cookies.clear()
        guest["campaign_id"] = campaign_id
        assert _session_count(guest["user_id"]) == 1
        return guest

    return make


def test_admin_delete_rolls_back_with_sessions(client, admin_headers, monkeypatch):
    uid, _ = _user_with_session(client, admin_headers)
    monkeypatch.setattr("backend.routers.users.core.purge_user_data", _fail)
    with pytest.raises(_Injected):
        client.delete(f"/api/users/{uid}", headers=admin_headers)
    assert _exists(User, uid)
    assert _session_count(uid) == 1


def test_self_delete_rolls_back_with_sessions(client, admin_headers, monkeypatch):
    uid, token = _user_with_session(client, admin_headers)
    monkeypatch.setattr("backend.routers.users.me.purge_user_data", _fail)
    with pytest.raises(_Injected):
        client.delete("/api/users/me", headers={"Authorization": f"Bearer {token}"})
    assert _exists(User, uid)
    assert _session_count(uid) == 1


def test_failed_multi_source_merge_moves_nothing(
    client, admin_headers, guest_campaign, monkeypatch
):
    """The second source fails, so the first must not have been merged."""
    import backend.routers.users.core as users_core

    keep, first, second = guest_campaign(), guest_campaign(), guest_campaign()
    real = users_core.reassign_user_data
    calls = []

    def fail_on_second(db, source_id, target_id):
        calls.append(source_id)
        if len(calls) == 2:
            _fail()
        return real(db, source_id, target_id)

    monkeypatch.setattr(users_core, "reassign_user_data", fail_on_second)
    with pytest.raises(_Injected):
        client.post(
            f"/api/users/{keep['user_id']}/merge",
            json={"source_ids": [first["user_id"], second["user_id"]]},
            headers=admin_headers,
        )
    assert len(calls) == 2
    for source in (first, second):
        assert _exists(User, source["user_id"])
        assert _session_count(source["user_id"]) == 1
        assert _exists(CampaignMember, source["id"])
    db = SessionLocal()
    try:
        assert db.query(CampaignMember).filter_by(id=first["id"]).one().user_id == (
            first["user_id"]
        )
    finally:
        db.close()


def test_campaign_delete_rolls_back_with_guest_sessions(
    client, gm_headers, guest_campaign, monkeypatch
):
    guest = guest_campaign()
    monkeypatch.setattr("backend.services.campaigns.user_data.purge_user_data", _fail)
    with pytest.raises(_Injected):
        client.delete(f"/api/campaigns/{guest['campaign_id']}", headers=gm_headers)
    assert _exists(Campaign, guest["campaign_id"])
    assert _exists(User, guest["user_id"])
    assert _session_count(guest["user_id"]) == 1


def test_member_removal_rolls_back_with_guest_sessions(
    client, gm_headers, guest_campaign, monkeypatch
):
    guest = guest_campaign()
    monkeypatch.setattr("backend.services.campaigns.user_data.purge_user_data", _fail)
    with pytest.raises(_Injected):
        client.delete(
            f"/api/campaigns/{guest['campaign_id']}/members/{guest['user_id']}",
            headers=gm_headers,
        )
    assert _exists(CampaignMember, guest["id"])
    assert _exists(User, guest["user_id"])
    assert _session_count(guest["user_id"]) == 1


def test_guest_removal_rolls_back_with_guest_sessions(
    client, gm_headers, guest_campaign, monkeypatch
):
    guest = guest_campaign()
    monkeypatch.setattr("backend.services.campaigns.user_data.purge_user_data", _fail)
    with pytest.raises(_Injected):
        client.delete(
            f"/api/campaigns/{guest['campaign_id']}/guests/{guest['id']}",
            headers=gm_headers,
        )
    assert _exists(CampaignMember, guest["id"])
    assert _exists(User, guest["user_id"])
    assert _session_count(guest["user_id"]) == 1
