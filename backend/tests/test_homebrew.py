"""Tests for homebrew: ownership, visibility, forking, and portable packs.

Visibility is the property that matters most. It is enforced server-side in one
shared filter, and these tests check it from both directions — that a stranger
cannot see a private entry, and that a campaign member can see a shared one.
"""
import pytest

from backend.config import SessionLocal
from backend.services.characters import homebrew as hb
from backend.models import Campaign, CampaignMember, HomebrewEntry


SCHEMA = {
    "id": "hb-demo",
    "name": "Homebrew Demo",
    "content_types": {
        "spell": {
            "label": "Spell",
            "identity_field": "name",
            "fields": {
                "name": {"type": "text", "label": "Name"},
                "level": {"type": "number", "label": "Level"},
                "school": {"type": "text", "label": "School"},
            },
        }
    },
    "fields": {
        "spells": {"type": "content_list", "content_type": "spell", "allow_freeform": True}
    },
}


@pytest.fixture(autouse=True)
def _clean_homebrew():
    yield
    db = SessionLocal()
    try:
        db.query(HomebrewEntry).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def schemas(client, admin_headers, gm_headers):
    """The schema installed for both accounts, since schemas are per user."""
    for headers in (admin_headers, gm_headers):
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
    yield
    for headers in (admin_headers, gm_headers):
        client.delete("/api/characters/schemas/hb-demo", headers=headers)


def _create(client, headers, **overrides):
    payload = {
        "schema_id": "hb-demo",
        "content_type": "spell",
        "data": {"name": "Hellfire Blast", "level": 4, "school": "evocation"},
    }
    payload.update(overrides)
    return client.post("/api/homebrew", json=payload, headers=headers)


class TestHomebrewCrud:
    def test_creates_an_entry_and_derives_its_id(self, client, admin_headers, schemas):
        resp = _create(client, admin_headers)
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["entry_id"] == "hellfire-blast"
        assert body["name"] == "Hellfire Blast"
        assert body["visibility"] == "private"
        assert body["owned"] is True

    @pytest.mark.parametrize(
        "name,expected",
        [
            ("Hunter's Bolt", "hunters-bolt"),
            ("Hunter\u2019s Bolt", "hunters-bolt"),
            ("Fire Ball", "fire-ball"),
            ("  Wish  ", "wish"),
        ],
    )
    def test_derives_a_readable_id_from_the_name(
        self, client, admin_headers, schemas, name, expected
    ):
        # An apostrophe is dropped rather than turned into a separator: a stray
        # `s` in `hunter-s-bolt` looks like a typo to anyone who has to type it.
        resp = _create(client, admin_headers, data={"name": name, "level": 1})
        assert resp.json()["entry_id"] == expected

    def test_coerces_entry_data_like_pack_content(self, client, admin_headers, schemas):
        resp = _create(
            client,
            admin_headers,
            data={"name": "Coerced", "level": "7", "school": "x", "junk": "dropped"},
        )
        data = resp.json()["data"]
        assert data["level"] == 7
        assert "junk" not in data

    def test_rejects_an_entry_with_no_name(self, client, admin_headers, schemas):
        resp = _create(client, admin_headers, data={"level": 1})
        assert resp.status_code == 400
        assert "name" in resp.json()["detail"].lower()

    def test_rejects_an_unknown_content_type(self, client, admin_headers, schemas):
        resp = _create(client, admin_headers, content_type="ghost")
        assert resp.status_code == 400

    def test_rejects_a_schema_the_user_has_not_installed(self, client, admin_headers):
        resp = _create(client, admin_headers, schema_id="not-installed")
        assert resp.status_code == 400

    def test_refuses_a_duplicate_entry_id(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        resp = _create(client, admin_headers)
        assert resp.status_code == 409

    def test_edits_an_entry(self, client, admin_headers, schemas):
        created = _create(client, admin_headers).json()
        resp = client.put(
            f"/api/homebrew/{created['id']}",
            json={"data": {"name": "Renamed", "level": 9, "school": "evocation"}},
            headers=admin_headers,
        )
        assert resp.json()["name"] == "Renamed"
        assert resp.json()["data"]["level"] == 9

    def test_deletes_an_entry(self, client, admin_headers, schemas):
        created = _create(client, admin_headers).json()
        assert client.delete(
            f"/api/homebrew/{created['id']}", headers=admin_headers
        ).status_code == 200
        assert client.get(
            f"/api/homebrew/{created['id']}", headers=admin_headers
        ).status_code == 404

    def test_reports_how_many_characters_use_an_entry(self, client, admin_headers, schemas):
        created = _create(client, admin_headers).json()
        client.post(
            "/api/characters",
            json={
                "schema_ref": "hb-demo",
                "name": "User",
                "data": {"spells": [{"_ref": "hellfire-blast"}]},
            },
            headers=admin_headers,
        )
        listed = client.get("/api/homebrew", headers=admin_headers).json()["entries"]
        mine = [entry for entry in listed if entry["id"] == created["id"]]
        assert mine[0]["used_by"] == 1

    def test_deleting_does_not_destroy_a_character(self, client, admin_headers, schemas):
        """A reference is soft: the sheet marks it missing rather than losing it."""
        created = _create(client, admin_headers).json()
        character = client.post(
            "/api/characters",
            json={
                "schema_ref": "hb-demo",
                "name": "Survivor",
                "data": {"spells": [{"_ref": "hellfire-blast"}]},
            },
            headers=admin_headers,
        ).json()

        client.delete(f"/api/homebrew/{created['id']}", headers=admin_headers)

        after = client.get(f"/api/characters/{character['id']}", headers=admin_headers).json()
        assert after["data"]["spells"] == [{"_ref": "hellfire-blast"}]
        assert after["entries"] == {}

    def test_requires_authentication(self, client):
        assert client.get("/api/homebrew").status_code in (401, 403)


class TestVisibility:
    def test_private_entries_are_invisible_to_others(
        self, client, admin_headers, gm_headers, schemas
    ):
        created = _create(client, admin_headers).json()
        listed = client.get("/api/homebrew", headers=gm_headers).json()["entries"]
        assert created["id"] not in [entry["id"] for entry in listed]
        assert client.get(
            f"/api/homebrew/{created['id']}", headers=gm_headers
        ).status_code == 404

    def test_public_entries_are_visible_to_everyone(
        self, client, admin_headers, gm_headers, schemas
    ):
        created = _create(client, admin_headers).json()
        client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "public"},
            headers=admin_headers,
        )
        resp = client.get(f"/api/homebrew/{created['id']}", headers=gm_headers)
        assert resp.status_code == 200
        # Visible, but not theirs to edit.
        assert resp.json()["owned"] is False

    def test_a_shared_entry_is_still_only_editable_by_its_owner(
        self, client, admin_headers, gm_headers, schemas
    ):
        created = _create(client, admin_headers).json()
        client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "public"},
            headers=admin_headers,
        )
        assert client.put(
            f"/api/homebrew/{created['id']}",
            json={"data": {"name": "Hijacked"}},
            headers=gm_headers,
        ).status_code == 404
        assert client.delete(
            f"/api/homebrew/{created['id']}", headers=gm_headers
        ).status_code == 404

    def test_campaign_sharing_reaches_members_only(
        self, client, admin_headers, gm_headers, admin_id, gm_id, schemas
    ):
        db = SessionLocal()
        try:
            campaign = Campaign(name="Shared Table", owner_id=admin_id)
            db.add(campaign)
            db.flush()
            db.add(CampaignMember(campaign_id=campaign.id, user_id=admin_id, status="joined"))
            db.commit()
            campaign_id = campaign.id
        finally:
            db.close()

        created = _create(client, admin_headers).json()
        shared = client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "campaign", "campaign_id": campaign_id},
            headers=admin_headers,
        )
        assert shared.status_code == 200

        # The GM is not in the campaign, so sharing to it must not reach them.
        assert client.get(
            f"/api/homebrew/{created['id']}", headers=gm_headers
        ).status_code == 404

        db = SessionLocal()
        try:
            db.add(CampaignMember(campaign_id=campaign_id, user_id=gm_id, status="joined"))
            db.commit()
        finally:
            db.close()

        assert client.get(
            f"/api/homebrew/{created['id']}", headers=gm_headers
        ).status_code == 200

    def test_cannot_share_into_a_campaign_you_are_not_in(
        self, client, admin_headers, gm_headers, gm_id, schemas
    ):
        db = SessionLocal()
        try:
            campaign = Campaign(name="Not Yours", owner_id=gm_id)
            db.add(campaign)
            db.flush()
            db.add(CampaignMember(campaign_id=campaign.id, user_id=gm_id, status="joined"))
            db.commit()
            campaign_id = campaign.id
        finally:
            db.close()

        created = _create(client, admin_headers).json()
        resp = client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "campaign", "campaign_id": campaign_id},
            headers=admin_headers,
        )
        assert resp.status_code == 403

    def test_campaign_sharing_needs_a_campaign(self, client, admin_headers, schemas):
        created = _create(client, admin_headers).json()
        resp = client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "campaign"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_rejects_an_unknown_visibility(self, client, admin_headers, schemas):
        created = _create(client, admin_headers).json()
        resp = client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "everyone"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_two_users_may_each_own_the_same_entry_id(
        self, client, admin_headers, gm_headers, schemas
    ):
        assert _create(client, admin_headers).status_code == 200
        assert _create(client, gm_headers).status_code == 200


class TestForking:
    def test_forks_visible_homebrew(self, client, admin_headers, gm_headers, schemas):
        created = _create(client, admin_headers).json()
        client.patch(
            f"/api/homebrew/{created['id']}/share",
            json={"visibility": "public"},
            headers=admin_headers,
        )
        resp = client.post(
            "/api/homebrew/fork",
            json={
                "schema_id": "hb-demo",
                "content_type": "spell",
                "entry_id": "hellfire-blast",
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["owned"] is True
        assert body["name"].endswith("(copy)")
        assert body["forked_from"] == "homebrew:hellfire-blast"

    def test_forking_twice_does_not_collide(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        first = client.post(
            "/api/homebrew/fork",
            json={"schema_id": "hb-demo", "content_type": "spell",
                  "entry_id": "hellfire-blast"},
            headers=admin_headers,
        ).json()
        second = client.post(
            "/api/homebrew/fork",
            json={"schema_id": "hb-demo", "content_type": "spell",
                  "entry_id": "hellfire-blast"},
            headers=admin_headers,
        ).json()
        assert first["entry_id"] != second["entry_id"]

    def test_forking_something_that_does_not_exist_is_404(
        self, client, admin_headers, schemas
    ):
        resp = client.post(
            "/api/homebrew/fork",
            json={"schema_id": "hb-demo", "content_type": "spell", "entry_id": "ghost"},
            headers=admin_headers,
        )
        assert resp.status_code == 404


class TestPacks:
    def test_exports_and_reimports(self, client, admin_headers, gm_headers, schemas):
        _create(client, admin_headers)
        pack = client.get("/api/homebrew/export?schema_id=hb-demo", headers=admin_headers).json()
        assert pack["$schema"] == hb.PACK_SCHEMA
        assert pack["entries"]["spell"][0]["_id"] == "hellfire-blast"

        result = client.post(
            "/api/homebrew/import", json={"pack": pack}, headers=gm_headers
        ).json()
        assert result["imported"] == 1

        listed = client.get("/api/homebrew?mine_only=true", headers=gm_headers).json()
        assert [entry["entry_id"] for entry in listed["entries"]] == ["hellfire-blast"]

    def test_import_skips_conflicts_by_default(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        pack = client.get(
            "/api/homebrew/export?schema_id=hb-demo", headers=admin_headers
        ).json()
        result = client.post(
            "/api/homebrew/import", json={"pack": pack}, headers=admin_headers
        ).json()
        assert result == {
            "imported": 0, "skipped": 1, "renamed": 0, "overwritten": 0, "failed": []
        }

    def test_import_can_rename_or_overwrite(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        pack = client.get(
            "/api/homebrew/export?schema_id=hb-demo", headers=admin_headers
        ).json()

        renamed = client.post(
            "/api/homebrew/import",
            json={"pack": pack, "conflict": "rename"},
            headers=admin_headers,
        ).json()
        assert renamed["renamed"] == 1

        pack["entries"]["spell"][0]["level"] = 1
        overwritten = client.post(
            "/api/homebrew/import",
            json={"pack": pack, "conflict": "overwrite"},
            headers=admin_headers,
        ).json()
        assert overwritten["overwritten"] == 1

        listed = client.get("/api/homebrew?mine_only=true", headers=admin_headers).json()
        original = [e for e in listed["entries"] if e["entry_id"] == "hellfire-blast"][0]
        detail = client.get(f"/api/homebrew/{original['id']}", headers=admin_headers).json()
        assert detail["data"]["level"] == 1

    def test_rejects_a_pack_with_no_schema(self, client, admin_headers, schemas):
        resp = client.post(
            "/api/homebrew/import", json={"pack": {"entries": {}}}, headers=admin_headers
        )
        assert resp.status_code == 400

    def test_rejects_an_unknown_conflict_mode(self, client, admin_headers, schemas):
        resp = client.post(
            "/api/homebrew/import",
            json={"pack": {"schema_id": "hb-demo", "entries": {}}, "conflict": "explode"},
            headers=admin_headers,
        )
        assert resp.status_code == 400


class TestCatalogIntegration:
    def test_homebrew_appears_in_catalog_results(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        result = client.get("/api/content/hb-demo/spell", headers=admin_headers).json()
        rows = [entry for entry in result["entries"] if entry["entry_id"] == "hellfire-blast"]
        assert rows and rows[0]["homebrew"] is True
        assert rows[0]["source"] == "homebrew"

    def test_homebrew_can_be_excluded(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        result = client.get(
            "/api/content/hb-demo/spell?include_homebrew=false", headers=admin_headers
        ).json()
        assert result["total"] == 0

    def test_another_users_private_homebrew_is_not_in_the_catalog(
        self, client, admin_headers, gm_headers, schemas
    ):
        _create(client, admin_headers)
        result = client.get("/api/content/hb-demo/spell", headers=gm_headers).json()
        assert result["total"] == 0

    def test_homebrew_is_searchable(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        result = client.get(
            "/api/content/hb-demo/spell?search=hellfire", headers=admin_headers
        ).json()
        assert [entry["name"] for entry in result["entries"]] == ["Hellfire Blast"]

    def test_a_character_resolves_homebrew_references(self, client, admin_headers, schemas):
        _create(client, admin_headers)
        character = client.post(
            "/api/characters",
            json={
                "schema_ref": "hb-demo",
                "name": "Caster",
                "data": {"spells": [{"_ref": "hellfire-blast"}]},
            },
            headers=admin_headers,
        ).json()
        assert character["entries"]["hellfire-blast"]["name"] == "Hellfire Blast"
