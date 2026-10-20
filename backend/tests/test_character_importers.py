"""Character importers: the manifest, the engine, the sheet mapping, and the API.

Self-contained: a small sheet, a small pack and an importer written here, so
nothing depends on the community repository. The shipped Forge Steel and
Pathbuilder importers are exercised in ``test_bundled_importers.py``.
"""
import base64
import io
import json
import os

import pytest
import yaml
from PIL import Image
from pydantic import ValidationError

from backend.addons import importer as engine
from backend.addons import registry, scripts
from backend.addons import install as addon_install
from backend.addons import user_importers
from backend.addons.constants import SETTING_INDEX_CACHE, SETTING_INSTALLED
from backend.addons.manifest import AddonManifest
from backend.config import CHARACTER_PORTRAIT_DIR, SessionLocal
from backend.models import (
    AppSetting,
    Character,
    ContentEntry,
    ContentPack,
    Ruleset,
    RulesetEntry,
    UserImporter,
)
from backend.services.characters import catalogue, importing
from backend.services.characters.schema import validate_schema

SHEET = {
    "id": "import-rpg",
    "name": "Import RPG",
    "version": "1.0.0",
    "name_field": "hero",
    "content_types": {
        "spell": {
            "fields": {
                "name": {"type": "text"},
                "school": {"type": "text"},
                "description": {"type": "textarea"},
            }
        }
    },
    "fields": {
        "hero": {"type": "text"},
        "level": {"type": "number", "default": 1},
        "strength": {"type": "number", "default": 0},
        "brave": {"type": "checkbox"},
        "rank": {"type": "select", "options": ["Novice", "Veteran"]},
        "skills": {"type": "multiselect", "options": ["Climb", "Hide", "Swim"]},
        "languages": {"type": "text"},
        "notes": {"type": "textarea"},
        "patron": {"type": "content_ref", "content_type": "spell", "allow_freeform": True},
        "spells": {
            "type": "content_list",
            "content_type": "spell",
            "allow_freeform": True,
            "per_entry_fields": {"prepared": {"type": "checkbox", "label": "Prepared"}},
        },
        "gear": {
            "type": "list",
            "columns": [
                {"key": "name", "type": "text"},
                {"key": "qty", "type": "number", "default": 1},
            ],
        },
    },
}

HERO = {
    "who": {"name": "Ash", "brave": True},
    "level": 3,
    "scores": {"str": 16},
    "rank": "vet",
    "skills": [{"name": "Climb"}, {"name": "Fly"}, {"name": "Hide"}],
    "languages": ["Common", "Elvish"],
    "notes": ["Line one", "Line two"],
    "patron": {"title": "Fireball", "text": "Boom."},
    "spells": [
        {"name": "Shield", "school": "abjuration"},
        {"name": "Shield", "school": "abjuration"},
        {"name": "Fireball", "school": "evocation"},
        {"name": "Light", "school": "evocation"},
        {"name": "Homebrew Bolt", "school": "evocation", "text": "Mine."},
    ],
    "pack": [["Rope", 2], ["Torch", 5]],
    "kind": "import-rpg-hero",
}

MANIFEST = {
    "id": "import-demo",
    "name": "Import Demo",
    "version": "1.0.0",
    "kind": "character-importer",
    "author": "hunter-read",
    "importer": {
        "sheet": "import-rpg",
        "extensions": [".hero"],
        "detect": ["$.kind"],
        "name": "$.who.name",
        "fields": {
            "hero": "$.who.name",
            "level": "$.level",
            "strength": {"from": "$.scores.str", "transform": "modifier"},
            "brave": "$.who.brave",
            "rank": {"from": "$.rank", "values": {"vet": "Veteran"}},
            "skills": "$.skills[*].name",
            "languages": {"from": "$.languages", "join": " / "},
            "notes": "$.notes",
            "patron": {"from": "$.patron", "name": "@.title", "description": "@.text"},
            "spells": {
                "from": "$.spells[*]",
                "description": "@.text",
                "match": {"school": "@.school"},
            },
            "gear": {"from": "$.pack[*]", "columns": {"name": "@[0]", "qty": "@[1]"}},
            "not_a_field": "$.level",
        },
    },
}


def _png_data_url() -> str:
    buffer = io.BytesIO()
    Image.new("RGB", (2, 2), "red").save(buffer, format="PNG")
    return "data:image/png;base64," + base64.b64encode(buffer.getvalue()).decode()


def _manifest(**changes) -> AddonManifest:
    data = json.loads(json.dumps(MANIFEST))
    importer = data["importer"]
    for key, value in changes.items():
        if value is None:
            importer.pop(key, None)
        else:
            importer[key] = value
    return AddonManifest(**data)


def _install(directory, manifest: dict) -> None:
    target = directory / manifest["id"]
    target.mkdir()
    (target / f"{manifest['id']}.yml").write_text(yaml.safe_dump(manifest))


@pytest.fixture
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    return directory


@pytest.fixture
def sheet(client, admin_headers):
    resp = client.post("/api/characters/schemas", json={"document": SHEET}, headers=admin_headers)
    assert resp.status_code == 200, resp.text
    yield
    client.delete("/api/characters/schemas/import-rpg", headers=admin_headers)


@pytest.fixture
def content(admin_id):
    """A pack holding Shield (twice over, by school) and Fireball, and the
    admin's own ruleset holding Light."""
    db = SessionLocal()
    pack = ContentPack(pack_id="import-pack", schema_id="import-rpg", name="Import pack")
    db.add(pack)
    db.flush()
    for entry_id, name, school in (
        ("shield-wrong", "Shield", "illusion"),
        ("shield", "Shield", "abjuration"),
        ("fireball", "Fireball", "evocation"),
    ):
        db.add(
            ContentEntry(
                pack_id=pack.id,
                schema_id="import-rpg",
                content_type="spell",
                entry_id=entry_id,
                source="srd",
                name=name,
                data={"name": name, "school": school},
            )
        )
    ruleset = Ruleset(name="House", schema_id="import-rpg", owner_id=admin_id)
    db.add(ruleset)
    db.flush()
    db.add(
        RulesetEntry(
            ruleset_id=ruleset.id,
            schema_id="import-rpg",
            content_type="spell",
            entry_id="light",
            name="Light",
            data={"name": "Light", "school": "evocation"},
        )
    )
    db.commit()
    db.close()
    yield
    db = SessionLocal()
    db.query(ContentEntry).filter_by(schema_id="import-rpg").delete()
    db.query(ContentPack).filter_by(pack_id="import-pack").delete()
    db.query(RulesetEntry).filter_by(schema_id="import-rpg").delete()
    db.query(Ruleset).filter_by(schema_id="import-rpg").delete()
    db.query(Character).filter_by(schema_ref="import-rpg").delete()
    db.commit()
    db.close()


@pytest.fixture
def clean_state():
    yield
    db = SessionLocal()
    row = db.query(AppSetting).filter_by(key=SETTING_INSTALLED).first()
    if row:
        db.delete(row)
    db.commit()
    db.close()


@pytest.fixture(autouse=True)
def offline_index(monkeypatch):
    """No test here reaches the real community index. Listing importers
    refreshes an empty index cache, so that refresh is stubbed, and the cache
    is cleared on the way out."""

    def no_refresh(db, url=None):
        raise addon_install.AddonFetchError("offline in tests")

    monkeypatch.setattr(addon_install, "refresh_index", no_refresh)
    yield
    db = SessionLocal()
    db.query(AppSetting).filter_by(key=SETTING_INDEX_CACHE).delete()
    db.query(UserImporter).delete()
    db.commit()
    db.close()


# --- the manifest ------------------------------------------------------------


class TestManifest:
    def test_a_valid_importer_loads_with_a_character_target(self):
        manifest = _manifest()
        assert manifest.is_importer
        assert manifest.target == "character"
        assert manifest.importer.accepts_files

    @pytest.mark.parametrize(
        "changes, message",
        [
            ({"sheet": "Not A Sheet"}, "sheet id"),
            ({"extensions": ["hero"]}, "start with '.'"),
            ({"detect": ["kind"]}, "must start with"),
            ({"fields": {"level": "$.["}}, "invalid path"),
            ({"fields": {"level": {"from": "$.a", "transform": "explode"}}}, "unknown transform"),
            ({"fields": {"level": {"from": "$.a", "value": 1}}}, "exactly one"),
            ({"fields": {"level": {"template": "no placeholder"}}}, "placeholder"),
            ({"fields": {"spells": {"from": "$.s", "name": "$.absolute"}}}, "relative"),
            ({"extensions": None, "detect": None}, "needs 'extensions'"),
            ({"url": {"pattern": "(a+)+"}}, "nested quantifier"),
            ({"url": {"pattern": "no-group"}}, "capture group"),
            ({"url": {"pattern": "(x)", "fetch": "ftp://x/{identity}"}}, "http"),
            ({"url": {"pattern": "(x)", "fetch": "https://x/"}}, "{identity}"),
            ({"url": {"pattern": "(x)"}}, "needs 'fetch'"),
        ],
    )
    def test_bad_definitions_are_rejected_with_a_reason(self, changes, message):
        with pytest.raises(ValidationError) as caught:
            _manifest(**changes)
        assert message in str(caught.value)

    def test_an_importer_needs_its_block_and_cannot_scrape(self):
        base = {k: v for k, v in MANIFEST.items() if k != "importer"}
        with pytest.raises(ValidationError, match="needs an 'importer' block"):
            AddonManifest(**base)
        with pytest.raises(ValidationError, match="not 'source'"):
            AddonManifest(**MANIFEST, map={"title": {"from": "x"}})
        with pytest.raises(ValidationError, match="target must be 'character'"):
            AddonManifest(**{**MANIFEST, "target": "book"})

    def test_a_scraper_cannot_carry_an_importer_or_make_characters(self):
        scraper = {
            "id": "s",
            "name": "S",
            "version": "1.0.0",
            "kind": "scraper",
            "source": {"url": "https://example.com/x.json", "format": "json"},
            "search": {"fields": [{"field": "name"}]},
        }
        with pytest.raises(ValidationError, match="only a character importer"):
            AddonManifest(**scraper, importer=MANIFEST["importer"])
        with pytest.raises(ValidationError, match="'game-system' or 'book'"):
            AddonManifest(**scraper, target="character")

    def test_a_script_importer_needs_no_fields_or_fetch(self):
        data = json.loads(json.dumps(MANIFEST))
        data["script"] = {"entry": "go.py"}
        data["importer"]["fields"] = {}
        data["importer"]["url"] = {"pattern": r"id=(\d+)"}
        assert AddonManifest(**data).requires_script


# --- the engine --------------------------------------------------------------


class TestRecognising:
    def test_extension_and_detect_must_both_hold(self):
        spec = _manifest().importer
        assert engine.file_match(spec, "ash.HERO", HERO) == 3
        assert engine.file_match(spec, "ash.json", HERO) == 0
        assert engine.file_match(spec, "ash.hero", {"other": 1}) == 0

    def test_detect_alone_reads_any_extension(self):
        spec = _manifest(extensions=None).importer
        assert engine.file_match(spec, "whatever.json", HERO) == 2
        assert engine.file_match(spec, "whatever.json", None) == 0

    def test_a_link_only_importer_claims_no_files(self):
        spec = _manifest(
            extensions=None, detect=None, url={"pattern": r"id=(\d+)", "fetch": "https://x/{identity}"}
        ).importer
        assert engine.file_match(spec, "a.hero", HERO) == 0

    def test_link_identity(self):
        spec = _manifest(url={"pattern": r"(?:example\.com/c/|^)(\d+)", "fetch": "https://x/{identity}"}).importer
        assert engine.url_identity(spec, "https://example.com/c/42?x=1") == "42"
        assert engine.url_identity(spec, " 77 ") == "77"
        assert engine.url_identity(spec, "https://elsewhere.com/c/42") is None
        assert engine.url_identity(_manifest().importer, "42") is None

    def test_an_identity_must_be_url_safe(self):
        spec = _manifest(url={"pattern": r"c=(.+)", "fetch": "https://x/{identity}"}).importer
        assert engine.url_identity(spec, "c=../../etc") is None
        assert engine.url_identity(spec, "c=" + "a" * 300) is None


class TestMapping:
    def test_maps_every_kind_of_field(self):
        mapped = engine.map_document(_manifest(), HERO)
        fields = mapped["fields"]
        assert mapped["name"] == "Ash"
        assert fields["level"] == [3]
        assert fields["strength"] == ["3"]
        assert fields["brave"] == [True]
        assert fields["rank"] == ["Veteran"]
        assert fields["skills"] == ["Climb", "Fly", "Hide"]
        assert fields["languages"] == ["Common / Elvish"]
        assert fields["patron"] == [{"name": "Fireball", "description": "Boom."}]
        assert fields["spells"][0] == {"name": "Shield", "match": {"school": "abjuration"}}
        assert fields["spells"][-1]["description"] == "Mine."
        assert fields["gear"] == [{"name": "Rope", "qty": 2}, {"name": "Torch", "qty": 5}]

    def test_a_field_with_nothing_to_read_is_left_out(self):
        mapped = engine.map_document(_manifest(), {"who": {"name": "Bare"}})
        assert "level" not in mapped["fields"]
        assert mapped["portrait"] is None

    def test_a_field_may_take_several_mappings(self):
        manifest = _manifest(fields={"skills": ["$.skills[0].name", {"value": "Swim"}]})
        assert engine.map_document(manifest, HERO)["fields"]["skills"] == ["Climb", "Swim"]

    def test_templates_skip_when_nothing_resolved(self):
        manifest = _manifest(
            fields={
                "notes": {"template": "{$.who.name} the {$.rank}"},
                "languages": {"template": "Speaks {$.missing}"},
            }
        )
        fields = engine.map_document(manifest, HERO)["fields"]
        assert fields["notes"] == ["Ash the vet"]
        assert "languages" not in fields

    def test_keys_and_falsy_answers(self):
        manifest = _manifest(
            fields={
                "skills": {"from": "$.p[?(@ == 2)]", "keys": True, "transform": "titlecase"},
                "brave": "$.flag",
                "level": "$.zero",
            }
        )
        fields = engine.map_document(manifest, {"p": {"climb": 2, "hide": 0}, "flag": False, "zero": 0})[
            "fields"
        ]
        assert fields == {"skills": ["Climb"], "brave": [False], "level": [0]}

    def test_a_document_that_is_not_json_is_refused(self):
        with pytest.raises(engine.ImporterError):
            engine.map_document(_manifest(), None)

    def test_a_scraper_is_not_an_importer(self):
        scraper = AddonManifest(
            id="s",
            name="S",
            version="1.0.0",
            kind="scraper",
            source={"url": "https://example.com/x.json", "format": "json"},
            search={"fields": [{"field": "name"}]},
        )
        with pytest.raises(engine.ImporterError):
            engine.spec_of(scraper)

    def test_per_entry_values_are_read_for_each_item(self):
        manifest = _manifest(
            fields={"spells": {"from": "$.spells[*]", "per": {"prepared": "@.ready"}}}
        )
        document = {"spells": [{"name": "Shield", "ready": True}, {"name": "Light"}]}
        assert engine.map_document(manifest, document)["fields"]["spells"] == [
            {"name": "Shield", "per": {"prepared": True}},
            {"name": "Light"},
        ]

    def test_the_portrait_is_read_as_text(self):
        manifest = _manifest(portrait="$.pic")
        assert engine.map_document(manifest, {"pic": "data:x"})["portrait"] == "data:x"
        assert engine.map_document(manifest, {"pic": {"no": 1}})["portrait"] is None


# --- onto the sheet ----------------------------------------------------------


class TestBuildingData:
    def test_collapses_matches_and_coerces(self, content, admin_id):
        mapped = engine.map_document(_manifest(), HERO)
        document = validate_schema(SHEET)
        db = SessionLocal()
        try:
            data, unmatched = importing.build_data(db, admin_id, document, mapped["fields"])
        finally:
            db.close()

        assert data["level"] == 3
        assert data["strength"] == 3
        assert data["brave"] is True
        assert data["rank"] == "Veteran"
        # Fly is not one of the sheet's options, so coercion drops it.
        assert data["skills"] == ["Climb", "Hide"]
        assert data["notes"] == "Line one\nLine two"
        assert "not_a_field" not in data
        assert data["patron"] == {"_ref": "fireball", "_source": "srd"}
        # Shield is matched on its school - the illusion copy is passed over -
        # and listed once; Light comes from the ruleset; the homebrew is kept.
        assert data["spells"] == [
            {"_ref": "shield", "_source": "srd"},
            {"_ref": "fireball", "_source": "srd"},
            {"_ref": "light", "_source": "ruleset"},
            {"_inline": True, "name": "Homebrew Bolt", "description": "Mine."},
        ]
        assert unmatched == ["Homebrew Bolt"]
        assert data["gear"] == [{"name": "Rope", "qty": 2}, {"name": "Torch", "qty": 5}]

    def test_match_criteria_that_fit_nothing_keep_a_custom_entry(self, content, admin_id):
        document = validate_schema(SHEET)
        db = SessionLocal()
        try:
            data, unmatched = importing.build_data(
                db,
                admin_id,
                document,
                {"spells": [{"name": "Fireball", "match": {"school": "necromancy"}}], "level": "x"},
            )
        finally:
            db.close()
        assert data == {"spells": [{"_inline": True, "name": "Fireball"}]}
        assert unmatched == ["Fireball"]

    def test_per_entry_values_reach_matched_and_custom_entries(self, content, admin_id):
        document = validate_schema(SHEET)
        db = SessionLocal()
        try:
            data, _ = importing.build_data(
                db,
                admin_id,
                document,
                {
                    "spells": [
                        {"name": "Fireball", "per": {"prepared": True}},
                        # A per-entry key the sheet does not declare is dropped.
                        {"name": "Homebrew Bolt", "per": {"prepared": 1, "charges": 3}},
                    ]
                },
            )
        finally:
            db.close()
        assert data["spells"] == [
            {"_ref": "fireball", "_source": "srd", "_per": {"prepared": True}},
            {"_inline": True, "name": "Homebrew Bolt", "_per": {"prepared": True}},
        ]

    def test_text_joins_several_values(self):
        assert importing._collapse({"type": "text"}, ["a", "b"]) == "a, b"
        assert importing._collapse({"type": "number"}, []) is None
        assert importing._collapse({"type": "content_ref"}, []) is None


class TestPortraits:
    def test_decodes_a_data_url(self):
        decoded = importing.decode_portrait(_png_data_url())
        assert decoded is not None and decoded[1] == ".png"

    @pytest.mark.parametrize(
        "value",
        [
            None,
            "https://example.com/me.png",
            "data:image/svg+xml;base64,PHN2Zz4=",
            "data:image/png;base64,not base64!",
            "data:image/png;base64,",
            "data:image/png;base64," + base64.b64encode(b"not an image").decode(),
        ],
    )
    def test_anything_else_is_ignored(self, value):
        assert importing.decode_portrait(value) is None

    def test_an_oversized_portrait_is_ignored(self, monkeypatch):
        monkeypatch.setattr(importing, "MAX_PORTRAIT_BYTES", 10)
        assert importing.decode_portrait(_png_data_url()) is None


class TestScriptImport:
    def test_normalises_the_scripts_answer(self, monkeypatch):
        monkeypatch.setattr(
            scripts,
            "_run",
            lambda request, manifest: {
                "name": "Scripted",
                "portrait": 5,
                "fields": {"level": 4, "skills": ["Climb"], "notes": None},
            },
        )
        result = scripts.run_import(_manifest(), document={"a": 1})
        assert result == {
            "name": "Scripted",
            "portrait": None,
            "fields": {"level": [4], "skills": ["Climb"]},
        }

    def test_a_script_without_fields_fails(self, monkeypatch):
        monkeypatch.setattr(scripts, "_run", lambda request, manifest: {"name": "x"})
        with pytest.raises(scripts.AddonScriptError):
            scripts.run_import(_manifest())


# --- the API -----------------------------------------------------------------


def _import(client, headers, **body):
    return client.post("/api/characters/import/external", json=body, headers=headers)


class TestApi:
    def test_lists_runnable_importers_with_their_sheet(
        self, client, admin_headers, addons_dir, sheet, clean_state
    ):
        _install(addons_dir, MANIFEST)
        listed = client.get("/api/characters/importers", headers=admin_headers).json()
        assert listed["importers"] == [
            {
                "id": "import-demo",
                "name": "Import Demo",
                "description": "",
                "homepage": "",
                "author": "hunter-read",
                "author_url": "https://github.com/hunter-read",
                "attribution": "",
                "sheet": "import-rpg",
                "sheet_name": "Import RPG",
                "sheet_installed": True,
                "extensions": [".hero"],
                "accepts_files": True,
                "accepts_url": False,
                "url_hint": "",
                "inputs": [],
                "version": "1.0.0",
                "scope": "server",
                "available_version": "",
            }
        ]

    def test_a_disabled_importer_is_not_listed(self, client, admin_headers, addons_dir, clean_state):
        _install(addons_dir, MANIFEST)
        db = SessionLocal()
        registry.update_state_for(db, "import-demo", enabled=False)
        db.commit()
        db.close()
        assert client.get("/api/characters/importers", headers=admin_headers).json() == {
            "importers": [],
            "available": [],
            "downloads_enabled": True,
        }

    def test_imports_a_file(self, client, admin_headers, addons_dir, sheet, content, clean_state):
        _install(addons_dir, MANIFEST)
        hero = {**HERO, "portrait": _png_data_url()}
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["importer"]["portrait"] = "$.portrait"
        (addons_dir / "import-demo" / "import-demo.yml").write_text(yaml.safe_dump(manifest))

        resp = _import(client, admin_headers, text=json.dumps(hero), filename="ash.hero")
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Ash"
        assert body["importer_id"] == "import-demo"
        assert body["unmatched"] == ["Homebrew Bolt"]
        assert body["data"]["hero"] == "Ash"
        assert body["data"]["level"] == 3
        assert body["data"]["spells"][0] == {"_ref": "shield", "_source": "srd"}
        assert body["portrait_path"] == f"{body['id']}.png"
        assert os.path.isfile(os.path.join(CHARACTER_PORTRAIT_DIR, body["portrait_path"]))

    def test_the_name_falls_back_to_the_sheets_name_field(
        self, client, admin_headers, addons_dir, sheet, clean_state
    ):
        manifest = json.loads(json.dumps(MANIFEST))
        del manifest["importer"]["name"]
        _install(addons_dir, manifest)
        resp = _import(client, admin_headers, text=json.dumps(HERO), filename="ash.hero")
        assert resp.json()["name"] == "Ash"
        # Starting values the import did not set are still recorded.
        assert resp.json()["data"]["strength"] == 3

    def test_needs_exactly_one_of_a_file_or_a_link(self, client, admin_headers):
        assert _import(client, admin_headers).status_code == 400
        assert _import(client, admin_headers, text="{}", url="https://x").status_code == 400

    def test_with_nothing_installed(self, client, admin_headers, addons_dir):
        resp = _import(client, admin_headers, text="{}", filename="a.json")
        assert resp.status_code == 400
        assert "No character importers are installed" in resp.json()["detail"]

    def test_an_unknown_importer_is_404(self, client, admin_headers, addons_dir, clean_state):
        _install(addons_dir, MANIFEST)
        resp = _import(client, admin_headers, importer_id="nope", text="{}", filename="a.hero")
        assert resp.status_code == 404

    def test_an_unrecognised_file(self, client, admin_headers, addons_dir, clean_state):
        _install(addons_dir, MANIFEST)
        resp = _import(client, admin_headers, text="not json", filename="a.txt")
        assert resp.status_code == 400
        assert "recognises this file" in resp.json()["detail"]

    def test_ambiguity_asks_for_a_choice_and_a_choice_settles_it(
        self, client, admin_headers, addons_dir, sheet, clean_state
    ):
        _install(addons_dir, MANIFEST)
        _install(addons_dir, {**MANIFEST, "id": "import-twin", "name": "Twin"})
        resp = _import(client, admin_headers, text=json.dumps(HERO), filename="ash.hero")
        assert resp.status_code == 409
        assert "Import Demo" in resp.json()["detail"] and "Twin" in resp.json()["detail"]

        chosen = _import(
            client, admin_headers, importer_id="import-twin", text=json.dumps(HERO), filename="x.txt"
        )
        assert chosen.status_code == 200, chosen.text
        assert chosen.json()["importer_id"] == "import-twin"

    def test_a_link_only_importer_cannot_be_chosen_for_a_file(
        self, client, admin_headers, addons_dir, clean_state
    ):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["importer"].pop("extensions")
        manifest["importer"].pop("detect")
        manifest["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        _install(addons_dir, manifest)
        resp = _import(client, admin_headers, importer_id="import-demo", text="{}", filename="a")
        assert resp.status_code == 400
        assert "only reads links" in resp.json()["detail"]

    def test_imports_a_link(self, client, admin_headers, addons_dir, sheet, clean_state, monkeypatch):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["importer"]["url"] = {
            "pattern": r"example\.test/c/(\d+)",
            "fetch": "https://api.example.test/{identity}.json",
        }
        _install(addons_dir, manifest)
        requested = []

        def fake_fetch(url, **kwargs):
            requested.append((url, kwargs["cache_ttl"]))
            return HERO

        from backend.addons import fetch

        monkeypatch.setattr(fetch, "fetch_document", fake_fetch)
        resp = _import(client, admin_headers, url="https://example.test/c/42")
        assert resp.status_code == 200, resp.text
        # Only the definition's endpoint is requested, and never cached.
        assert requested == [("https://api.example.test/42.json", 0)]
        assert resp.json()["data"]["level"] == 3

        assert _import(client, admin_headers, url="https://other.test/c/1").status_code == 400

    @pytest.mark.parametrize(
        "failure, status",
        [("source returned HTTP 404", 400), ("source timed out", 502)],
    )
    def test_a_link_that_fails(
        self, client, admin_headers, addons_dir, clean_state, monkeypatch, failure, status
    ):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        _install(addons_dir, manifest)
        from backend.addons import fetch

        def boom(url, **kwargs):
            raise fetch.AddonFetchError(failure)

        monkeypatch.setattr(fetch, "fetch_document", boom)
        assert _import(client, admin_headers, url="c/5").status_code == status

    def test_a_link_answering_with_something_else(
        self, client, admin_headers, addons_dir, clean_state, monkeypatch
    ):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        _install(addons_dir, manifest)
        from backend.addons import fetch

        monkeypatch.setattr(fetch, "fetch_document", lambda url, **kw: {"success": False})
        resp = _import(client, admin_headers, url="c/5")
        assert resp.status_code == 400
        assert "no character at that link" in resp.json()["detail"]

    def test_a_scripted_importer(
        self, client, admin_headers, addons_dir, sheet, clean_state, monkeypatch
    ):
        manifest = json.loads(json.dumps(MANIFEST))
        manifest["script"] = {"entry": "go.py"}
        manifest["importer"]["fields"] = {}
        manifest["importer"]["url"] = {"pattern": r"c/(\d+)"}
        _install(addons_dir, manifest)
        (addons_dir / "import-demo" / "go.py").write_text("def main():\n    pass\n")
        db = SessionLocal()
        registry.set_scripts_allowed(db, True)
        registry.update_state_for(db, "import-demo", script_approved=True)
        db.commit()
        db.close()
        seen = {}

        def fake_run(manifest, **kwargs):
            seen.update(kwargs)
            return {"name": "Scripted", "portrait": None, "fields": {"level": [7]}}

        monkeypatch.setattr(scripts, "run_import", fake_run)
        try:
            resp = _import(client, admin_headers, url="c/9")
            assert resp.status_code == 200, resp.text
            assert resp.json()["data"]["level"] == 7
            # No fetch URL: the script gets the id and fetches for itself.
            assert seen["identity"] == "9" and seen["document"] is None

            def failing(manifest, **kwargs):
                raise scripts.AddonScriptError("upstream said no")

            monkeypatch.setattr(scripts, "run_import", failing)
            resp = _import(client, admin_headers, url="c/9")
            assert resp.status_code == 502
            assert "upstream said no" in resp.json()["detail"]
        finally:
            db = SessionLocal()
            registry.set_scripts_allowed(db, False)
            db.commit()
            db.close()

    def test_a_mapping_error_is_reported(self, client, admin_headers, addons_dir, clean_state):
        _install(addons_dir, MANIFEST)
        resp = _import(
            client, admin_headers, importer_id="import-demo", text="not json", filename="a.hero"
        )
        assert resp.status_code == 400
        assert "not a JSON document" in resp.json()["detail"]

    def test_a_missing_sheet_is_installed_from_the_catalogue(
        self, client, gm_headers, addons_dir, clean_state, monkeypatch
    ):
        _install(addons_dir, MANIFEST)
        monkeypatch.setattr(
            catalogue,
            "fetch_catalogue",
            lambda db: {"sheets": [{"raw_id": "import-rpg", "version": "1.0.0", "index_url": "u"}]},
        )
        monkeypatch.setattr(catalogue, "fetch_sheet", lambda db, entry: json.loads(json.dumps(SHEET)))
        resp = _import(client, gm_headers, text=json.dumps(HERO), filename="ash.hero")
        assert resp.status_code == 200, resp.text
        schemas = client.get("/api/characters/schemas", headers=gm_headers).json()["schemas"]
        installed = [s for s in schemas if s["schema_id"] == "import-rpg"]
        assert installed and installed[0]["source_id"] == "import-rpg"
        client.delete(f"/api/characters/{resp.json()['id']}", headers=gm_headers)
        client.delete("/api/characters/schemas/import-rpg", headers=gm_headers)

    def test_a_sheet_the_catalogue_lacks_is_named(
        self, client, gm_headers, addons_dir, clean_state, monkeypatch
    ):
        _install(addons_dir, MANIFEST)

        def offline(db):
            raise catalogue.CatalogueError("offline")

        monkeypatch.setattr(catalogue, "fetch_catalogue", offline)
        resp = _import(client, gm_headers, text=json.dumps(HERO), filename="ash.hero")
        assert resp.status_code == 400
        assert "'import-rpg' sheet" in resp.json()["detail"]

    def test_a_campaign_must_be_the_players(self, client, admin_headers, addons_dir, clean_state):
        _install(addons_dir, MANIFEST)
        resp = _import(
            client, admin_headers, text=json.dumps(HERO), filename="a.hero", campaign_id="nope"
        )
        assert resp.status_code in (400, 403, 404)

    def test_requires_authentication(self, client):
        assert client.get("/api/characters/importers").status_code in (401, 403)


# --- inputs ------------------------------------------------------------------

KEY_INPUT = {"key": "api_key", "label": "API key", "secret": True, "when": "link"}


def _scripted(**importer_changes) -> dict:
    manifest = json.loads(json.dumps(MANIFEST))
    manifest["script"] = {"entry": "go.py"}
    manifest["importer"]["fields"] = {}
    manifest["importer"]["url"] = {"pattern": r"c/(\d+)"}
    manifest["importer"].update(importer_changes)
    return manifest


@pytest.fixture
def scripted(addons_dir, clean_state):
    """Install a script-backed importer, allowed and approved."""

    def install(manifest: dict) -> None:
        _install(addons_dir, manifest)
        (addons_dir / manifest["id"] / "go.py").write_text("def main():\n    pass\n")
        db = SessionLocal()
        registry.set_scripts_allowed(db, True)
        registry.update_state_for(db, manifest["id"], script_approved=True)
        db.commit()
        db.close()

    yield install
    db = SessionLocal()
    registry.set_scripts_allowed(db, False)
    db.commit()
    db.close()


class TestInputManifest:
    def test_inputs_are_declared_on_a_script_importer(self):
        manifest = AddonManifest(**_scripted(inputs=[KEY_INPUT]))
        (declared,) = manifest.importer.inputs
        assert declared.secret and not declared.required
        assert manifest.importer.inputs_for("link") == [declared]
        assert manifest.importer.inputs_for("file") == []

    def test_a_yaml_importer_cannot_take_inputs(self):
        with pytest.raises(ValidationError, match="need a 'script'"):
            _manifest(inputs=[KEY_INPUT])

    @pytest.mark.parametrize(
        "inputs, message",
        [
            ([{**KEY_INPUT, "key": "API-Key"}], "lowercase letters"),
            ([KEY_INPUT, KEY_INPUT], "its own key"),
            ([{**KEY_INPUT, "key": f"k{i}"} for i in range(6)], "at most 5"),
            ([{**KEY_INPUT, "when": "sometimes"}], "when"),
        ],
    )
    def test_bad_inputs_are_rejected(self, inputs, message):
        with pytest.raises(ValidationError, match=message):
            AddonManifest(**_scripted(inputs=inputs))


class TestInputApi:
    def test_the_listing_describes_the_inputs(self, client, admin_headers, scripted):
        scripted(_scripted(inputs=[{**KEY_INPUT, "help": "From your account page."}]))
        (importer,) = client.get("/api/characters/importers", headers=admin_headers).json()[
            "importers"
        ]
        assert importer["inputs"] == [
            {
                "key": "api_key",
                "label": "API key",
                "help": "From your account page.",
                "secret": True,
                "required": False,
                "when": "link",
            }
        ]

    def test_declared_answers_reach_the_script_and_nothing_else(
        self, client, admin_headers, sheet, scripted, monkeypatch
    ):
        scripted(
            _scripted(
                inputs=[KEY_INPUT, {"key": "file_only", "label": "Only for files", "when": "file"}]
            )
        )
        seen = {}

        def fake_run(manifest, **kwargs):
            seen.update(kwargs)
            return {"name": "Keyed", "portrait": None, "fields": {"level": [2]}}

        monkeypatch.setattr(scripts, "run_import", fake_run)
        resp = _import(
            client,
            admin_headers,
            url="c/7",
            inputs={"api_key": "  secret-key ", "file_only": "x", "smuggled": "y"},
        )
        assert resp.status_code == 200, resp.text
        assert seen["inputs"] == {"api_key": "secret-key"}
        # Nothing typed into an input is kept on the character.
        assert "secret-key" not in json.dumps(resp.json())

    def test_a_missing_required_input_is_asked_for_before_anything_runs(
        self, client, admin_headers, scripted, monkeypatch
    ):
        manifest = _scripted(inputs=[{**KEY_INPUT, "required": True}])
        manifest["importer"]["url"]["fetch"] = "https://x.test/{identity}"
        scripted(manifest)
        from backend.addons import fetch

        def never(*args, **kwargs):
            raise AssertionError("nothing should run without the required input")

        monkeypatch.setattr(fetch, "fetch_document", never)
        monkeypatch.setattr(scripts, "run_import", never)
        resp = _import(client, admin_headers, url="c/7", inputs={"api_key": "   "})
        assert resp.status_code == 400
        assert resp.json()["detail"] == {
            "message": "Import Demo: fill in API key",
            "importer_id": "import-demo",
            "needs_input": ["api_key"],
        }

    def test_a_script_can_ask_for_an_input(self, client, admin_headers, scripted, monkeypatch):
        scripted(_scripted(inputs=[KEY_INPUT]))

        def private(manifest, **kwargs):
            raise scripts.AddonScriptError("this character is private", needs_input=["api_key"])

        monkeypatch.setattr(scripts, "run_import", private)
        resp = _import(client, admin_headers, url="c/7")
        assert resp.status_code == 400
        detail = resp.json()["detail"]
        assert detail["needs_input"] == ["api_key"]
        assert detail["importer_id"] == "import-demo"
        assert "private" in detail["message"]

    def test_asking_for_an_undeclared_input_is_an_ordinary_failure(
        self, client, admin_headers, scripted, monkeypatch
    ):
        scripted(_scripted(inputs=[KEY_INPUT]))

        def confused(manifest, **kwargs):
            raise scripts.AddonScriptError("need a password", needs_input=["password"])

        monkeypatch.setattr(scripts, "run_import", confused)
        resp = _import(client, admin_headers, url="c/7")
        assert resp.status_code == 502
        assert resp.json()["detail"] == "Import Demo: need a password"

    def test_answers_are_bounded(self, client, admin_headers):
        resp = _import(client, admin_headers, url="c/7", inputs={"api_key": "x" * 2001})
        assert resp.status_code == 422


class TestInputScripts:
    def test_inputs_travel_in_the_request(self, monkeypatch):
        seen = {}

        def fake(request, manifest):
            seen.update(request)
            return {"fields": {}}

        monkeypatch.setattr(scripts, "_run", fake)
        scripts.run_import(_manifest(), identity="7", inputs={"api_key": "k"})
        assert seen["action"] == "import" and seen["inputs"] == {"api_key": "k"}
        scripts.run_import(_manifest())
        assert seen["inputs"] == {}

    def test_a_scripts_request_for_input_is_kept(self, tmp_path, monkeypatch):
        manifest = AddonManifest(**_scripted(inputs=[KEY_INPUT]))
        directory = tmp_path / manifest.id
        directory.mkdir()
        (directory / "go.py").write_text(
            "import json, sys\n"
            "def main():\n"
            "    request = json.load(sys.stdin)\n"
            "    if not request['inputs'].get('api_key'):\n"
            "        print(json.dumps({'error': 'private', 'needs_input': ['api_key', 3]}))\n"
            "    else:\n"
            "        print(json.dumps({'fields': {'level': len(request['inputs']['api_key'])}}))\n"
        )
        monkeypatch.setattr(registry, "ADDONS_DIR", str(tmp_path))
        with pytest.raises(scripts.AddonScriptError) as caught:
            scripts.run_import(manifest, identity="7")
        assert caught.value.needs_input == ["api_key"]
        result = scripts.run_import(manifest, identity="7", inputs={"api_key": "abcd"})
        assert result["fields"] == {"level": [4]}


# --- installing for yourself -------------------------------------------------

INDEX = "https://index.test/index.json"


def _yaml(manifest: dict) -> bytes:
    return yaml.safe_dump(manifest).encode()


def _entry(manifest: dict, body: bytes, **extra) -> dict:
    import hashlib

    return {
        "id": manifest["id"],
        "name": manifest["name"],
        "kind": manifest["kind"],
        "target": "character",
        "version": manifest["version"],
        "path": f"importers/{manifest['id']}/{manifest['id']}.yml",
        "sha256": hashlib.sha256(body).hexdigest(),
        "requires_script": "script" in manifest,
        "sheet": manifest["importer"]["sheet"],
        "user_installable": "script" not in manifest and "url" not in manifest["importer"],
        "index_url": INDEX,
        **extra,
    }


@pytest.fixture
def index(monkeypatch):
    """Publish manifests in a stub index: ``publish(manifest, **entry)``."""
    files: dict[str, bytes] = {}
    entries: list[dict] = []

    def publish(manifest: dict, body: bytes = b"", **extra) -> dict:
        body = body or _yaml(manifest)
        entry = _entry(manifest, _yaml(manifest), **extra)
        files[f"https://index.test/{entry['path']}"] = body
        entries[:] = [e for e in entries if e["id"] != entry["id"]] + [entry]
        db = SessionLocal()
        registry.save_cached_index(db, {"addons": entries, "_url": INDEX})
        db.commit()
        db.close()
        return entry

    def fetch_text(url, credentials=None):
        if url not in files:
            raise addon_install.AddonFetchError("source returned HTTP 404")
        return files[url]

    monkeypatch.setattr(addon_install, "_fetch_text", fetch_text)
    return publish


def _bump(manifest: dict, version: str) -> dict:
    return {**json.loads(json.dumps(manifest)), "version": version}


class TestWhoMayInstall:
    def test_a_file_only_yaml_importer_is_for_anyone(self):
        assert AddonManifest(**MANIFEST).user_installable

    def test_a_link_or_a_script_needs_an_admin(self):
        with_link = json.loads(json.dumps(MANIFEST))
        with_link["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        assert not AddonManifest(**with_link).user_installable
        assert not AddonManifest(**_scripted()).user_installable


class TestCatalogue:
    def test_lists_only_importers(self, index):
        index(MANIFEST)
        db = SessionLocal()
        cached = registry.get_cached_index(db)
        cached["addons"].append({**cached["addons"][0], "id": "a-scraper", "kind": "scraper"})
        registry.save_cached_index(db, cached)
        db.commit()
        assert [e.id for e in user_importers.catalogue(db)] == ["import-demo"]
        db.close()

    def test_an_empty_cache_is_refreshed_once(self, monkeypatch):
        calls = []

        def refresh(db, url=None):
            calls.append(1)
            registry.save_cached_index(db, {"addons": [_entry(MANIFEST, _yaml(MANIFEST))]})

        monkeypatch.setattr(addon_install, "refresh_index", refresh)
        db = SessionLocal()
        assert [e.id for e in user_importers.catalogue(db)] == ["import-demo"]
        assert calls == [1]
        db.close()

    def test_a_failed_refresh_lists_nothing(self):
        db = SessionLocal()
        assert user_importers.catalogue(db) == []
        db.close()


class TestUserInstallApi:
    def test_a_player_installs_imports_and_removes(
        self, client, player_headers, gm_headers, index, monkeypatch
    ):
        index(MANIFEST)
        monkeypatch.setattr(
            catalogue,
            "fetch_catalogue",
            lambda db: {"sheets": [{"raw_id": "import-rpg", "version": "1.0.0", "index_url": "u"}]},
        )
        monkeypatch.setattr(catalogue, "fetch_sheet", lambda db, entry: json.loads(json.dumps(SHEET)))

        listed = client.get("/api/characters/importers", headers=player_headers).json()
        assert listed["importers"] == []
        (offer,) = listed["available"]
        assert offer["install_as"] == "user"
        assert offer["sheet"] == "import-rpg"

        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 200, resp.text
        assert resp.json() == {"id": "import-demo", "name": "Import Demo", "version": "1.0.0"}

        listed = client.get("/api/characters/importers", headers=player_headers).json()
        assert [(i["id"], i["scope"]) for i in listed["importers"]] == [("import-demo", "user")]
        assert listed["available"] == []
        # Only for the player who installed it.
        other = client.get("/api/characters/importers", headers=gm_headers).json()
        assert other["importers"] == []

        made = _import(client, player_headers, text=json.dumps(HERO), filename="ash.hero")
        assert made.status_code == 200, made.text
        assert made.json()["importer_id"] == "import-demo"

        assert client.delete(
            "/api/characters/importers/import-demo", headers=player_headers
        ).json() == {"deleted": True, "id": "import-demo"}
        assert (
            client.delete("/api/characters/importers/import-demo", headers=player_headers).status_code
            == 404
        )
        client.delete(f"/api/characters/{made.json()['id']}", headers=player_headers)
        client.delete("/api/characters/schemas/import-rpg", headers=player_headers)

    def test_an_update_is_offered_and_applied(self, client, player_headers, index):
        index(MANIFEST)
        client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        index(_bump(MANIFEST, "1.1.0"))
        (mine,) = client.get("/api/characters/importers", headers=player_headers).json()[
            "importers"
        ]
        assert mine["available_version"] == "1.1.0"
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.json()["version"] == "1.1.0"
        db = SessionLocal()
        assert db.query(UserImporter).filter_by(importer_id="import-demo").count() == 1
        db.close()

    def test_how_each_caller_could_get_what_they_lack(
        self, client, player_headers, admin_headers, index
    ):
        linked = {**json.loads(json.dumps(MANIFEST)), "id": "linked", "name": "Linked"}
        linked["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        index(MANIFEST)
        index(linked)
        index(_scripted() | {"id": "scripted", "name": "Scripted"})

        def offers(headers):
            listed = client.get("/api/characters/importers", headers=headers).json()
            return {a["id"]: a["install_as"] for a in listed["available"]}

        assert offers(player_headers) == {
            "import-demo": "user",
            "linked": "admin",
            "scripted": "admin",
        }
        assert offers(admin_headers) == {
            "import-demo": "server",
            "linked": "server",
            "scripted": "settings",
        }

    def test_one_needing_a_newer_grimoire_is_not_offered(
        self, client, player_headers, index, monkeypatch
    ):
        from backend import config

        monkeypatch.setattr(config, "VERSION", "1.8.0")
        index(MANIFEST, grimoire_min_version="9.0.0")
        listed = client.get("/api/characters/importers", headers=player_headers).json()
        assert listed["available"] == []
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 400
        assert "needs Grimoire 9.0.0" in resp.json()["detail"]

    def test_the_server_copy_wins(
        self, client, player_headers, index, addons_dir, clean_state
    ):
        index(MANIFEST)
        client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        _install(addons_dir, MANIFEST)
        listed = client.get("/api/characters/importers", headers=player_headers).json()
        assert [(i["id"], i["scope"]) for i in listed["importers"]] == [("import-demo", "server")]

    def test_the_download_is_what_is_checked_not_the_index(self, client, player_headers, index):
        linked = json.loads(json.dumps(MANIFEST))
        linked["importer"]["url"] = {"pattern": r"c/(\d+)", "fetch": "https://x.test/{identity}"}
        # An index claiming a link importer is user-installable is not believed.
        index(linked, user_installable=True)
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 400
        assert "an admin has to install it" in resp.json()["detail"]

    @pytest.mark.parametrize(
        "body, message",
        [
            (b"id: import-demo\n", "integrity check"),
        ],
    )
    def test_a_tampered_download_is_refused(self, client, player_headers, index, body, message):
        index(MANIFEST, body=body)
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 400
        assert message in resp.json()["detail"]

    def test_an_unreadable_or_mismatched_manifest_is_refused(self, client, player_headers, index):
        import hashlib

        for body, message in (
            (b"id: [unclosed", "unreadable"),
            (_yaml({**MANIFEST, "id": "other"}), "does not match"),
            (b"- a list\n", "not a manifest"),
        ):
            entry = index(MANIFEST, body=body)
            db = SessionLocal()
            cached = registry.get_cached_index(db)
            cached["addons"][0]["sha256"] = hashlib.sha256(body).hexdigest()
            registry.save_cached_index(db, cached)
            db.commit()
            db.close()
            resp = client.post(
                f"/api/characters/importers/{entry['id']}/install", headers=player_headers
            )
            assert resp.status_code == 400, body
            assert message in resp.json()["detail"]

    def test_not_in_the_index(self, client, player_headers, index):
        resp = client.post("/api/characters/importers/nope/install", headers=player_headers)
        assert resp.status_code == 400
        assert "not a character importer" in resp.json()["detail"]

    def test_a_source_that_cannot_be_reached(self, client, player_headers, index, monkeypatch):
        index(MANIFEST)

        def down(url, credentials=None):
            raise addon_install.AddonFetchError("could not reach source")

        monkeypatch.setattr(addon_install, "_fetch_text", down)
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 502

    def test_installs_can_be_switched_off(self, client, player_headers, index, monkeypatch):
        from backend import config

        index(MANIFEST)
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        resp = client.post("/api/characters/importers/import-demo/install", headers=player_headers)
        assert resp.status_code == 403
        listed = client.get("/api/characters/importers", headers=player_headers).json()
        assert listed["downloads_enabled"] is False

    def test_a_tampered_row_is_not_run(self, player_id):
        db = SessionLocal()
        db.add(
            UserImporter(
                user_id=player_id,
                importer_id="import-demo",
                name="Import Demo",
                manifest=_scripted(),
            )
        )
        db.add(UserImporter(user_id=player_id, importer_id="broken", name="x", manifest="nope"))
        db.commit()
        assert user_importers.installed_for_user(db, player_id) == {}
        db.close()
