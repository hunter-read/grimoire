"""The Pathfinder first edition sheet on the unchanged engine.

Values are worked out by hand from the Pathfinder Roleplaying Game Core Rulebook
(Open Game Content). The repository is a sibling checkout, so the module skips
when it is not present.
"""
import json
import os
import re

import pytest

from backend.services import characters as svc
from backend.services.characters.schema import _build_context

_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "community-add-ons", "character-sheets", "pathfinder-1e",
))
_SHEET = os.path.join(_DIR, "pathfinder-1e.json")
_LAYOUT = os.path.join(_DIR, "pathfinder-1e.html")
_STYLES = os.path.join(_DIR, "pathfinder-1e.css")

pytestmark = pytest.mark.skipif(
    not os.path.isfile(_SHEET),
    reason="the community-add-ons repository is not checked out beside this one",
)


@pytest.fixture(scope="module")
def sheet():
    with open(_SHEET, encoding="utf-8") as handle:
        raw = json.load(handle)
    raw.pop("$schema", None)
    for pointer, key, path in (("layout_file", "layout_html", _LAYOUT),
                               ("styles_file", "styles", _STYLES)):
        raw.pop(pointer, None)
        with open(path, encoding="utf-8") as handle:
            raw[key] = handle.read()
    return svc.validate_schema(raw, scope="gc-test")


def _computed(sheet, **data):
    return svc.compute_values(sheet, data)


def _context(sheet, **data):
    return _build_context(sheet, data)


def _warnings(sheet, **data):
    return [w["message"] for w in svc.run_validators(sheet, data)]


def test_every_value_has_a_place_on_the_layout(sheet):
    with open(_LAYOUT, encoding="utf-8") as handle:
        html = handle.read()
    placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
    assert set(sheet["fields"]) - placed == set()
    assert set(sheet["computed"]) - placed == set()


def test_keeps_the_name_in_its_name_field(sheet):
    assert sheet["name_field"] == "hero_name"


def test_carries_paizos_notice_and_the_ogl(sheet):
    assert "Paizo's Community Use Policy" in sheet["attribution"]
    assert sheet["license"] == "OGL-1.0a"
    readme = os.path.join(_DIR, "README.md")
    with open(readme, encoding="utf-8") as handle:
        assert "10. Copy of this License" in handle.read()


# A Small fighter: STR 18, DEX 14, BAB +6, a chain shirt (+4, -2) and a buckler (+1, -1).
FIGHTER = {
    "str": 18, "dex": 14, "int": 16, "size": "Small", "bab": 6, "fort_base": 5, "con": 12,
    "ac_items": [
        {"item": "Chain shirt", "bonus": 4, "type": "Armor", "check_penalty": -2, "weight": 25},
        {"item": "Buckler", "bonus": 1, "type": "Shield", "check_penalty": -1, "weight": 5},
    ],
    "class_skills": ["Acrobatics", "Stealth", "Knowledge (arcana)"],
    "sk_acrobatics_ranks": 3, "sk_stealth_ranks": 2, "sk_knowledge_arcana_ranks": 1,
    "casting_ability": "int",
}


class TestDefenseAndOffense:
    def test_armor_class(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        # 10 + armor 4 + shield 1 + Dex 2 + size 1.
        assert (computed["ac"], computed["touch"], computed["flat_footed"]) == (18, 13, 16)

    def test_combat_maneuvers_take_the_reverse_size_modifier(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        assert computed["cmb"] == 9   # 6 + 4 - 1
        assert computed["cmd"] == 21  # 10 + 6 + 4 + 2 - 1

    def test_saves_and_attacks(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        assert computed["fort"] == 6
        assert (computed["melee_attack"], computed["ranged_attack"]) == ("+11", "+9")
        assert computed["bab_iterative"] == "+6/+1"

    def test_a_temporary_adjustment_reaches_derived_values(self, sheet):
        assert _computed(sheet, dex=14, dex_temp=4)["initiative"] == 4


class TestSkills:
    def test_class_skill_bonus_and_armor_check_penalty(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        assert computed["sk_acrobatics"] == "+5"  # 2 + 3 ranks + 3 class - 3 ACP
        assert computed["sk_climb"] == "+1"       # 4 - 3 ACP
        assert computed["sk_knowledge_arcana"] == "+7"

    def test_size_applies_to_stealth_and_fly(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        assert computed["sk_stealth"] == "+8"  # 2 + 2 + 3 - 3 + 4 for Small
        assert computed["sk_fly"] == "+1"      # 2 - 3 + 2 for Small

    def test_trained_only_without_ranks_cannot_be_used(self, sheet):
        assert _computed(sheet, **FIGHTER)["sk_knowledge_history"] == "—"


class TestCarryingAndSpells:
    @pytest.mark.parametrize("score, heavy", [(1, 10), (10, 100), (11, 115), (18, 300),
                                              (29, 1400), (30, 1600), (35, 3200)])
    def test_heavy_load(self, sheet, score, heavy):
        assert _computed(sheet, str=score)["heavy_load"] == heavy

    def test_loads_and_load_level(self, sheet):
        computed = _computed(sheet, str=10, gear=[{"qty": 2, "weight": 20}])
        assert (computed["light_load"], computed["medium_load"]) == (33, 66)
        assert computed["load"] == "Medium"

    def test_spell_save_dc_and_bonus_spells(self, sheet):
        computed = _computed(sheet, **FIGHTER)
        assert computed["spell_dc_3"] == 16  # 10 + 3 + Int 3
        assert (computed["bonus_spells_1"], computed["bonus_spells_3"],
                computed["bonus_spells_4"]) == (1, 1, 0)
