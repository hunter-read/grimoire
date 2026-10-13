"""The community repository's script-backed character importers.

D&D Beyond and DiceCloud v1 (ported from Ian Hunter's converters, #552) answer
with a script rather than YAML. Each script is run here as Grimoire runs it -
a separate interpreter, JSON on stdin and stdout - against a hand-built
export, and its answer goes through the same matching and coercion as an
import does, onto the real dnd-5e-2024 sheet and SRD pack.

DiceCloud's network is faked: the script is loaded as a module and
``urlopen`` replaced, so the public, private and wrong-key paths run offline.
"""
import importlib.util
import io
import json
import os
import subprocess
import sys
import urllib.error

import pytest

from backend.config import SessionLocal
from backend.services.characters import importing, packs
from backend.tests.test_bundled_importers import (
    _IMPORTERS,
    _REPO,
    _fixture,
    _manifest,
    _sheet,
)

pytestmark = pytest.mark.skipif(
    not os.path.isdir(_IMPORTERS),
    reason="the community-add-ons repository is not checked out beside this one",
)


def _script_path(addon_id: str) -> str:
    return os.path.join(_IMPORTERS, addon_id, _manifest(addon_id).script.entry)


def _run(addon_id: str, request: dict) -> dict:
    """The script's answer, run the way Grimoire runs it."""
    proc = subprocess.run(
        [sys.executable, "-I", "-B", _script_path(addon_id)],
        input=json.dumps({"action": "import", "inputs": {}, **request}),
        capture_output=True,
        text=True,
        timeout=60,
        check=True,
    )
    return json.loads(proc.stdout)


def _build(addon_id: str, answer: dict, user_id: str) -> tuple[dict, list[str]]:
    """The answer onto the sheet, as the import endpoint does it."""
    sheet = _sheet(_manifest(addon_id).importer.sheet)
    fields = {
        key: value if isinstance(value, list) else [value]
        for key, value in answer["fields"].items()
    }
    db = SessionLocal()
    try:
        packs.load_pack(db, os.path.join(_REPO, "content-packs", "dnd-5e-srd"), schema_document=sheet)
        return importing.build_data(db, user_id, sheet, fields)
    finally:
        db.rollback()
        db.close()


def _load(addon_id: str):
    spec = importlib.util.spec_from_file_location(f"addon_{addon_id.replace('-', '_')}", _script_path(addon_id))
    module = importlib.util.module_from_spec(spec)
    sys.dont_write_bytecode, previous = True, sys.dont_write_bytecode
    try:
        spec.loader.exec_module(module)
    finally:
        sys.dont_write_bytecode = previous
    return module


@pytest.mark.parametrize(
    "addon_id, fixture",
    [("dndbeyond", "dndbeyond_character.json"), ("dicecloud-v1", "dicecloud_v1_character.json")],
)
def test_every_field_a_script_writes_is_on_the_sheet(addon_id, fixture):
    answer = _run(addon_id, {"document": _fixture(fixture)})
    sheet = _sheet(_manifest(addon_id).importer.sheet)
    assert set(answer["fields"]) - set(sheet["fields"]) == set()


@pytest.mark.parametrize("addon_id", ["dndbeyond", "dicecloud-v1"])
def test_a_document_that_is_not_theirs_is_an_error_not_a_crash(addon_id):
    answer = _run(addon_id, {"document": {"name": "nobody"}})
    assert "error" in answer and "fields" not in answer


class TestDndBeyond:
    @pytest.fixture(scope="class")
    def result(self, admin_id):
        answer = _run("dndbeyond", {"document": _fixture("dndbeyond_character.json")})
        data, unmatched = _build("dndbeyond", answer, admin_id)
        return answer, data, unmatched

    def test_recognises_a_saved_character_and_a_link(self):
        spec = _manifest("dndbeyond").importer
        from backend.addons import importer as engine

        assert engine.file_match(spec, "brakka.json", _fixture("dndbeyond_character.json")) > 0
        assert engine.file_match(spec, "x.json", _fixture("dicecloud_v1_character.json")) == 0
        for link in (
            "https://www.dndbeyond.com/characters/1001",
            "https://dndbeyond.com/characters/1001/AbCd12",
            "https://www.dndbeyond.com/profile/someone/characters/1001",
        ):
            assert engine.url_identity(spec, link) == "1001"

    def test_scores_add_up_their_bonuses(self, result):
        _, data, _ = result
        # Constitution is 14 rolled and +2 from the species.
        assert (data["strength"], data["constitution"], data["charisma"]) == (15, 16, 10)
        assert data["level"] == 3

    def test_proficiencies_sort_into_the_sheets_fields(self, result):
        _, data, _ = result
        assert data["skill_profs"] == ["Athletics", "Intimidation"]
        assert data["skill_expertise"] == ["Intimidation"]
        assert data["skill_half_profs"] == ["Stealth"]
        assert data["strength_save_prof"] is True and data["constitution_save_prof"] is True
        assert "wisdom_save_prof" not in data  # left to the class
        assert data["armor_light"] and data["armor_medium"] and data["armor_shields"]
        assert "armor_heavy" not in data
        assert data["weapon_training"] == "Martial Weapons"
        assert data["tool_training"] == "Smith's Tools"
        assert data["languages"] == "Common, Dwarvish"

    def test_hit_points_speed_and_size_only_when_the_sheet_would_be_wrong(self, result):
        _, data, _ = result
        # The fighter's average is 31; Tough's 2 per level makes it 37.
        assert data["hp_max"] == 37
        assert data["hp_current"] == 33
        assert data["hp_temp"] == 3
        # A hill dwarf is not an SRD species, so the sheet cannot know its speed.
        assert data["speed"] == 25
        assert data["size"] == "Medium"

    def test_picks_reference_the_srd_or_stay_custom(self, result):
        _, data, unmatched = result
        assert data["klass"]["_ref"] == "fighter"
        assert data["background"]["_ref"] == "soldier"
        assert data["species"] == {"_inline": True, "name": "Hill Dwarf"}
        assert data["subclass"] == "Champion"
        assert "Hill Dwarf" in unmatched
        assert data["alignment"] == "True Neutral"

    def test_features_in_play_only(self, result):
        answer, data, _ = result
        # Not "Hit Points" (builder scaffolding), not Extra Attack (level 5),
        # and not "Second Wind Healing", an action Second Wind already covers.
        names = [entry["name"] for entry in answer["fields"]["features"]]
        assert names == ["Second Wind", "Improved Critical", "Action Surge"]
        assert len(data["features"]) == 3

    def test_gear_carries_its_per_entry_values(self, result):
        _, data, _ = result
        by_name = {(e.get("name") or e.get("_ref")): e for e in data["equipment"]}
        rope = next(e for n, e in by_name.items() if "rope" in str(n).lower())
        assert rope["_per"] == {"qty": 2, "equipped": False}
        assert by_name["Lucky Coin"]["description"] == "From her mother."
        cloak = data["magic_items"][0]
        assert cloak["_per"] == {"attuned": True}
        assert data["shield"] is True
        assert data["attacks"][0] == {
            "name": "Longsword",
            "bonus": "",
            "damage": "1d8 Slashing",
            "notes": "Versatile",
        }
        assert data["spells"][0]["_per"] == {"prepared": True}

    def test_the_rest_of_the_character(self, result):
        answer, data, _ = result
        assert answer["name"] == "Brakka"
        assert "portrait" not in answer
        assert data["xp"] == 900
        assert data["heroic_inspiration"] is True
        assert data["death_success_1"] is True and "death_success_2" not in data
        assert (data["gp"], data["sp"]) == (15, 3)
        assert data["appearance"] == "Gender: She/her; Age: 61; Eyes: Grey"
        assert data["backstory"] == "Born in the hills.\n\nPersonality:\nBlunt.\n\nFlaws:\nStubborn."
        assert data["notes"] == "Allies:\nThe Iron Guild"


class TestDiceCloud:
    @pytest.fixture(scope="class")
    def result(self, admin_id):
        answer = _run("dicecloud-v1", {"document": _fixture("dicecloud_v1_character.json")})
        data, unmatched = _build("dicecloud-v1", answer, admin_id)
        return answer, data, unmatched

    def test_recognises_its_api_json_and_links(self):
        from backend.addons import importer as engine

        spec = _manifest("dicecloud-v1").importer
        assert engine.file_match(spec, "m.json", _fixture("dicecloud_v1_character.json")) > 0
        assert engine.file_match(spec, "b.json", _fixture("dndbeyond_character.json")) == 0
        link = "https://v1.dicecloud.com/character/Hand1Built2Wizard/mirelle"
        assert engine.url_identity(spec, link) == "Hand1Built2Wizard"
        assert [item.key for item in spec.inputs_for("link")] == ["api_key"]
        assert spec.inputs_for("file") == []

    def test_effects_are_worked_out(self, result):
        _, data, _ = result
        # Intelligence 15 + 1; a disabled effect and a hostile calculation count
        # for nothing.
        assert (data["intelligence"], data["wisdom"], data["charisma"]) == (16, 13, 10)
        assert data["level"] == 3

    def test_values_the_sheet_can_work_out_are_left_to_it(self, result):
        _, data, _ = result
        # 17 is exactly the wizard's average, and a human's speed is the SRD's.
        assert "hp_max" not in data
        assert "speed" not in data
        assert not any(key.startswith("slots_") for key in data)
        assert data["hp_current"] == 12
        assert data["hp_temp"] == 2
        # 10 + Dex 2 + this bonus is DiceCloud's 15.
        assert data["armor_bonus"] == 3

    def test_proficiency_strength_is_kept(self, result):
        _, data, _ = result
        assert data["skill_expertise"] == ["Arcana"]
        assert data["skill_profs"] == ["Arcana", "History"]
        assert data["skill_half_profs"] == ["Stealth"]
        assert data["intelligence_save_prof"] is True
        assert data["languages"] == "Common, Draconic"

    def test_picks_spells_and_items(self, result):
        _, data, _ = result
        assert data["klass"]["_ref"] == "wizard"
        assert data["background"]["_ref"] == "sage"
        assert data["alignment"] == "True Neutral"
        prepared = {(e.get("_ref") or e.get("name")): e.get("_per") for e in data["spells"]}
        assert prepared == {"magic-missile": {"prepared": True}, "shield": {"prepared": False}}
        assert data["gp"] == 15
        # Matched against the SRD's magic items, keeping its per-entry value.
        assert data["magic_items"] == [
            {"_ref": "magic-wand-of-magic-missiles", "_source": "srd", "_per": {"attuned": True}}
        ]
        assert data["attacks"][0]["bonus"] == "+4"
        assert data["attacks"][0]["damage"] == "1d4 + 2 piercing"
        assert data["death_failure_1"] is True
        assert data["backstory"] == "Knew too much.\n\nPersonality:\nCurious."
        assert data["notes"] == "Session 1:\nMet the king."


class _Reply(io.BytesIO):
    def __init__(self, text: str):
        super().__init__(text.encode())
        self.headers = None

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def _frame(*messages: dict) -> str:
    return "a" + json.dumps([json.dumps(m) for m in messages]) + "\n"


class TestDiceCloudNetwork:
    """The script's own requests, with DiceCloud replaced by a fake."""

    @pytest.fixture
    def dicecloud(self, monkeypatch):
        module = _load("dicecloud-v1")
        sent: list[str] = []
        polls: list[str] = []

        def urlopen(request, timeout=None):
            url = request.full_url
            sent.append(url)
            if url.endswith("/xhr_send"):
                return _Reply("")
            if url.endswith("/xhr"):
                return _Reply(polls.pop(0) if polls else "h\n")
            raise AssertionError(f"unexpected request {url}")

        monkeypatch.setattr(module.urllib.request, "urlopen", urlopen)
        monkeypatch.setattr(module, "PUBLIC_TIMEOUT", 5)
        return module, sent, polls

    def test_a_public_sheet_is_read_over_sockjs_polling(self, dicecloud):
        module, sent, polls = dicecloud
        polls.extend(
            [
                "o\n",
                _frame({"msg": "connected"}),
                _frame(
                    {"msg": "added", "collection": "characters", "id": "c1", "fields": {"name": "Mirelle"}},
                    {"msg": "added", "collection": "classes", "id": "k1", "fields": {"name": "Wizard", "level": 2}},
                    {"msg": "ready", "subs": ["char"]},
                ),
            ]
        )
        data = module.fetch_public("Hand1Built2Wizard")
        assert data["characters"] == [{"_id": "c1", "name": "Mirelle"}]
        assert all(url.startswith("https://v1.dicecloud.com/sockjs/") for url in sent)

    def test_a_private_sheet_asks_for_the_key(self, dicecloud):
        module, _, polls = dicecloud
        polls.extend(["o\n", _frame({"msg": "connected"}), _frame({"msg": "nosub", "id": "char"})])
        with pytest.raises(module.ImportFailed) as caught:
            module.fetch_public("Hand1Built2Wizard")
        assert caught.value.needs_input == ["api_key"]

    def test_a_rejected_key_is_never_repeated(self, monkeypatch):
        module = _load("dicecloud-v1")

        def refuse(request, timeout=None):
            assert request.full_url.startswith("https://v1.dicecloud.com/character/Hand1Built2Wizard/json?")
            raise urllib.error.HTTPError(request.full_url, 403, "Forbidden", {}, None)

        monkeypatch.setattr(module.urllib.request, "urlopen", refuse)
        with pytest.raises(module.ImportFailed) as caught:
            module.fetch_with_key("Hand1Built2Wizard", "s3cret-key")
        assert caught.value.needs_input == ["api_key"]
        assert "s3cret-key" not in str(caught.value)

    def test_a_portrait_on_the_servers_own_network_is_refused(self, monkeypatch):
        module = _load("dicecloud-v1")
        monkeypatch.setattr(
            module.socket, "getaddrinfo", lambda *a, **k: [(None, None, None, None, ("10.0.0.5", 443))]
        )
        monkeypatch.setattr(
            module.urllib.request, "urlopen", lambda *a, **k: pytest.fail("fetched a private address")
        )
        assert module.fetch_portrait("https://intranet.example/me.png") is None
        assert module.fetch_portrait("http://example.com/me.png") is None
