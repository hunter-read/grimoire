"""A campaign's parent: only another of its owner's campaigns, and deleting the
parent leaves its child campaigns standing on their own.

`campaigns.parent_campaign_id` points at `campaigns` with no ON DELETE, so the
children's links are cleared before a parent is deleted - by its owner or along
with the owner's account.
"""
import uuid

from backend.config import SessionLocal
from backend.models import Campaign


def _make_user(client, admin_headers, role="gm"):
    username = f"parent_{uuid.uuid4().hex[:8]}"
    password = "password123-long"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": role},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    login = client.post("/api/auth/login", json={"username": username, "password": password})
    assert login.status_code == 200, login.text
    return resp.json(), {"Authorization": f"Bearer {login.json()['token']}"}


def _create(client, headers, **body):
    return client.post(
        "/api/campaigns", json={"name": f"Camp {uuid.uuid4().hex[:6]}", **body}, headers=headers
    )


def _parent_of(cid):
    db = SessionLocal()
    try:
        row = db.query(Campaign).filter_by(id=cid).first()
        return row.parent_campaign_id if row else "gone"
    finally:
        db.close()


class TestParentCampaign:
    def test_a_campaign_sits_under_another_of_its_owners(self, client, admin_headers):
        _, headers = _make_user(client, admin_headers)
        parent = _create(client, headers).json()["id"]
        child = _create(client, headers, parent_campaign_id=parent)
        assert child.status_code == 201, child.text
        assert child.json()["parent_campaign_id"] == parent

        other = _create(client, headers).json()["id"]
        moved = client.patch(
            f"/api/campaigns/{other}", json={"parent_campaign_id": parent}, headers=headers
        )
        assert moved.status_code == 200, moved.text
        assert moved.json()["parent_campaign_id"] == parent
        cleared = client.patch(
            f"/api/campaigns/{other}", json={"parent_campaign_id": ""}, headers=headers
        )
        assert cleared.json()["parent_campaign_id"] is None

    def test_someone_elses_or_a_missing_campaign_is_not_found(self, client, admin_headers):
        _, gm = _make_user(client, admin_headers)
        _, player = _make_user(client, admin_headers, role="player")
        theirs = _create(client, gm).json()["id"]

        assert _create(client, player, parent_campaign_id=theirs).status_code == 404
        assert _create(client, player, parent_campaign_id="no-such-id").status_code == 404
        mine = _create(client, player).json()["id"]
        resp = client.patch(
            f"/api/campaigns/{mine}", json={"parent_campaign_id": theirs}, headers=player
        )
        assert resp.status_code == 404
        assert _parent_of(mine) is None

    def test_a_campaign_is_not_its_own_parent(self, client, admin_headers):
        _, headers = _make_user(client, admin_headers)
        cid = _create(client, headers).json()["id"]
        resp = client.patch(
            f"/api/campaigns/{cid}", json={"parent_campaign_id": cid}, headers=headers
        )
        assert resp.status_code == 400

    def test_resending_the_stored_parent_is_not_checked_again(self, client, admin_headers):
        # A link made before parents were checked does not block every other edit.
        _, gm = _make_user(client, admin_headers)
        _, player = _make_user(client, admin_headers, role="player")
        theirs = _create(client, gm).json()["id"]
        mine = _create(client, player).json()["id"]
        db = SessionLocal()
        try:
            db.query(Campaign).filter_by(id=mine).update({"parent_campaign_id": theirs})
            db.commit()
        finally:
            db.close()
        resp = client.patch(
            f"/api/campaigns/{mine}",
            json={"name": "Renamed", "parent_campaign_id": theirs},
            headers=player,
        )
        assert resp.status_code == 200, resp.text

    def test_the_owner_deletes_a_parent_and_its_children_stay(self, client, admin_headers):
        _, gm = _make_user(client, admin_headers)
        _, player = _make_user(client, admin_headers, role="player")
        parent = _create(client, gm).json()["id"]
        child = _create(client, gm, parent_campaign_id=parent).json()["id"]
        # A link to someone else's campaign, as could be made before the check.
        stray = _create(client, player).json()["id"]
        db = SessionLocal()
        try:
            db.query(Campaign).filter_by(id=stray).update({"parent_campaign_id": parent})
            db.commit()
        finally:
            db.close()

        resp = client.delete(f"/api/campaigns/{parent}", headers=gm)
        assert resp.status_code == 204, resp.text
        assert _parent_of(parent) == "gone"
        assert _parent_of(child) is None
        assert _parent_of(stray) is None

    def test_deleting_the_owner_keeps_others_children(self, client, admin_headers):
        user, gm = _make_user(client, admin_headers)
        _, player = _make_user(client, admin_headers, role="player")
        parent = _create(client, gm).json()["id"]
        child = _create(client, gm, parent_campaign_id=parent).json()["id"]
        stray = _create(client, player).json()["id"]
        db = SessionLocal()
        try:
            db.query(Campaign).filter_by(id=stray).update({"parent_campaign_id": parent})
            db.commit()
        finally:
            db.close()

        resp = client.delete(f"/api/users/{user['id']}", headers=admin_headers)
        assert resp.status_code == 204, resp.text
        assert _parent_of(parent) == "gone"
        assert _parent_of(child) == "gone"
        assert _parent_of(stray) is None
