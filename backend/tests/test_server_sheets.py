"""Tests for server-wide character sheets.

An admin can install a sheet for every account (``server_wide=true``): a row in
``character_schemas`` with no owner. Everyone without a copy of their own uses
it; a user's own copy of the same schema id wins over it, so an edit someone
made to their sheet survives the admin installing the stock one.
"""
import hashlib
import json

import pytest

from backend.config import SessionLocal
from backend.models import Campaign, CampaignMember, Character, CharacterSchema
from backend.services.characters import catalogue as cat
from backend.services.characters import packs
from backend.services.gm_screen import party

SHEET = {
    "id": "everyone-sheet",
    "name": "Everyone Sheet",
    "system": "Demo",
    "version": "1.0.0",
    "fields": {
        "name": {"type": "text", "label": "Name"},
        "level": {"type": "number", "label": "Level", "default": 1},
    },
    "computed": {"double": {"formula": "level * 2"}},
}
MINE = {**SHEET, "name": "My Everyone Sheet", "computed": {"double": {"formula": "level * 3"}}}
URL = "/api/characters/schemas"


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(Character).filter(Character.schema_ref == SHEET["id"]).delete()
        db.query(CharacterSchema).filter(CharacterSchema.schema_id == SHEET["id"]).delete()
        db.commit()
    finally:
        db.close()


def _install(client, headers, document=SHEET, **params):
    return client.post(URL, json={"document": document}, headers=headers, params=params)


def _listed(client, headers):
    rows = client.get(URL, headers=headers).json()["schemas"]
    return [row for row in rows if row["schema_id"] == SHEET["id"]]


class TestInstalling:
    def test_only_an_admin_installs_for_everyone(self, client, gm_headers, player_headers):
        for headers in (gm_headers, player_headers):
            response = _install(client, headers, server_wide="true")
            assert response.status_code == 403
            assert "administrator" in response.json()["detail"]

    def test_everyone_gets_a_server_wide_sheet(self, client, admin_headers, player_headers):
        response = _install(client, admin_headers, server_wide="true")
        assert response.status_code == 200, response.text
        assert response.json()["server_wide"] is True

        listed = _listed(client, player_headers)
        assert [(row["name"], row["server_wide"]) for row in listed] == [
            ("Everyone Sheet", True)
        ]
        detail = client.get(f"{URL}/{SHEET['id']}", headers=player_headers).json()
        assert detail["server_wide"] is True
        assert detail["document"]["computed"]["double"]["formula"] == "level * 2"

        # And a player can build a character on it straight away.
        created = client.post(
            "/api/characters",
            json={"schema_ref": SHEET["id"], "name": "Ada", "data": {"level": 4}},
            headers=player_headers,
        )
        assert created.status_code == 200, created.text
        assert created.json()["computed"]["double"] == 8
        assert _listed(client, player_headers)[0]["character_count"] == 1

    def test_installing_again_replaces_rather_than_duplicates(self, client, admin_headers):
        _install(client, admin_headers, server_wide="true")
        _install(client, admin_headers, {**SHEET, "version": "1.1.0"}, server_wide="true")
        db = SessionLocal()
        try:
            rows = db.query(CharacterSchema).filter_by(schema_id=SHEET["id"]).all()
            assert [(row.user_id, row.version) for row in rows] == [(None, "1.1.0")]
        finally:
            db.close()

    def test_an_own_copy_wins_over_the_server_one(
        self, client, admin_headers, player_headers
    ):
        _install(client, admin_headers, server_wide="true")
        assert _install(client, player_headers, MINE).status_code == 200
        listed = _listed(client, player_headers)
        assert [(row["name"], row["server_wide"]) for row in listed] == [
            ("My Everyone Sheet", False)
        ]
        created = client.post(
            "/api/characters",
            json={"schema_ref": SHEET["id"], "name": "Bo", "data": {"level": 2}},
            headers=player_headers,
        ).json()
        assert created["computed"]["double"] == 6

        # Removing their own copy drops them back onto the server's.
        assert client.delete(f"{URL}/{SHEET['id']}", headers=player_headers).status_code == 200
        again = client.get(f"/api/characters/{created['id']}", headers=player_headers).json()
        assert again["computed"]["double"] == 4


class TestRemoving:
    def test_a_user_cannot_remove_the_server_copy(self, client, admin_headers, player_headers):
        _install(client, admin_headers, server_wide="true")
        response = client.delete(f"{URL}/{SHEET['id']}", headers=player_headers)
        assert response.status_code == 403
        response = client.delete(
            f"{URL}/{SHEET['id']}", headers=player_headers, params={"server_wide": "true"}
        )
        assert response.status_code == 403

    def test_an_admin_removes_it_only_by_asking(self, client, admin_headers, player_headers):
        _install(client, admin_headers, server_wide="true")
        # Their ordinary delete is about their own list, which has no copy.
        assert client.delete(f"{URL}/{SHEET['id']}", headers=admin_headers).status_code == 403
        response = client.delete(
            f"{URL}/{SHEET['id']}", headers=admin_headers, params={"server_wide": "true"}
        )
        assert response.status_code == 200
        assert _listed(client, player_headers) == []

    def test_removing_a_missing_server_copy_is_404(self, client, admin_headers):
        response = client.delete(
            f"{URL}/{SHEET['id']}", headers=admin_headers, params={"server_wide": "true"}
        )
        assert response.status_code == 404


def _offer(monkeypatch, version):
    body = json.dumps(SHEET).encode()
    monkeypatch.setattr(
        cat,
        "fetch_document",
        lambda url, **kwargs: {
            "sheets": [
                {
                    "id": SHEET["id"],
                    "name": SHEET["name"],
                    "version": version,
                    "path": "character-sheets/everyone-sheet/everyone-sheet.json",
                    "sha256": hashlib.sha256(body).hexdigest(),
                }
            ]
        },
    )
    monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: {**SHEET, "version": version})


class TestCatalogue:
    def test_an_admin_installs_from_the_catalogue_for_everyone(
        self, client, admin_headers, player_headers, monkeypatch
    ):
        _offer(monkeypatch, "1.0.0")
        refused = client.post(
            f"{URL}/install/{SHEET['id']}", headers=player_headers, params={"server_wide": "true"}
        )
        assert refused.status_code == 403
        response = client.post(
            f"{URL}/install/{SHEET['id']}", headers=admin_headers, params={"server_wide": "true"}
        )
        assert response.status_code == 200, response.text
        assert response.json()["server_wide"] is True

        listing = client.get(f"{URL}/browse", headers=player_headers).json()
        sheet = next(row for row in listing["sheets"] if row["raw_id"] == SHEET["id"])
        assert sheet["installed"] is False
        assert sheet["installed_server_wide"] is True
        assert sheet["server_installed_version"] == "1.0.0"

    def test_an_admin_sees_server_wide_updates(
        self, client, admin_headers, player_headers, monkeypatch
    ):
        _offer(monkeypatch, "1.0.0")
        client.post(
            f"{URL}/install/{SHEET['id']}", headers=admin_headers, params={"server_wide": "true"}
        )
        _offer(monkeypatch, "1.2.0")
        updates = client.get(f"{URL}/updates", headers=admin_headers).json()["updates"]
        assert [(row["schema_id"], row["version"], row["server_wide"]) for row in updates] == [
            (SHEET["id"], "1.2.0", True)
        ]
        # A player has no copy of their own to update, and cannot update everyone's.
        assert client.get(f"{URL}/updates", headers=player_headers).json() == {"updates": []}


def test_packs_index_against_the_server_copy_first(client, admin_headers, player_headers):
    _install(client, player_headers, MINE)
    _install(client, admin_headers, server_wide="true")
    db = SessionLocal()
    try:
        db.add(packs.ContentPack(pack_id="everyone-pack", schema_id=SHEET["id"], name="P"))
        db.commit()
        documents = packs.schema_documents_for_packs(db)
        assert documents[SHEET["id"]]["name"] == "Everyone Sheet"
    finally:
        db.query(packs.ContentPack).filter_by(pack_id="everyone-pack").delete()
        db.commit()
        db.close()


def test_the_party_overview_falls_back_to_the_server_sheet(
    client, admin_headers, gm_id, player_id, player_headers
):
    _install(client, admin_headers, server_wide="true")
    created = client.post(
        "/api/characters",
        json={"schema_ref": SHEET["id"], "name": "Cy", "data": {"level": 5}},
        headers=player_headers,
    ).json()
    db = SessionLocal()
    try:
        campaign = Campaign(name="Server sheet table", owner_id=gm_id)
        db.add(campaign)
        db.flush()
        db.add(CampaignMember(campaign_id=campaign.id, user_id=player_id, status="accepted"))
        db.query(Character).filter_by(id=created["id"]).update({"campaign_id": campaign.id})
        db.commit()
        overview = party.party_overview(db, campaign.id, gm_id)
        row = next(item for item in overview["characters"] if item["id"] == created["id"])
        assert row["values"]["double"] == 10
    finally:
        db.query(Character).filter_by(id=created["id"]).delete()
        db.query(CampaignMember).filter_by(campaign_id=campaign.id).delete()
        db.query(Campaign).filter_by(id=campaign.id).delete()
        db.commit()
        db.close()
