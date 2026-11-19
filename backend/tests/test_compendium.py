"""Tests for a system's compendium (issue #835) and pack-declared content types.

A compendium is the rules content linked to a library system: the content
packs an editor links to it, plus the rulesets written for the sheets those
packs and the system's linked sheets serve. These cover the links, how a type
gets its definition (sheet, pack declaration, inferred), browsing and search,
and that everything follows who may see the system and its rulesets.
"""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.models import (
    CharacterSchema,
    GameSystem,
    Ruleset,
    RulesetEntry,
    SystemCharacterSheet,
    SystemContentPack,
)
from backend.services.characters import packs
from backend.services.characters.schema import SchemaError, validate_content_types
from backend.services.characters.user_schemas import catalog_document

from .conftest import make_game_system

SHEET_ID = "compendium-demo"

SHEET = {
    "id": SHEET_ID,
    "name": "Compendium Demo",
    "system": "Demo RPG",
    "content_types": {
        "spell": {
            "label": "Spell",
            "label_plural": "Spells",
            "identity_field": "name",
            "sort_default": ["level", "name"],
            "search_fields": ["name", "description"],
            "filter_fields": ["level", "school"],
            "compact_display": "{school} {level}",
            "fields": {
                "name": {"type": "text"},
                "level": {"type": "number"},
                "school": {"type": "text"},
                "description": {"type": "textarea"},
            },
        }
    },
    "fields": {"spells": {"type": "content_list", "content_type": "spell"}},
}

#: Reference material no sheet declares: the pack describes it itself.
DECLARED = {
    "condition": {
        "label": "Condition",
        "label_plural": "Conditions",
        "identity_field": "name",
        "search_fields": ["name", "description"],
        "fields": {"name": {"type": "text"}, "description": {"type": "textarea"}},
    },
    # A clash with the sheet: the sheet's definition must win.
    "spell": {
        "label": "Pack Spell",
        "identity_field": "name",
        "fields": {"name": {"type": "text"}, "secret": {"type": "text"}},
    },
}

SPELLS = [
    {"_id": "fireball", "name": "Fireball", "level": 3, "school": "Evocation",
     "description": "A bright streak flashes to a point you choose.", "secret": "dropped"},
    {"_id": "shield", "name": "Shield", "level": 1, "school": "Abjuration",
     "description": "An invisible barrier of magical force appears."},
    {"_id": "wish", "name": "Wish", "level": 9, "school": "Conjuration",
     "description": "The mightiest spell a mortal can cast."},
]
CONDITIONS = [
    {"_id": "prone", "name": "Prone", "description": "You are lying on the ground."},
    {"_id": "blinded", "name": "Blinded", "description": "You cannot see."},
]


def _write_pack(root, pack_id, *, schema_id=SHEET_ID, content=None, meta=None):
    directory = os.path.join(root, pack_id)
    os.makedirs(directory, exist_ok=True)
    payload = {
        "pack_id": pack_id,
        "schema_id": schema_id,
        "name": f"Pack {pack_id}",
        "license": "CC-BY-4.0",
        "attribution": f"{pack_id} credit, CC BY 4.0.",
        "source": "srd",
        "content_types": DECLARED,
    }
    payload.update(meta or {})
    payload = {key: value for key, value in payload.items() if value is not None}
    with open(os.path.join(directory, "_meta.json"), "w") as handle:
        json.dump(payload, handle)
    for content_type, rows in (content or {"spell": SPELLS, "condition": CONDITIONS}).items():
        with open(os.path.join(directory, f"{content_type}.json"), "w") as handle:
            json.dump(rows, handle)
    return directory


@pytest.fixture
def pack_root(tmp_path, monkeypatch):
    root = str(tmp_path / "character-content")
    monkeypatch.setattr(packs, "CONTENT_DIR", root)
    return root


@pytest.fixture(autouse=True)
def _clean():
    yield
    db = SessionLocal()
    try:
        db.execute(packs.text("DELETE FROM content_search"))
        db.query(packs.ContentEntry).delete()
        db.query(packs.ContentPack).delete()
        db.query(SystemContentPack).delete()
        db.query(SystemCharacterSheet).delete()
        db.query(RulesetEntry).delete()
        db.query(Ruleset).delete()
        db.query(CharacterSchema).filter(
            CharacterSchema.schema_id.in_([SHEET_ID, "other-sheet"])
        ).delete(synchronize_session=False)
        db.commit()
    finally:
        db.close()


def _sync(pack_root, *pack_ids, **kwargs):
    for pack_id in pack_ids:
        _write_pack(pack_root, pack_id, **kwargs)
    db = SessionLocal()
    try:
        packs.sync_packs(db)
    finally:
        db.close()


def _install_sheet(client, headers, document=SHEET, **params):
    response = client.post(
        "/api/characters/schemas", json={"document": document}, headers=headers, params=params
    )
    assert response.status_code == 200, response.text
    return response.json()


def _link(client, headers, system_id, **body):
    return client.put(f"/api/systems/{system_id}/compendium/links", json=body, headers=headers)


@pytest.fixture
def system():
    row = make_game_system()
    yield row
    db = SessionLocal()
    try:
        db.query(GameSystem).filter_by(id=row.id).delete()
        db.commit()
    finally:
        db.close()


@pytest.fixture
def srd(client, admin_headers, pack_root, system):
    """The demo SRD installed and linked to the system, the sheet server-wide."""
    _install_sheet(client, admin_headers, server_wide="true")
    _sync(pack_root, "demo-srd")
    response = _link(client, admin_headers, system.id, pack_ids=["demo-srd"], sheet_ids=[SHEET_ID])
    assert response.status_code == 200, response.text
    return system


# --- pack-declared content types ---------------------------------------------


class TestPackDeclaredTypes:
    def test_declared_types_are_validated_like_a_sheets(self):
        assert validate_content_types(DECLARED) is DECLARED
        with pytest.raises(SchemaError, match="identity_field"):
            validate_content_types({"rule": {"identity_field": "title", "fields": {"name": {"type": "text"}}}})
        with pytest.raises(SchemaError, match="must be an object"):
            validate_content_types(["condition"])

    def test_a_bad_declaration_refuses_the_pack(self, pack_root):
        directory = _write_pack(
            pack_root, "bad-decl", meta={"content_types": {"rule": {"fields": {}}}}
        )
        db = SessionLocal()
        try:
            with pytest.raises(packs.PackError, match="needs at least one field"):
                packs.load_pack(db, directory)
        finally:
            db.rollback()
            db.close()

    def test_declared_types_coerce_entries_and_the_sheet_wins_a_clash(self, pack_root):
        directory = _write_pack(pack_root, "declared")
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, directory, schema_document=SHEET)
            db.commit()
            assert set(pack.content_types) == {"condition", "spell"}
            rows = {
                row.entry_id: row
                for row in db.query(packs.ContentEntry).filter_by(pack_id=pack.id).all()
            }
            # The sheet's spell has no `secret`, so the pack's clashing
            # declaration did not get to keep it.
            assert "secret" not in rows["fireball"].data
            assert rows["fireball"].data["level"] == 3
            assert rows["prone"].data == {
                "name": "Prone", "description": "You are lying on the ground."
            }
        finally:
            db.close()

    def test_without_the_sheet_the_pack_declaration_coerces(self, pack_root):
        directory = _write_pack(pack_root, "alone")
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, directory)
            db.commit()
            fireball = (
                db.query(packs.ContentEntry)
                .filter_by(pack_id=pack.id, entry_id="fireball")
                .one()
            )
            assert fireball.data == {"name": "Fireball", "secret": "dropped"}
        finally:
            db.close()

    def test_catalog_document_adds_pack_types_under_the_sheet(
        self, client, player_headers, player_id, pack_root
    ):
        _sync(pack_root, "demo-srd")
        db = SessionLocal()
        try:
            # No sheet: the packs' own types still describe a catalog.
            alone = catalog_document(db, player_id, SHEET_ID)
            assert set(alone["content_types"]) == {"condition", "spell"}
            assert alone["content_types"]["spell"]["label"] == "Pack Spell"
        finally:
            db.close()
        _install_sheet(client, player_headers)
        db = SessionLocal()
        try:
            merged = catalog_document(db, player_id, SHEET_ID)
            assert merged["content_types"]["spell"]["label"] == "Spell"
            assert "condition" in merged["content_types"]
            assert merged["fields"]  # the rest of the sheet is untouched
        finally:
            db.close()

    def test_a_ruleset_can_hold_a_pack_declared_type(
        self, client, admin_headers, pack_root
    ):
        _sync(pack_root, "demo-srd")
        ruleset = client.post(
            "/api/rulesets", json={"name": "Table rules", "schema_id": SHEET_ID},
            headers=admin_headers,
        ).json()
        response = client.post(
            f"/api/rulesets/{ruleset['id']}/entries",
            json={"content_type": "condition", "data": {"name": "Dazed", "description": "Reeling."}},
            headers=admin_headers,
        )
        assert response.status_code == 200, response.text
        types = client.get(f"/api/content/{SHEET_ID}/types", headers=admin_headers).json()
        assert "condition" in {row["name"] for row in types["content_types"]}


# --- links -------------------------------------------------------------------


class TestLinks:
    def test_an_editor_links_packs_and_sheets(self, client, gm_headers, pack_root, system):
        _install_sheet(client, gm_headers)
        _sync(pack_root, "demo-srd", "extra")
        response = _link(
            client, gm_headers, system.id, pack_ids=["extra", "demo-srd"], sheet_ids=[SHEET_ID]
        )
        assert response.status_code == 200, response.text
        body = response.json()
        assert [pack["pack_id"] for pack in body["packs"]] == ["extra", "demo-srd"]
        assert body["packs"][1]["attribution"] == "demo-srd credit, CC BY 4.0."
        assert body["sheets"] == [
            {"schema_id": SHEET_ID, "name": "Compendium Demo", "system": "Demo RPG",
             "available": True, "server_wide": False}
        ]
        assert body["can_edit"] is True
        client.delete(f"/api/characters/schemas/{SHEET_ID}", headers=gm_headers)

    def test_leaving_a_list_out_leaves_it_alone(self, client, admin_headers, srd):
        response = _link(client, admin_headers, srd.id, sheet_ids=[])
        body = response.json()
        assert [pack["pack_id"] for pack in body["packs"]] == ["demo-srd"]
        assert body["sheets"] == []

    def test_a_player_cannot_change_links(self, client, player_headers, srd):
        assert _link(client, player_headers, srd.id, pack_ids=[]).status_code == 403

    def test_a_new_link_must_name_something_installed(self, client, admin_headers, srd):
        response = _link(client, admin_headers, srd.id, pack_ids=["demo-srd", "nope"])
        assert response.status_code == 400
        assert "nope" in response.json()["detail"]
        response = _link(client, admin_headers, srd.id, sheet_ids=["not-a-sheet"])
        assert response.status_code == 400

    def test_a_link_outlives_its_pack(self, client, admin_headers, pack_root, srd):
        db = SessionLocal()
        try:
            packs.uninstall_pack(db, "demo-srd")
        finally:
            db.close()
        body = client.get(f"/api/systems/{srd.id}/compendium", headers=admin_headers).json()
        assert body["packs"] == [
            {"pack_id": "demo-srd", "name": "demo-srd", "schema_id": "", "version": "",
             "description": "", "license": "", "license_url": "", "attribution": "",
             "source_url": "", "entry_count": 0, "installed": False}
        ]
        # Re-saving keeps the stale link rather than refusing it.
        assert _link(client, admin_headers, srd.id, pack_ids=["demo-srd"]).status_code == 200
        _sync(pack_root, "demo-srd")
        body = client.get(f"/api/systems/{srd.id}/compendium", headers=admin_headers).json()
        assert body["packs"][0]["installed"] is True

    def test_too_many_links_are_refused(self, client, admin_headers, srd):
        response = _link(client, admin_headers, srd.id, pack_ids=[f"p{i}" for i in range(60)])
        assert response.status_code == 400

    def test_links_go_with_their_system(self, client, admin_headers, srd):
        db = SessionLocal()
        try:
            db.query(GameSystem).filter_by(id=srd.id).delete()
            db.commit()
            assert db.query(SystemContentPack).filter_by(game_system_id=srd.id).count() == 0
            assert db.query(SystemCharacterSheet).filter_by(game_system_id=srd.id).count() == 0
        finally:
            db.close()


# --- reading it ----------------------------------------------------------------


class TestCompendium:
    def test_lists_each_type_with_its_count(self, client, player_headers, srd):
        body = client.get(f"/api/systems/{srd.id}/compendium", headers=player_headers).json()
        types = {row["name"]: row for row in body["content_types"]}
        assert types["spell"]["entry_count"] == 3
        assert types["spell"]["label_plural"] == "Spells"  # the sheet's, not the pack's
        assert types["condition"]["entry_count"] == 2
        assert body["can_edit"] is False
        # The server-wide sheet is one every player can start a character on.
        assert body["sheets"][0]["available"] is True
        assert body["sheets"][0]["server_wide"] is True

    def test_browse_sorts_filters_and_pages(self, client, player_headers, srd):
        url = f"/api/systems/{srd.id}/compendium/spell"
        body = client.get(url, headers=player_headers).json()
        assert [row["name"] for row in body["entries"]] == ["Shield", "Fireball", "Wish"]
        assert body["entries"][0]["display"] == "Abjuration 1"
        assert body["entries"][0]["origin"] == "demo-srd"
        assert {o["value"] for o in body["filters_available"]["school"]} == {
            "Abjuration", "Conjuration", "Evocation"
        }
        filtered = client.get(url, params={"filter[school]": "evocation"}, headers=player_headers)
        assert [row["name"] for row in filtered.json()["entries"]] == ["Fireball"]
        paged = client.get(url, params={"page": 2, "page_size": 2}, headers=player_headers).json()
        assert [row["name"] for row in paged["entries"]] == ["Wish"]
        assert paged["total"] == 3

    def test_browse_searches(self, client, player_headers, srd):
        body = client.get(
            f"/api/systems/{srd.id}/compendium/spell",
            params={"search": "barri"},
            headers=player_headers,
        ).json()
        assert [row["name"] for row in body["entries"]] == ["Shield"]

    def test_an_entry_comes_with_its_definition(self, client, player_headers, srd):
        response = client.get(
            f"/api/systems/{srd.id}/compendium/condition/prone", headers=player_headers
        )
        assert response.status_code == 200
        body = response.json()
        assert body["name"] == "Prone"
        assert body["type_definition"]["label"] == "Condition"
        assert set(body["type_definition"]["fields"]) == {"name", "description"}
        missing = client.get(
            f"/api/systems/{srd.id}/compendium/condition/nope", headers=player_headers
        )
        assert missing.status_code == 404

    def test_a_type_nobody_declares_is_inferred(self, client, player_headers, pack_root, system,
                                                admin_headers):
        _sync(
            pack_root,
            "bare",
            schema_id="other-sheet",
            meta={"content_types": None},
            content={"rule": [
                {"_id": "cover", "name": "Cover", "bonus": 2,
                 "description": "Walls, trees and creatures can provide cover.\nHalf or more."},
            ]},
        )
        _link(client, admin_headers, system.id, pack_ids=["bare"])
        body = client.get(f"/api/systems/{system.id}/compendium", headers=player_headers).json()
        rule = next(row for row in body["content_types"] if row["name"] == "rule")
        assert rule["label"] == "Rule"
        assert rule["fields"]["bonus"]["type"] == "number"
        assert rule["fields"]["description"]["type"] == "textarea"
        entry = client.get(
            f"/api/systems/{system.id}/compendium/rule/cover", headers=player_headers
        ).json()
        assert entry["data"]["bonus"] == 2

    def test_rulesets_join_in_and_unchanged_copies_do_not(
        self, client, admin_headers, gm_headers, player_headers, gm_id, srd
    ):
        db = SessionLocal()
        try:
            server = Ruleset(name="SRD copy", schema_id=SHEET_ID, source_pack_id="demo-srd")
            house = Ruleset(name="GM's notes", schema_id=SHEET_ID, owner_id=gm_id)
            db.add_all([server, house])
            db.flush()
            shield = next(row for row in SPELLS if row["_id"] == "shield")
            db.add_all([
                # The SRD's shield, imported as is: shown once, as the pack's.
                RulesetEntry(ruleset_id=server.id, schema_id=SHEET_ID, content_type="spell",
                             entry_id="shield", name="Shield",
                             data={k: v for k, v in shield.items() if k != "_id"}),
                # A house version of fireball: shown beside the SRD's.
                RulesetEntry(ruleset_id=server.id, schema_id=SHEET_ID, content_type="spell",
                             entry_id="fireball", name="Fireball",
                             data={"name": "Fireball", "level": 4, "school": "Evocation"}),
                # Personal to the GM: nobody else sees it.
                RulesetEntry(ruleset_id=house.id, schema_id=SHEET_ID, content_type="condition",
                             entry_id="marked", name="Marked",
                             data={"name": "Marked", "description": "Hunted."}),
            ])
            db.commit()
            server_id = server.id
        finally:
            db.close()

        url = f"/api/systems/{srd.id}/compendium/spell"
        entries = client.get(url, headers=player_headers).json()["entries"]
        assert [(row["name"], row["ruleset"]) for row in entries] == [
            # Sorted by level: the house Fireball is a 4th-level spell.
            ("Shield", False), ("Fireball", False), ("Fireball", True), ("Wish", False)
        ]
        house_fireball = client.get(
            f"{url}/fireball", params={"origin": f"ruleset:{server_id}"}, headers=player_headers
        ).json()
        assert house_fireball["data"]["level"] == 4
        assert house_fireball["ruleset_name"] == "SRD copy"
        # Without an origin the pack's entry wins.
        assert client.get(f"{url}/fireball", headers=player_headers).json()["data"]["level"] == 3

        def conditions(headers):
            body = client.get(f"/api/systems/{srd.id}/compendium", headers=headers).json()
            return next(r for r in body["content_types"] if r["name"] == "condition")["entry_count"]

        assert conditions(gm_headers) == 3
        assert conditions(player_headers) == 2

    def test_search_covers_every_type(self, client, player_headers, srd):
        body = client.get(
            f"/api/systems/{srd.id}/compendium/search", params={"q": "ground"},
            headers=player_headers,
        ).json()
        assert [(row["name"], row["type_label"]) for row in body["results"]] == [
            ("Prone", "Condition")
        ]
        assert body["results"][0]["systems"] == [{"id": srd.id, "name": srd.name}]


class TestAccess:
    def test_a_hidden_system_hides_its_compendium(self, client, player_headers, admin_headers, srd):
        db = SessionLocal()
        try:
            db.query(GameSystem).filter_by(id=srd.id).update({"access_level": "gm"})
            db.commit()
        finally:
            db.close()
        for path in ("", "/spell", "/spell/fireball", "/search?q=fire"):
            url = f"/api/systems/{srd.id}/compendium{path}"
            assert client.get(url, headers=player_headers).status_code == 404, path
        assert client.get(f"/api/systems/{srd.id}/compendium", headers=admin_headers).status_code == 200
        results = client.get("/api/compendium/search", params={"q": "fire"},
                             headers=player_headers).json()["results"]
        assert results == []

    def test_a_missing_system_is_404(self, client, player_headers):
        assert client.get("/api/systems/nope/compendium", headers=player_headers).status_code == 404


class TestGlobalSearch:
    def test_finds_entries_across_systems_once(self, client, admin_headers, player_headers, srd):
        second = make_game_system()
        try:
            _link(client, admin_headers, second.id, pack_ids=["demo-srd"])
            body = client.get(
                "/api/compendium/search", params={"q": "fire"}, headers=player_headers
            ).json()
            assert [row["name"] for row in body["results"]] == ["Fireball"]
            assert {s["id"] for s in body["results"][0]["systems"]} == {srd.id, second.id}

            only = client.get(
                "/api/compendium/search", params={"q": "fire", "system_id": second.id},
                headers=player_headers,
            ).json()
            assert [s["id"] for s in only["results"][0]["systems"]] == [second.id]
        finally:
            db = SessionLocal()
            db.query(GameSystem).filter_by(id=second.id).delete()
            db.commit()
            db.close()

    def test_a_short_query_finds_nothing(self, client, player_headers, srd):
        body = client.get("/api/compendium/search", params={"q": "f"}, headers=player_headers)
        assert body.json() == {"results": []}

    def test_no_linked_systems_finds_nothing(self, client, player_headers):
        body = client.get("/api/compendium/search", params={"q": "fire"}, headers=player_headers)
        assert body.json() == {"results": []}
