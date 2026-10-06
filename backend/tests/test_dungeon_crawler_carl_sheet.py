"""The Dungeon Crawler Carl sheet: structure only, and the sums the printed sheet shows.

There is no fan content policy for the game, so the sheet carries no rules - only
the totals its printed sheet writes out. The repository is a sibling checkout, so
the module skips when it is not present.
"""
import json
import os
import re

import pytest

from backend.services import characters as svc
from backend.services.characters.schema import _build_context

_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "community-add-ons", "character-sheets", "dungeon-crawler-carl",
))
_SHEET = os.path.join(_DIR, "dungeon-crawler-carl.json")
_LAYOUT = os.path.join(_DIR, "dungeon-crawler-carl.html")
_STYLES = os.path.join(_DIR, "dungeon-crawler-carl.css")

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


def test_carries_no_licence_it_does_not_have(sheet):
    assert not sheet.get("license")


def test_the_printed_sums(sheet):
    computed = _computed(sheet, dex_mod=3, evade_buffs=2, armor=4, dr_buffs=1, health=7,
                         attack_1_name="Punch", attack_1_rank=2, attack_1_hit_mod=3)
    assert computed["evade_total"] == 5
    assert computed["dr_total"] == 5
    assert computed["health_pct"] == "70%"
    assert computed["attack_1_to_hit"] == "+5"
    # An empty attack line shows no total.
    assert computed["attack_2_to_hit"] == ""


def test_more_than_ten_accessories_warns(sheet):
    ten = [{"name": str(n)} for n in range(10)]
    assert not _warnings(sheet, accessories=ten)
    assert any("ten" in w for w in _warnings(sheet, accessories=ten + [{"name": "x"}]))
