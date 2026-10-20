"""A player letting their campaign's GM edit their character sheet.

The GM account owns the campaign; the player and the admin have both joined it.
The player's sheet is readable by everyone at the table, and - once the player
switches ``gm_can_edit`` on - editable by the GM, but never by the other player.
"""
import io
import os

import pytest

from backend.config import CHARACTER_IMAGE_DIR, SessionLocal
from backend.models import Campaign, CampaignMember, Character


SCHEMA = {
    "id": "gm-edit-demo",
    "name": "GM Edit Demo",
    "fields": {
        "hp": {"type": "number", "label": "HP", "default": 10},
        "crest": {"type": "image", "label": "Crest"},
    },
}


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(Character).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def sheets(client, admin_headers, gm_headers, player_headers):
    everyone = (admin_headers, gm_headers, player_headers)
    for headers in everyone:
        resp = client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
        assert resp.status_code == 200, resp.text
    yield
    for headers in everyone:
        client.delete("/api/characters/schemas/gm-edit-demo", headers=headers)


def _campaign(owner_id, *members):
    db = SessionLocal()
    try:
        campaign = Campaign(name="GM Edit Table", owner_id=owner_id)
        db.add(campaign)
        db.flush()
        for user_id in members:
            db.add(CampaignMember(campaign_id=campaign.id, user_id=user_id, status="accepted"))
        db.commit()
        return campaign.id
    finally:
        db.close()


@pytest.fixture
def table(gm_id, player_id, admin_id):
    """The GM runs it; the player and the admin are both at the table."""
    return _campaign(gm_id, player_id, admin_id)


@pytest.fixture
def pc(client, player_headers, sheets, table):
    resp = client.post(
        "/api/characters",
        json={"schema_ref": "gm-edit-demo", "name": "Hero", "campaign_id": table},
        headers=player_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _allow(client, player_headers, character_id, allowed=True):
    resp = client.put(
        f"/api/characters/{character_id}",
        json={"gm_can_edit": allowed},
        headers=player_headers,
    )
    assert resp.status_code == 200, resp.text
    return resp.json()


def _png() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "blue").save(buffer, format="PNG")
    return buffer.getvalue()


def _put(client, headers, character_id, **body):
    return client.put(f"/api/characters/{character_id}", json=body, headers=headers)


class TestDefaults:
    def test_off_for_a_new_character(self, pc):
        assert pc["gm_can_edit"] is False
        assert pc["campaign_has_gm"] is True
        assert pc["owned"] is True
        assert pc["editable"] is True

    def test_the_gm_reads_but_cannot_edit(self, client, gm_headers, pc):
        read = client.get(f"/api/characters/{pc['id']}", headers=gm_headers).json()
        assert read["owned"] is False
        assert read["editable"] is False
        assert _put(client, gm_headers, pc["id"], data={"hp": 1}).status_code == 404

    def test_a_personal_campaign_has_no_gm(self, client, player_headers, player_id, sheets):
        solo = _campaign(player_id)
        created = client.post(
            "/api/characters",
            json={"schema_ref": "gm-edit-demo", "campaign_id": solo},
            headers=player_headers,
        ).json()
        assert created["campaign_has_gm"] is False

    def test_no_campaign_has_no_gm(self, client, player_headers, sheets):
        created = client.post(
            "/api/characters", json={"schema_ref": "gm-edit-demo"}, headers=player_headers
        ).json()
        assert created["campaign_has_gm"] is False
        assert created["campaign_name"] is None


class TestGmEditing:
    def test_the_player_turns_it_on(self, client, player_headers, pc):
        assert _allow(client, player_headers, pc["id"])["gm_can_edit"] is True

    def test_the_gm_edits_values_and_name(self, client, gm_headers, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        resp = _put(client, gm_headers, pc["id"], name="Wounded Hero", data={"hp": 3})
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["data"]["hp"] == 3
        assert body["name"] == "Wounded Hero"
        assert body["owned"] is False
        assert body["editable"] is True
        # The player sees the GM's change, and still owns the sheet.
        mine = client.get(f"/api/characters/{pc['id']}", headers=player_headers).json()
        assert mine["data"]["hp"] == 3
        assert mine["owned"] is True

    def test_listing_marks_it_editable_for_the_gm(
        self, client, gm_headers, player_headers, pc, table
    ):
        _allow(client, player_headers, pc["id"])
        listed = client.get(f"/api/characters?campaign_id={table}", headers=gm_headers).json()
        assert [(c["id"], c["editable"]) for c in listed["characters"]] == [(pc["id"], True)]

    def test_another_player_still_cannot(self, client, admin_headers, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        read = client.get(f"/api/characters/{pc['id']}", headers=admin_headers).json()
        assert read["editable"] is False
        assert _put(client, admin_headers, pc["id"], data={"hp": 0}).status_code == 404

    def test_turning_it_off_shuts_the_gm_out(self, client, gm_headers, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        _allow(client, player_headers, pc["id"], allowed=False)
        assert _put(client, gm_headers, pc["id"], data={"hp": 1}).status_code == 404

    def test_the_gm_cannot_delete(self, client, gm_headers, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        assert client.delete(f"/api/characters/{pc['id']}", headers=gm_headers).status_code == 404

    @pytest.mark.parametrize(
        "body",
        [{"gm_can_edit": False}, {"campaign_id": ""}, {"status": "dead"}],
        ids=["access", "campaign", "status"],
    )
    def test_the_players_choices_stay_theirs(
        self, client, gm_headers, player_headers, pc, body
    ):
        _allow(client, player_headers, pc["id"])
        resp = _put(client, gm_headers, pc["id"], **body)
        assert resp.status_code == 403
        after = client.get(f"/api/characters/{pc['id']}", headers=player_headers).json()
        assert after["gm_can_edit"] is True
        assert after["campaign_id"] == pc["campaign_id"]
        assert after["status"] == "active"

    def test_the_gm_reframes_and_replaces_the_portrait(
        self, client, gm_headers, player_headers, pc
    ):
        _allow(client, player_headers, pc["id"])
        uploaded = client.post(
            f"/api/characters/{pc['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=gm_headers,
        )
        assert uploaded.status_code == 200, uploaded.text
        crop = _put(client, gm_headers, pc["id"], portrait_crop={"x": 20, "y": 30, "zoom": 2})
        assert crop.json()["portrait_crop"] == {"x": 20, "y": 30, "zoom": 2}
        removed = client.delete(f"/api/characters/{pc['id']}/portrait", headers=gm_headers)
        assert removed.status_code == 200

    def test_the_gm_sets_an_image_field(self, client, gm_headers, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        resp = client.post(
            f"/api/characters/{pc['id']}/images/crest",
            files={"file": ("c.png", _png(), "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 200, resp.text
        assert os.listdir(os.path.join(CHARACTER_IMAGE_DIR, pc["id"]))
        removed = client.delete(f"/api/characters/{pc['id']}/images/crest", headers=gm_headers)
        assert removed.status_code == 200

    def test_without_access_pictures_stay_the_players(self, client, gm_headers, pc):
        assert client.post(
            f"/api/characters/{pc['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=gm_headers,
        ).status_code == 404
        assert client.post(
            f"/api/characters/{pc['id']}/images/crest",
            files={"file": ("c.png", _png(), "image/png")},
            headers=gm_headers,
        ).status_code == 404


class TestMovingCampaigns:
    def test_moving_to_another_table_turns_it_off(
        self, client, gm_headers, player_headers, admin_id, player_id, pc
    ):
        _allow(client, player_headers, pc["id"])
        elsewhere = _campaign(admin_id, player_id)
        moved = _put(client, player_headers, pc["id"], campaign_id=elsewhere).json()
        assert moved["gm_can_edit"] is False
        assert _put(client, gm_headers, pc["id"], data={"hp": 1}).status_code == 404

    def test_resending_the_same_campaign_keeps_it(self, client, player_headers, pc):
        _allow(client, player_headers, pc["id"])
        kept = _put(client, player_headers, pc["id"], campaign_id=pc["campaign_id"]).json()
        assert kept["gm_can_edit"] is True

    def test_moving_and_allowing_in_one_patch(
        self, client, player_headers, admin_headers, admin_id, player_id, pc
    ):
        elsewhere = _campaign(admin_id, player_id)
        moved = _put(
            client, player_headers, pc["id"], campaign_id=elsewhere, gm_can_edit=True
        ).json()
        assert moved["gm_can_edit"] is True
        assert _put(client, admin_headers, pc["id"], data={"hp": 2}).status_code == 200
