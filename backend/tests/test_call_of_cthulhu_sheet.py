"""The Call of Cthulhu 7th Edition sheet on the unchanged engine.

A fourth system, and the first with no content pack at all: Chaosium publishes
no open licence, so the sheet ships alone and a table adds its own occupations
and weapons. It is the no-content path the builder promises - every value a
plain field, every derived one worked out from the characteristics - on a
percentile game, with half and fifth values, a damage bonus table and skill
points spent against two pools.

Values are worked out by hand from the 7th edition rules. The repository is a
sibling checkout, so the module skips when it is not present.
"""
import json
import os
import re

import pytest

from backend.services import characters as svc

_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "community-add-ons", "character-sheets",
    "call-of-cthulhu-7e",
))
_SHEET = os.path.join(_DIR, "call-of-cthulhu-7e.json")
_LAYOUT = os.path.join(_DIR, "call-of-cthulhu-7e.html")

pytestmark = pytest.mark.skipif(
    not os.path.isfile(_SHEET),
    reason="the community-add-ons repository is not checked out beside this one",
)

BASE = {"strength": 50, "constitution": 50, "size": 50, "dexterity": 50, "appearance": 50,
        "intelligence": 50, "power": 50, "education": 50, "age": 25}


@pytest.fixture(scope="module")
def coc():
    with open(_SHEET, encoding="utf-8") as handle:
        raw = json.load(handle)
    raw.pop("$schema", None)
    return svc.validate_schema(raw)


def _computed(coc, **data):
    return svc.compute_values(coc, {**BASE, **data})


def _context(coc, **data):
    from backend.services.characters.schema import _build_context

    return _build_context(coc, {**BASE, **data})


def _warnings(coc, **data):
    return [w["message"] for w in svc.run_validators(coc, {**BASE, **data})]


class TestTheSheet:
    def test_keeps_the_investigator_name_in_its_name_field(self, coc):
        assert coc["name_field"] == "investigator_name"

    def test_carries_chaosiums_fan_material_notice(self, coc):
        # No open licence exists for Call of Cthulhu; the Fan Material Policy
        # permits character sheets and requires this notice word for word.
        assert "used under Chaosium Inc's Fan Material Policy" in coc["attribution"]
        assert "not published, endorsed, or specifically approved by Chaosium" in coc["attribution"]

    def test_every_value_has_a_place_on_the_layout(self, coc):
        with open(_LAYOUT, encoding="utf-8") as handle:
            html = handle.read()
        placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
        assert set(coc["fields"]) - placed == set()
        assert set(coc["computed"]) - placed == set()

    def test_every_skill_has_a_line_and_an_improvement_box(self, coc):
        with open(_LAYOUT, encoding="utf-8") as handle:
            html = handle.read()
        for skill in coc["fields"]["occupation_skills"]["options"]:
            assert f'field="improvement_checks" value="{skill}"' in html, skill


class TestDerivedValues:
    @pytest.mark.parametrize(
        "strength,size,bonus,build",
        [(30, 30, "-2", -2), (40, 40, "-1", -1), (60, 60, "None", 0), (60, 65, "+1D4", 1),
         (90, 90, "+1D6", 2), (125, 125, "+2D6", 3), (150, 150, "+3D6", 4)],
    )
    def test_damage_bonus_and_build_follow_strength_plus_size(self, coc, strength, size, bonus,
                                                              build):
        computed = _computed(coc, strength=strength, size=size)
        assert (computed["damage_bonus"], computed["build"]) == (bonus, build)

    @pytest.mark.parametrize(
        "dexterity,strength,size,age,move",
        [(40, 40, 50, 25, 7), (60, 40, 50, 25, 8), (50, 50, 50, 25, 8), (70, 60, 50, 25, 9),
         (70, 60, 50, 45, 8), (70, 60, 50, 85, 4)],
    )
    def test_move_rate_compares_dex_and_str_with_siz_and_slows_with_age(
            self, coc, dexterity, strength, size, age, move):
        computed = _computed(coc, dexterity=dexterity, strength=strength, size=size, age=age)
        assert computed["move"] == move

    def test_hit_points_magic_points_and_sanity_come_from_characteristics(self, coc):
        context = _context(coc, constitution=50, size=60, power=65)
        assert (context["hp_max"], context["mp_max"], context["sanity_start"]) == (11, 13, 65)
        # And the current pools start full.
        assert (context["hp_current"], context["mp_current"], context["sanity_current"]) == (
            11, 13, 65)

    def test_maximum_sanity_falls_as_cthulhu_mythos_rises(self, coc):
        assert _computed(coc, sk_cthulhu_mythos=10)["sanity_max"] == 89

    def test_half_and_fifth(self, coc):
        computed = _computed(coc, strength=55, sk_spot_hidden=63)
        assert (computed["strength_half"], computed["strength_fifth"]) == (27, 11)
        assert (computed["sk_spot_hidden_half"], computed["sk_spot_hidden_fifth"]) == (31, 12)

    def test_dodge_and_own_language_start_from_characteristics(self, coc):
        context = _context(coc, dexterity=60, education=75)
        assert (context["sk_dodge"], context["sk_language_own"]) == (30, 75)

    def test_any_derived_value_can_be_set(self, coc):
        assert _context(coc, hp_max=15)["hp_max"] == 15
        assert _computed(coc, _overrides={"damage_bonus": "+1D6"})["damage_bonus"] == "+1D6"


class TestSkillPoints:
    def test_occupation_points_default_to_edu_times_four(self, coc):
        assert _context(coc, education=70)["occupation_points"] == 280

    def test_points_above_base_split_between_occupation_and_personal(self, coc):
        computed = _computed(
            coc, occupation_skills=["Library Use"],
            sk_library_use=60,     # occupation: 40 above its base of 20
            sk_credit_rating=30,   # always bought with occupation points: 30
            sk_stealth=40,         # personal interest: 20 above its base of 20
        )
        assert computed["occupation_points_spent"] == 70
        assert computed["personal_points_spent"] == 20
        assert computed["personal_points"] == 100

    def test_a_specialisation_counts_against_its_own_base(self, coc):
        computed = _computed(coc, art_craft_1_name="Photography", art_craft_1=45,
                             art_craft_1_occ=True)
        assert computed["occupation_points_spent"] == 40

    def test_cthulhu_mythos_is_never_bought(self, coc):
        computed = _computed(coc, sk_cthulhu_mythos=15)
        assert computed["occupation_points_spent"] == computed["personal_points_spent"] == 0

    def test_overspending_warns_until_creation_is_finished(self, coc):
        data = {"sk_stealth": 90, "intelligence": 30}  # 70 spent against 60
        assert any("personal interest" in w for w in _warnings(coc, **data))
        assert not _warnings(coc, **data, creation_done=True)

    def test_a_new_investigator_has_nothing_to_warn_about(self, coc):
        assert _warnings(coc) == []
