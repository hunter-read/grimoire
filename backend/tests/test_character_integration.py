"""Phase 5 tests: campaign scoping, portraits, and portable export/import."""
import io

import pytest

from backend.config import SessionLocal
from backend.models import Campaign, CampaignMember, Character, HomebrewEntry


SCHEMA = {
    "id": "p5-demo",
    "name": "Phase 5 Demo",
    "content_types": {
        "spell": {
            "identity_field": "name",
            "fields": {"name": {"type": "text"}, "level": {"type": "number"}},
        }
    },
    "fields": {
        "level": {"type": "number", "label": "Level", "default": 1},
        "spells": {"type": "content_list", "content_type": "spell"},
    },
    "computed": {"spell_levels": {"formula": "sum_refs(spells, 'level')"}},
}


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(Character).delete()
        db.query(HomebrewEntry).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def both_schemas(client, admin_headers, gm_headers):
    for headers in (admin_headers, gm_headers):
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
    yield
    for headers in (admin_headers, gm_headers):
        client.delete("/api/characters/schemas/p5-demo", headers=headers)


@pytest.fixture
def party(admin_id, gm_id):
    """A campaign both accounts belong to."""
    db = SessionLocal()
    try:
        campaign = Campaign(name="Phase 5 Table", owner_id=admin_id)
        db.add(campaign)
        db.flush()
        db.add(CampaignMember(campaign_id=campaign.id, user_id=admin_id, status="joined"))
        db.add(CampaignMember(campaign_id=campaign.id, user_id=gm_id, status="joined"))
        db.commit()
        return campaign.id
    finally:
        db.close()


def _png() -> bytes:
    from PIL import Image

    buffer = io.BytesIO()
    Image.new("RGB", (4, 4), "red").save(buffer, format="PNG")
    return buffer.getvalue()


class TestCampaignScoping:
    def test_a_party_member_can_read_another_sheet(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Shared", "campaign_id": party},
            headers=admin_headers,
        ).json()
        resp = client.get(f"/api/characters/{created['id']}", headers=gm_headers)
        assert resp.status_code == 200
        # Readable, but not theirs.
        assert resp.json()["owned"] is False

    def test_a_party_member_cannot_edit_it(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Shared", "campaign_id": party},
            headers=admin_headers,
        ).json()
        assert client.put(
            f"/api/characters/{created['id']}",
            json={"name": "Hijacked"},
            headers=gm_headers,
        ).status_code == 404
        assert client.delete(
            f"/api/characters/{created['id']}", headers=gm_headers
        ).status_code == 404

    def test_an_unscoped_character_stays_private(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Solo"},
            headers=admin_headers,
        ).json()
        assert client.get(
            f"/api/characters/{created['id']}", headers=gm_headers
        ).status_code == 404

    def test_cannot_place_a_character_in_someone_elses_campaign(
        self, client, admin_headers, gm_id, both_schemas
    ):
        db = SessionLocal()
        try:
            campaign = Campaign(name="Not Yours", owner_id=gm_id)
            db.add(campaign)
            db.flush()
            db.add(CampaignMember(campaign_id=campaign.id, user_id=gm_id, status="joined"))
            db.commit()
            other = campaign.id
        finally:
            db.close()

        resp = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Intruder", "campaign_id": other},
            headers=admin_headers,
        )
        assert resp.status_code == 403

    def test_the_party_list_can_be_filtered_by_campaign(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "In Party", "campaign_id": party},
            headers=admin_headers,
        )
        client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Not In Party"},
            headers=admin_headers,
        )
        listed = client.get(
            f"/api/characters?campaign_id={party}", headers=gm_headers
        ).json()
        assert [c["name"] for c in listed["characters"]] == ["In Party"]

    def test_a_character_can_be_taken_out_of_a_campaign(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Leaving", "campaign_id": party},
            headers=admin_headers,
        ).json()
        client.put(
            f"/api/characters/{created['id']}",
            json={"campaign_id": ""},
            headers=admin_headers,
        )
        assert client.get(
            f"/api/characters/{created['id']}", headers=gm_headers
        ).status_code == 404


class TestPortraits:
    def test_uploads_serves_and_deletes(self, client, admin_headers, both_schemas):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Portrait"},
            headers=admin_headers,
        ).json()

        upload = client.post(
            f"/api/characters/{created['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=admin_headers,
        )
        assert upload.status_code == 200
        assert upload.json()["portrait_path"].endswith(".png")

        assert client.get(
            f"/api/characters/{created['id']}/portrait", headers=admin_headers
        ).status_code == 200

        assert client.delete(
            f"/api/characters/{created['id']}/portrait", headers=admin_headers
        ).status_code == 200
        assert client.get(
            f"/api/characters/{created['id']}/portrait", headers=admin_headers
        ).status_code == 404

    def test_rejects_a_file_that_is_not_an_image(self, client, admin_headers, both_schemas):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Bad"},
            headers=admin_headers,
        ).json()
        resp = client.post(
            f"/api/characters/{created['id']}/portrait",
            files={"file": ("x.png", b"not an image at all", "image/png")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_rejects_an_unsupported_type(self, client, admin_headers, both_schemas):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Bad type"},
            headers=admin_headers,
        ).json()
        resp = client.post(
            f"/api/characters/{created['id']}/portrait",
            files={"file": ("x.pdf", b"%PDF-1.4", "application/pdf")},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_only_the_owner_may_set_one(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Theirs", "campaign_id": party},
            headers=admin_headers,
        ).json()
        resp = client.post(
            f"/api/characters/{created['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=gm_headers,
        )
        assert resp.status_code == 404

    def test_a_party_member_may_see_one(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Visible", "campaign_id": party},
            headers=admin_headers,
        ).json()
        client.post(
            f"/api/characters/{created['id']}/portrait",
            files={"file": ("p.png", _png(), "image/png")},
            headers=admin_headers,
        )
        assert client.get(
            f"/api/characters/{created['id']}/portrait", headers=gm_headers
        ).status_code == 200


class TestExportImport:
    def _with_homebrew(self, client, headers):
        client.post(
            "/api/homebrew",
            json={
                "schema_id": "p5-demo",
                "content_type": "spell",
                "data": {"name": "My Spell", "level": 4},
            },
            headers=headers,
        )
        return client.post(
            "/api/characters",
            json={
                "schema_ref": "p5-demo",
                "name": "Exported",
                "data": {"level": 5, "spells": [{"_ref": "my-spell"}]},
            },
            headers=headers,
        ).json()

    def test_export_embeds_the_entries_and_the_schema(
        self, client, admin_headers, both_schemas
    ):
        created = self._with_homebrew(client, admin_headers)
        pack = client.get(
            f"/api/characters/{created['id']}/export", headers=admin_headers
        ).json()

        assert pack["$schema"] == "grimoire://character/v1"
        assert pack["schema"]["id"] == "p5-demo"
        # Denormalised: the referenced entry travels with the character.
        assert pack["entries"]["my-spell"]["data"]["level"] == 4

    def test_import_round_trips_onto_an_instance_with_nothing_installed(
        self, client, admin_headers, gm_headers, both_schemas
    ):
        created = self._with_homebrew(client, admin_headers)
        pack = client.get(
            f"/api/characters/{created['id']}/export", headers=admin_headers
        ).json()

        # The GM has the schema but not the homebrew, so the embedded copy is
        # what makes the sheet read correctly.
        imported = client.post(
            "/api/characters/import", json={"payload": pack}, headers=gm_headers
        )
        assert imported.status_code == 200
        body = imported.json()
        assert body["name"] == "Exported"
        assert body["data"]["level"] == 5
        assert body["computed"]["spell_levels"] == 4
        assert body["entries"]["my-spell"]["name"] == "My Spell"

    def test_import_installs_the_schema_when_missing(
        self, client, admin_headers, gm_headers
    ):
        """A character is unreadable without its schema, so the file carries one."""
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=admin_headers)
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Travelling", "data": {"level": 3}},
            headers=admin_headers,
        ).json()
        pack = client.get(
            f"/api/characters/{created['id']}/export", headers=admin_headers
        ).json()

        # The GM has nothing installed at all.
        assert client.get(
            "/api/characters/schemas/p5-demo", headers=gm_headers
        ).status_code == 404

        imported = client.post(
            "/api/characters/import", json={"payload": pack}, headers=gm_headers
        )
        assert imported.status_code == 200
        assert imported.json()["schema_missing"] is False
        assert client.get(
            "/api/characters/schemas/p5-demo", headers=gm_headers
        ).status_code == 200

        client.delete("/api/characters/schemas/p5-demo", headers=admin_headers)
        client.delete("/api/characters/schemas/p5-demo", headers=gm_headers)

    def test_import_prefers_what_is_already_installed(
        self, client, admin_headers, gm_headers, both_schemas
    ):
        """An erratum on this instance should reach an imported character."""
        created = self._with_homebrew(client, admin_headers)
        pack = client.get(
            f"/api/characters/{created['id']}/export", headers=admin_headers
        ).json()

        # The GM already has their own "my-spell", at a different level.
        client.post(
            "/api/homebrew",
            json={
                "schema_id": "p5-demo",
                "content_type": "spell",
                "entry_id": "my-spell",
                "data": {"name": "My Spell", "level": 9},
            },
            headers=gm_headers,
        )
        imported = client.post(
            "/api/characters/import", json={"payload": pack}, headers=gm_headers
        ).json()
        # Theirs wins over the embedded copy.
        assert imported["computed"]["spell_levels"] == 9

    def test_import_can_skip_recreating_entries(
        self, client, admin_headers, gm_headers, both_schemas
    ):
        created = self._with_homebrew(client, admin_headers)
        pack = client.get(
            f"/api/characters/{created['id']}/export", headers=admin_headers
        ).json()
        imported = client.post(
            "/api/characters/import",
            json={"payload": pack, "import_entries": False},
            headers=gm_headers,
        ).json()
        # The reference survives but resolves to nothing.
        assert imported["data"]["spells"] == [{"_ref": "my-spell"}]
        assert imported["entries"] == {}

    def test_rejects_a_file_naming_no_schema(self, client, admin_headers, both_schemas):
        resp = client.post(
            "/api/characters/import", json={"payload": {"name": "x"}}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_a_party_member_may_export_a_shared_sheet(
        self, client, admin_headers, gm_headers, both_schemas, party
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "p5-demo", "name": "Archivable", "campaign_id": party},
            headers=admin_headers,
        ).json()
        assert client.get(
            f"/api/characters/{created['id']}/export", headers=gm_headers
        ).status_code == 200


class TestAdminPackReload:
    def test_reload_is_admin_only(self, client, gm_headers):
        assert client.post("/api/content/packs/reload", headers=gm_headers).status_code == 403

    def test_admin_can_reload(self, client, admin_headers):
        resp = client.post("/api/content/packs/reload", headers=admin_headers)
        assert resp.status_code == 200
        assert "packs" in resp.json()
