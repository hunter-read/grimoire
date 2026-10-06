"""The Cosmere RPG sheet (Mistborn campaign setting) on the unchanged engine.

Values are worked out by hand from Brotherwise's Mistborn starter rules and the
advancement table. The repository is a sibling checkout, so the module skips
when it is not present.
"""
import json
import os
import re

import pytest

from backend.services import characters as svc
from backend.services.characters.schema import _build_context

_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "community-add-ons", "character-sheets", "cosmere-rpg",
))
_SHEET = os.path.join(_DIR, "cosmere-rpg.json")
_LAYOUT = os.path.join(_DIR, "cosmere-rpg.html")
_STYLES = os.path.join(_DIR, "cosmere-rpg.css")

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


def test_carries_the_fan_content_statement(sheet):
    assert sheet["attribution"].startswith("This is unofficial fan content")


class TestAttributes:
    def test_defenses_are_ten_plus_the_pair(self, sheet):
        computed = _computed(sheet, strength=3, speed=1, intellect=2, willpower=4,
                             awareness=0, presence=5)
        assert (computed["physical_defense"], computed["cognitive_defense"],
                computed["spiritual_defense"]) == (14, 16, 15)

    @pytest.mark.parametrize(
        "level, health",
        # 10 + STR 3; +5 a level to 5; +4 + STR at 6; +4 to 10; +3 + STR at 11;
        # +3 to 15; +2 + STR at 16; +2 to 20; +1 at 21.
        [(1, 13), (5, 33), (6, 40), (10, 56), (11, 62), (15, 74), (16, 79), (20, 87), (21, 88)],
    )
    def test_health_follows_the_advancement_table(self, sheet, level, health):
        assert _context(sheet, level=level, strength=3)["health_max"] == health

    def test_focus_and_investiture(self, sheet):
        context = _context(sheet, willpower=3, awareness=2, presence=4)
        assert context["focus_max"] == 5
        assert context["investiture_max"] == 0
        assert _context(sheet, invested=True, awareness=2, presence=4)["investiture_max"] == 6

    @pytest.mark.parametrize(
        "score, lift, move, die, senses",
        [(0, "100 lb", "20 ft", "d4", "5 ft"), (2, "200 lb", "25 ft", "d6", "10 ft"),
         (3, "500 lb", "30 ft", "d8", "20 ft"), (9, "10,000 lb", "80 ft", "d20",
                                                 "Unaffected by obscured senses")],
    )
    def test_derived_statistics_step_every_two_points(self, sheet, score, lift, move, die, senses):
        computed = _computed(sheet, strength=score, speed=score, willpower=score, awareness=score)
        assert (computed["lifting_capacity"], computed["movement"], computed["recovery_die"],
                computed["senses_range"]) == (lift, move, die, senses)


class TestSkills:
    def test_modifier_is_attribute_plus_ranks(self, sheet):
        computed = _computed(sheet, speed=3, sk_agility=2, presence=2,
                             sk_custom_1_attr="PRE", sk_custom_1=1)
        assert computed["sk_agility_mod"] == 5
        assert computed["sk_custom_1_mod"] == 3

    def test_too_many_ranks_for_the_tier_warns(self, sheet):
        assert not any("tier" in w for w in _warnings(sheet, sk_agility=2))
        assert any("tier" in w for w in _warnings(sheet, sk_agility=3))
        assert not any("tier" in w for w in _warnings(sheet, level=6, sk_agility=3))

    def test_points_and_ranks_are_counted(self, sheet):
        computed = _computed(sheet, level=3, sk_lore=2, sk_stealth=2, sk_insight=1)
        assert computed["attribute_points"] == 13
        assert computed["skill_ranks"] == 8
        assert computed["skill_ranks_spent"] == 5
