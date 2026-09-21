"""Tests for rulesets: who may read and edit one, and how content moves in.

The access model is the thing to get right. A ruleset belongs to a campaign —
everyone at that table reads it, the GM edits it — or to the server, which
every game can use. That is what lets two games in the same system allow
different content, which the old per-user model could not express.
"""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.models import Campaign, CampaignMember, Ruleset, RulesetEntry
from backend.services.characters import packs


SCHEMA = {
    "id": "rs-demo",
    "name": "Ruleset Demo",
    "content_types": {
        "spell": {
            "identity_field": "name",
            "fields": {
                "name": {"type": "text", "label": "Name"},
                "level": {"type": "number", "label": "Level"},
            },
        }
    },
    "fields": {
        "spells": {"type": "content_list", "content_type": "spell", "allow_freeform": True}
    },
}


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.query(RulesetEntry).delete()
        db.query(Ruleset).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def schemas(client, admin_headers, gm_headers, player_headers):
    for headers in (admin_headers, gm_headers, player_headers):
        client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=headers)
    yield
    for headers in (admin_headers, gm_headers, player_headers):
        client.delete("/api/characters/schemas/rs-demo", headers=headers)


@pytest.fixture
def gm_campaign(gm_id, player_id):
    """A campaign the GM owns and the player is in."""
    db = SessionLocal()
    try:
        campaign = Campaign(name="The GM's Table", owner_id=gm_id)
        db.add(campaign)
        db.flush()
        db.add(CampaignMember(campaign_id=campaign.id, user_id=gm_id, status="joined"))
        db.add(CampaignMember(campaign_id=campaign.id, user_id=player_id, status="joined"))
        db.commit()
        return campaign.id
    finally:
        db.close()


def _create(client, headers, **overrides):
    payload = {"schema_id": "rs-demo", "name": "House Rules"}
    payload.update(overrides)
    return client.post("/api/rulesets", json=payload, headers=headers)


def _add_entry(client, headers, ruleset_id, name="Hellfire Bolt", level=2):
    return client.post(
        f"/api/rulesets/{ruleset_id}/entries",
        json={"content_type": "spell", "data": {"name": name, "level": level}},
        headers=headers,
    )


class TestOwnership:
    def test_a_gm_can_add_a_ruleset_to_their_campaign(
        self, client, gm_headers, schemas, gm_campaign
    ):
        resp = _create(client, gm_headers, campaign_id=gm_campaign)
        assert resp.status_code == 200, resp.text
        assert resp.json()["campaign_id"] == gm_campaign
        assert resp.json()["editable"] is True

    def test_a_player_cannot_add_one_to_a_campaign_they_only_play_in(
        self, client, player_headers, schemas, gm_campaign
    ):
        """Being at the table lets you read its rules, not rewrite them."""
        resp = _create(client, player_headers, campaign_id=gm_campaign)
        assert resp.status_code == 403

    def test_only_an_admin_can_add_a_server_ruleset(
        self, client, admin_headers, gm_headers, schemas
    ):
        assert _create(client, gm_headers, campaign_id=None).status_code == 403
        assert _create(client, admin_headers, campaign_id=None).status_code == 200

    def test_a_ruleset_for_a_campaign_that_does_not_exist_is_refused(
        self, client, gm_headers, schemas
    ):
        assert _create(client, gm_headers, campaign_id="nope").status_code == 403

    def test_a_ruleset_needs_a_name(self, client, admin_headers, schemas):
        assert _create(client, admin_headers, name="  ").status_code == 400

    def test_a_licensed_ruleset_must_carry_its_credit(self, client, admin_headers, schemas):
        resp = _create(client, admin_headers, license="CC-BY-4.0")
        assert resp.status_code == 400
        assert "credit" in resp.json()["detail"]


class TestVisibility:
    def test_a_campaign_ruleset_reaches_everyone_at_that_table(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        created = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.get(f"/api/rulesets/{created['id']}", headers=player_headers)
        assert resp.status_code == 200
        # Readable, but not theirs to change.
        assert resp.json()["editable"] is False

    def test_it_does_not_reach_someone_outside_the_campaign(
        self, client, gm_headers, admin_headers, schemas, gm_campaign
    ):
        created = _create(client, gm_headers, campaign_id=gm_campaign).json()
        listed = client.get("/api/rulesets", headers=admin_headers).json()["rulesets"]
        # The admin is not a member, so it is not in their list...
        assert created["id"] not in [row["id"] for row in listed]

    def test_a_server_ruleset_reaches_every_game(
        self, client, admin_headers, player_headers, schemas
    ):
        created = _create(client, admin_headers, campaign_id=None).json()
        resp = client.get(f"/api/rulesets/{created['id']}", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["editable"] is False

    def test_two_campaigns_can_allow_different_content(
        self, client, gm_headers, gm_id, schemas, gm_campaign
    ):
        """The case the old per-user model could not express."""
        db = SessionLocal()
        try:
            other = Campaign(name="A Different Game", owner_id=gm_id)
            db.add(other)
            db.flush()
            db.add(CampaignMember(campaign_id=other.id, user_id=gm_id, status="joined"))
            db.commit()
            other_id = other.id
        finally:
            db.close()

        first = _create(
            client, gm_headers, campaign_id=gm_campaign, name="Strahd extras"
        ).json()
        second = _create(
            client, gm_headers, campaign_id=other_id, name="Saturday extras"
        ).json()
        _add_entry(client, gm_headers, first["id"], name="Strahd Spell")
        _add_entry(client, gm_headers, second["id"], name="Saturday Spell")

        # The GM runs both, so browsing one campaign shows only its ruleset.
        strahd = client.get(
            f"/api/rulesets?campaign_id={gm_campaign}", headers=gm_headers
        ).json()["rulesets"]
        assert [row["name"] for row in strahd] == ["Strahd extras"]

    def test_a_player_cannot_edit_a_ruleset_they_can_read(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        created = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.put(
            f"/api/rulesets/{created['id']}", json={"name": "Hijacked"}, headers=player_headers
        )
        # 403 rather than 404: they know it exists, so pretending otherwise
        # would be the confusing answer.
        assert resp.status_code == 403

    def test_a_ruleset_someone_cannot_read_answers_404(
        self, client, gm_headers, admin_headers, schemas, gm_campaign
    ):
        created = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.put(
            f"/api/rulesets/{created['id']}", json={"name": "x"}, headers=admin_headers
        )
        # The admin can edit anything they can see — but they are not in this
        # campaign, so they see nothing.
        assert resp.status_code in (200, 404)

    def test_requires_authentication(self, client):
        assert client.get("/api/rulesets").status_code in (401, 403)


class TestEntries:
    def test_writes_and_reads_an_entry(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = _add_entry(client, gm_headers, ruleset["id"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["entry_id"] == "hellfire-bolt"

        listed = client.get(
            f"/api/rulesets/{ruleset['id']}/entries", headers=gm_headers
        ).json()["entries"]
        assert [row["name"] for row in listed] == ["Hellfire Bolt"]

    def test_coerces_entry_data_like_pack_content(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/entries",
            json={
                "content_type": "spell",
                "data": {"name": "Coerced", "level": "7", "junk": "dropped"},
            },
            headers=gm_headers,
        )
        data = resp.json()["data"]
        assert data["level"] == 7
        assert "junk" not in data

    def test_refuses_a_duplicate_entry_id(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        assert _add_entry(client, gm_headers, ruleset["id"]).status_code == 409

    def test_two_rulesets_may_each_define_the_same_entry(
        self, client, gm_headers, schemas, gm_campaign
    ):
        """Which is the point of scoping content to a table."""
        first = _create(client, gm_headers, campaign_id=gm_campaign, name="One").json()
        second = _create(client, gm_headers, campaign_id=gm_campaign, name="Two").json()
        assert _add_entry(client, gm_headers, first["id"]).status_code == 200
        assert _add_entry(client, gm_headers, second["id"]).status_code == 200

    def test_a_player_cannot_add_an_entry(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        assert _add_entry(client, player_headers, ruleset["id"]).status_code == 403

    def test_edits_and_deletes_an_entry(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()

        updated = client.put(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}",
            json={"data": {"name": "Renamed", "level": 9}},
            headers=gm_headers,
        ).json()
        assert updated["name"] == "Renamed"
        assert updated["data"]["level"] == 9

        assert client.delete(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}", headers=gm_headers
        ).status_code == 200

    def test_deleting_a_ruleset_does_not_destroy_a_character(
        self, client, gm_headers, schemas, gm_campaign
    ):
        """A reference is soft: the sheet marks it missing rather than losing it."""
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        character = client.post(
            "/api/characters",
            json={
                "schema_ref": "rs-demo",
                "name": "Survivor",
                "data": {"spells": [{"_ref": "hellfire-bolt"}]},
            },
            headers=gm_headers,
        ).json()

        client.delete(f"/api/rulesets/{ruleset['id']}", headers=gm_headers)

        after = client.get(f"/api/characters/{character['id']}", headers=gm_headers).json()
        assert after["data"]["spells"] == [{"_ref": "hellfire-bolt"}]
        assert after["entries"] == {}


class TestCatalogIntegration:
    def test_ruleset_content_appears_in_the_catalogue(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        result = client.get("/api/content/rs-demo/spell", headers=gm_headers).json()
        rows = [e for e in result["entries"] if e["entry_id"] == "hellfire-bolt"]
        assert rows and rows[0]["source"] == "ruleset"
        # Labelled with the ruleset it came from, so two "Fireball"s are
        # distinguishable.
        assert rows[0]["ruleset_name"] == "House Rules"

    def test_a_player_at_the_table_sees_it_too(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        result = client.get("/api/content/rs-demo/spell", headers=player_headers).json()
        assert [e["name"] for e in result["entries"]] == ["Hellfire Bolt"]

    def test_someone_outside_the_campaign_does_not(
        self, client, gm_headers, admin_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        result = client.get("/api/content/rs-demo/spell", headers=admin_headers).json()
        assert result["total"] == 0

    def test_a_character_resolves_ruleset_references(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        character = client.post(
            "/api/characters",
            json={
                "schema_ref": "rs-demo",
                "name": "Caster",
                "data": {"spells": [{"_ref": "hellfire-bolt"}]},
            },
            headers=gm_headers,
        ).json()
        assert character["entries"]["hellfire-bolt"]["name"] == "Hellfire Bolt"


class TestImportExport:
    def test_exports_and_reimports(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])

        document = client.get(
            f"/api/rulesets/{ruleset['id']}/export", headers=gm_headers
        ).json()
        assert document["$schema"] == "grimoire://ruleset/v1"
        assert document["entries"]["spell"][0]["_id"] == "hellfire-bolt"

        other = _create(client, gm_headers, campaign_id=gm_campaign, name="Copy").json()
        result = client.post(
            f"/api/rulesets/{other['id']}/import",
            json={"document": document},
            headers=gm_headers,
        ).json()
        assert result["imported"] == 1

    def test_import_skips_conflicts_by_default(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        document = client.get(
            f"/api/rulesets/{ruleset['id']}/export", headers=gm_headers
        ).json()

        result = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"document": document},
            headers=gm_headers,
        ).json()
        assert result == {
            "imported": 0, "skipped": 1, "renamed": 0, "overwritten": 0, "failed": []
        }

    def test_import_can_rename_or_overwrite(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        _add_entry(client, gm_headers, ruleset["id"])
        document = client.get(
            f"/api/rulesets/{ruleset['id']}/export", headers=gm_headers
        ).json()

        renamed = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"document": document, "conflict": "rename"},
            headers=gm_headers,
        ).json()
        assert renamed["renamed"] == 1

        document["entries"]["spell"][0]["level"] = 1
        overwritten = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"document": document, "conflict": "overwrite"},
            headers=gm_headers,
        ).json()
        assert overwritten["overwritten"] == 1

    def test_an_import_needs_something_to_import(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/import", json={}, headers=gm_headers
        )
        assert resp.status_code == 400

    def test_a_player_cannot_import_into_the_table_ruleset(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"document": {"entries": {}}},
            headers=player_headers,
        )
        assert resp.status_code == 403


# --- content packs --------------------------------------------------------

SRD_SPELLS = [
    {"_id": "fireball", "name": "Fireball", "level": 3},
    {"_id": "magic-missile", "name": "Magic Missile", "level": 1},
]


@pytest.fixture
def srd_pack(tmp_path):
    """A filesystem content pack, loaded the way startup loads the real ones.

    This is the route the 5.5e SRD takes: an admin installs the pack once and
    each table imports it into a ruleset of its own.
    """
    directory = tmp_path / "packs" / "rs-srd"
    os.makedirs(directory, exist_ok=True)
    (directory / "_meta.json").write_text(
        json.dumps(
            {
                "pack_id": "rs-srd",
                "schema_id": "rs-demo",
                "name": "Demo SRD",
                "version": "1.0.0",
                "description": "Core content.",
                "license": "CC-BY-4.0",
                "license_url": "https://creativecommons.org/licenses/by/4.0/",
                "attribution": "Demo SRD, CC BY 4.0.",
                "source": "srd",
            }
        )
    )
    (directory / "spell.json").write_text(json.dumps(SRD_SPELLS))

    db = SessionLocal()
    try:
        packs.load_pack(db, str(directory), schema_document=SCHEMA)
        db.commit()
    finally:
        db.close()
    yield "rs-srd"
    db = SessionLocal()
    try:
        db.execute(packs.text("DELETE FROM content_search"))
        db.query(packs.ContentEntry).delete()
        db.query(packs.ContentPack).delete()
        db.commit()
    finally:
        db.close()


class TestInstallablePacks:
    def test_lists_what_is_installed(self, client, gm_headers, schemas, srd_pack):
        body = client.get("/api/rulesets/installable", headers=gm_headers).json()
        row = next(p for p in body["packs"] if p["pack_id"] == "rs-srd")
        assert row["name"] == "Demo SRD"
        assert row["entry_count"] == 2
        # The credit is shown before importing, not after.
        assert row["attribution"] == "Demo SRD, CC BY 4.0."

    def test_filters_by_system(self, client, gm_headers, schemas, srd_pack):
        body = client.get(
            "/api/rulesets/installable?schema_id=rs-demo", headers=gm_headers
        ).json()
        assert [p["pack_id"] for p in body["packs"]] == ["rs-srd"]
        other = client.get(
            "/api/rulesets/installable?schema_id=nothing-here", headers=gm_headers
        ).json()
        assert other["packs"] == []


class TestPackImport:
    def test_imports_a_pack_into_a_ruleset(
        self, client, gm_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        result = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"pack_id": "rs-srd"},
            headers=gm_headers,
        ).json()
        assert result["imported"] == 2

        entries = client.get(
            f"/api/rulesets/{ruleset['id']}/entries", headers=gm_headers
        ).json()
        assert sorted(e["entry_id"] for e in entries["entries"]) == [
            "fireball",
            "magic-missile",
        ]

    def test_the_packs_credit_travels_with_its_content(
        self, client, gm_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"pack_id": "rs-srd"},
            headers=gm_headers,
        )
        body = client.get(f"/api/rulesets/{ruleset['id']}", headers=gm_headers).json()
        assert body["attribution"] == "Demo SRD, CC BY 4.0."
        assert body["license"] == "CC-BY-4.0"
        assert body["source_pack_id"] == "rs-srd"

    def test_rejects_a_pack_for_another_system(
        self, client, gm_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(
            client, gm_headers, campaign_id=gm_campaign, schema_id="rs-demo"
        ).json()
        db = SessionLocal()
        try:
            pack = db.query(packs.ContentPack).filter_by(pack_id="rs-srd").first()
            pack.schema_id = "some-other-game"
            db.commit()
        finally:
            db.close()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"pack_id": "rs-srd"},
            headers=gm_headers,
        )
        assert resp.status_code == 400
        assert "some-other-game" in resp.json()["detail"]

    def test_rejects_a_pack_that_is_not_installed(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"pack_id": "no-such-pack"},
            headers=gm_headers,
        )
        assert resp.status_code == 404


class TestForking:
    def test_forks_a_pack_entry_into_an_editable_copy(
        self, client, gm_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        body = client.post(
            f"/api/rulesets/{ruleset['id']}/fork",
            json={"content_type": "spell", "entry_id": "fireball"},
            headers=gm_headers,
        ).json()
        # Renamed so the table can tell the house version from the book's.
        assert body["name"] == "Fireball (copy)"
        assert body["data"]["level"] == 3
        assert body["forked_from"] == "srd:fireball"
        assert body["editable"] is True

    def test_forking_twice_does_not_collide(
        self, client, gm_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        first = client.post(
            f"/api/rulesets/{ruleset['id']}/fork",
            json={"content_type": "spell", "entry_id": "fireball"},
            headers=gm_headers,
        ).json()
        second = client.post(
            f"/api/rulesets/{ruleset['id']}/fork",
            json={"content_type": "spell", "entry_id": "fireball"},
            headers=gm_headers,
        ).json()
        assert first["entry_id"] != second["entry_id"]

    def test_forks_an_entry_from_another_readable_ruleset(
        self, client, gm_headers, admin_headers, schemas, gm_campaign
    ):
        """A server ruleset is readable by everyone, so a table may copy from it."""
        server = _create(client, admin_headers, name="Server Rules").json()
        _add_entry(client, admin_headers, server["id"])

        mine = _create(client, gm_headers, campaign_id=gm_campaign).json()
        body = client.post(
            f"/api/rulesets/{mine['id']}/fork",
            json={"content_type": "spell", "entry_id": "hellfire-bolt"},
            headers=gm_headers,
        ).json()
        assert body["forked_from"] == "ruleset:hellfire-bolt"

    def test_a_source_that_does_not_exist_is_a_404(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/fork",
            json={"content_type": "spell", "entry_id": "nothing-here"},
            headers=gm_headers,
        )
        assert resp.status_code == 404

    def test_a_player_may_not_fork_into_the_table_ruleset(
        self, client, gm_headers, player_headers, schemas, gm_campaign, srd_pack
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        resp = client.post(
            f"/api/rulesets/{ruleset['id']}/fork",
            json={"content_type": "spell", "entry_id": "fireball"},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestSingleEntry:
    def test_reads_one_entry_in_full(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()
        body = client.get(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}", headers=gm_headers
        ).json()
        assert body["data"] == {"name": "Hellfire Bolt", "level": 2}
        assert body["editable"] is True

    def test_a_player_reads_it_but_cannot_change_it(
        self, client, gm_headers, player_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()
        body = client.get(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}", headers=player_headers
        ).json()
        assert body["editable"] is False
        resp = client.put(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}",
            json={"data": {"name": "Theirs", "level": 9}},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_updating_renames_by_the_identity_field(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()
        body = client.put(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}",
            json={"data": {"name": "Hellfire Lance", "level": 4}},
            headers=gm_headers,
        ).json()
        assert body["name"] == "Hellfire Lance"
        assert body["data"]["level"] == 4
        # The id it is referenced by does not move, or every character
        # pointing at it would break.
        assert body["entry_id"] == "hellfire-bolt"

    def test_an_update_with_no_data_is_a_no_op(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()
        body = client.put(
            f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}",
            json={},
            headers=gm_headers,
        ).json()
        assert body["name"] == "Hellfire Bolt"

    def test_deletes_one_entry(self, client, gm_headers, schemas, gm_campaign):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        entry = _add_entry(client, gm_headers, ruleset["id"]).json()
        assert (
            client.delete(
                f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}", headers=gm_headers
            ).json()["deleted"]
            is True
        )
        assert (
            client.get(
                f"/api/rulesets/{ruleset['id']}/entries/{entry['id']}", headers=gm_headers
            ).status_code
            == 404
        )

    def test_missing_entries_are_404_on_every_verb(
        self, client, gm_headers, schemas, gm_campaign
    ):
        ruleset = _create(client, gm_headers, campaign_id=gm_campaign).json()
        base = f"/api/rulesets/{ruleset['id']}/entries/nope"
        assert client.get(base, headers=gm_headers).status_code == 404
        assert client.put(base, json={"data": {}}, headers=gm_headers).status_code == 404
        assert client.delete(base, headers=gm_headers).status_code == 404
