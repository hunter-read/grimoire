"""The community repository's character importers, against its real sheets.

Every importer under ``importers/`` must load through Grimoire's own manifest
model, and the Forge Steel and Pathbuilder ones are run end to end: a
hand-built export (``fixtures/importers/``) is mapped, matched against the real
content pack, and coerced against the real sheet.

The repository is a sibling checkout, so the module skips when it is absent.
"""
import json
import os

import pytest
import yaml

from backend.tests import community_addons
from backend.addons import importer as engine
from backend.addons.manifest import AddonManifest
from backend.config import SessionLocal
from backend.services.characters import importing, packs
from backend.services.characters.schema import validate_schema

_REPO = community_addons.ROOT
_IMPORTERS = os.path.join(_REPO, "importers")
_FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "importers")

pytestmark = community_addons.marks(_IMPORTERS)


def _importer_ids() -> list[str]:
    if not os.path.isdir(_IMPORTERS):
        return []
    return sorted(
        name
        for name in os.listdir(_IMPORTERS)
        if os.path.isfile(os.path.join(_IMPORTERS, name, f"{name}.yml"))
    )


def _manifest(addon_id: str) -> AddonManifest:
    with open(os.path.join(_IMPORTERS, addon_id, f"{addon_id}.yml"), encoding="utf-8") as fh:
        return AddonManifest(**yaml.safe_load(fh))


def _sheet(sheet_id: str) -> dict:
    path = os.path.join(_REPO, "character-sheets", sheet_id, f"{sheet_id}.json")
    with open(path, encoding="utf-8") as fh:
        raw = json.load(fh)
    for key in ("$schema", "layout_file", "styles_file", "mobile_layout_file",
                "mobile_styles_file"):
        raw.pop(key, None)
    return validate_schema(raw)


def _fixture(name: str):
    with open(os.path.join(_FIXTURES, name), encoding="utf-8") as fh:
        return json.load(fh)


def _import(addon_id: str, fixture: str, pack: str, user_id: str):
    manifest = _manifest(addon_id)
    document = _fixture(fixture)
    sheet = _sheet(manifest.importer.sheet)
    mapped = engine.map_document(manifest, document)
    db = SessionLocal()
    try:
        packs.load_pack(db, os.path.join(_REPO, "content-packs", pack), schema_document=sheet)
        data, unmatched = importing.build_data(db, user_id, sheet, mapped["fields"])
    finally:
        db.rollback()
        db.close()
    return manifest, document, mapped, data, unmatched


@pytest.mark.parametrize("addon_id", _importer_ids())
def test_every_importer_loads_and_names_a_real_sheet(addon_id):
    manifest = _manifest(addon_id)
    assert manifest.is_importer
    sheet = _sheet(manifest.importer.sheet)
    # A mapping onto a field the sheet does not have would be silently dropped
    # at import time, so it is caught here instead.
    unknown = set(manifest.importer.fields) - set(sheet["fields"])
    assert not unknown, f"{addon_id} maps fields its sheet lacks: {sorted(unknown)}"


@pytest.mark.parametrize("addon_id", _importer_ids())
def test_an_importers_example_link_is_one_it_reads(addon_id):
    # The import dialog shows the hint as a working link to try, so it has to
    # be one the importer accepts.
    spec = _manifest(addon_id).importer
    if spec.url is None:
        pytest.skip("reads files only")
    assert spec.url.hint.startswith("https://")
    assert engine.url_identity(spec, spec.url.hint)


class TestForgeSteel:
    @pytest.fixture(scope="class")
    def result(self, admin_id):
        return _import("forge-steel", "forge_steel_hero.ds-hero", "draw-steel-core", admin_id)

    def test_recognises_its_files_and_nothing_else(self, result):
        manifest, document, *_ = result
        spec = manifest.importer
        assert engine.file_match(spec, "Kestrel.ds-hero", document) > 0
        assert engine.file_match(spec, "Kestrel.json", document) > 0
        assert engine.file_match(spec, "build.json", _fixture("pathbuilder_build.json")) == 0

    def test_the_hero(self, result):
        _, _, mapped, data, _ = result
        assert mapped["name"] == "Kestrel"
        assert mapped["portrait"].startswith("data:image/png;base64,")
        assert data["hero_name"] == "Kestrel"
        assert data["level"] == 2
        assert data["xp"] == 9
        assert (data["might"], data["agility"], data["reason"], data["presence"]) == (2, 2, -1, 1)
        assert data["recoveries_used"] == 1
        assert data["stamina_temp"] == 2
        # Forge Steel's free-text inventory box rides along in the notes.
        assert data["notes"] == "Owes a favour.\n\n50 ft of rope"
        assert data["inciting_incident"] == "Betrayed\n\nYour unit sold you out."
        assert data["culture_environment"] == "Urban"

    def test_picks_reference_the_pack(self, result):
        *_, data, _ = result
        assert data["klass"] == {"_ref": "fury", "_source": "heroes"}
        assert data["subclass"] == {"_ref": "fury-reaver", "_source": "heroes"}
        assert data["kit"] == {"_ref": "panther", "_source": "heroes"}
        assert data["culture"] == {"_ref": "artisan-guild", "_source": "heroes"}
        assert data["career"] == {"_ref": "soldier", "_source": "heroes"}
        assert data["ancestry"] == {"_ref": "human", "_source": "heroes"}

    def test_only_choices_in_play_count(self, result):
        *_, data, _ = result
        # "Hide" is chosen at level 3, above the hero's level.
        assert data["skills"] == ["Climb", "Forgery", "Gamble", "Interrogate", "Lift"]
        # The ancestry's typical culture's language is not the hero's.
        assert data["languages"] == "Caelian, Khoursirian"

    def test_features_are_told_apart_by_origin(self, result):
        *_, data, _ = result
        refs = [ref.get("_ref") for ref in data["features"]]
        assert "fury-1-ferocity" in refs
        # Bonuses are the sheet's arithmetic, not features.
        assert not any(ref.get("name") == "Stamina" for ref in data["features"])
        # A selected option travels with Forge Steel's text.
        assert {"_inline": True, "name": "Primordial Strength", "description": "Hit harder."} in data[
            "features"
        ]

    def test_abilities_traits_and_perks(self, result):
        *_, data, unmatched = result
        names = {ref.get("_ref") for ref in data["abilities"]}
        assert "fury-brutal-slam" in names and "fury-back" in names
        assert "fury-hit-and-run" not in names  # offered, not chosen
        trait_refs = {ref.get("_ref") or ref.get("name") for ref in data["ancestry_traits"]}
        assert {"human-detect-the-supernatural", "human-staying-power"} <= trait_refs
        assert "Perseverance" not in trait_refs
        assert data["perks"] == [{"_ref": "brawny", "_source": "heroes"}]
        assert data["titles"] == [{"_ref": "brawler", "_source": "heroes"}]
        assert isinstance(unmatched, list)

    def test_two_kits_and_both_signature_abilities(self, result):
        *_, data, _ = result
        # A tactician's Field Arsenal: the second kit has its own field.
        assert data["kit"] == {"_ref": "panther", "_source": "heroes"}
        assert data["kit_2"] == {"_ref": "mountain", "_source": "heroes"}
        refs = {ref.get("_ref") for ref in data["abilities"]}
        assert {"panther-kit-devastating-rush", "mountain-kit-pain-for-pain"} <= refs

    def test_conditions_sort_by_how_they_end(self, result):
        *_, data, _ = result
        assert data["conditions"] == ["Slowed"]
        assert data["conditions_save"] == ["Weakened"]
        # Until removed, and a custom condition, have no list of their own.
        assert data["condition_1_name"] == "Taunted, Cursed by the lich"

    def test_items_sort_into_the_sheets_lists(self, result):
        *_, data, _ = result
        assert data["trinkets"] == [{"name": "Bastion Belt", "notes": "Trinket (2nd echelon)"}]
        # Forge Steel does not store an item's level, so that column stays empty.
        assert data["leveled_treasures"] == [
            {"name": "Blade of Quintessence", "level": None, "notes": "Leveled Weapon"}
        ]
        assert data["consumables"] == [{"name": "Healing Potion", "qty": 3}]


class TestPathbuilder:
    @pytest.fixture(scope="class")
    def result(self, admin_id):
        return _import("pathbuilder-2e", "pathbuilder_build.json", "pf2e-player-core", admin_id)

    def test_recognised_by_contents(self, result):
        manifest, document, *_ = result
        assert engine.file_match(manifest.importer, "anything.json", document) > 0
        assert engine.file_match(manifest.importer, "x.json", {"name": "not pathbuilder"}) == 0

    def test_the_character(self, result):
        _, _, mapped, data, _ = result
        assert mapped["name"] == "Ilse"
        assert data["level"] == 3
        assert data["xp"] == 120
        assert "deity" not in data  # "Not set" is not a deity
        assert data["key_ability"] == "strength"
        assert (data["strength"], data["dexterity"], data["wisdom"], data["charisma"]) == (4, 1, 1, -1)
        assert data["perception_prof"] == 4
        assert data["will_prof"] == 2
        assert data["skills_trained"] == ["Intimidation", "Religion"]
        assert data["skills_expert"] == ["Athletics"]
        assert data["lore_1_name"] == "Warfare" and data["lore_1_prof"] == 2
        assert data["languages"] == "Common, Dwarven"
        assert (data["copper"], data["silver"], data["gold"]) == (3, 4, 12)

    def test_picks_reference_the_pack(self, result):
        *_, data, unmatched = result
        assert data["ancestry"]["_ref"] == "dwarf"
        assert data["heritage"]["_ref"] == "rock-dwarf"
        assert data["klass"]["_ref"] == "fighter"
        assert data["background"]["_ref"] == "acolyte"
        feats = [ref.get("_ref") or ref.get("name") for ref in data["feats"]]
        # The heritage is not repeated as a feat; a feat the pack lacks is kept.
        assert feats == ["sudden-charge", "Homebrew Feat"]
        assert unmatched == ["Homebrew Feat"]

    def test_rows(self, result):
        *_, data, _ = result
        assert data["strikes"] == [
            {"name": "+1 Warhammer", "bonus": "+9", "damage": "d8 B", "traits": ""}
        ]
        assert [(row["name"], row["qty"]) for row in data["equipment"]] == [
            ("Scale Mail", 1),
            ("Rope", 1),
            ("Torch", 5),
        ]
