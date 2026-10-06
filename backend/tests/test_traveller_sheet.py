"""The Mongoose Traveller 2nd Edition sheet on the unchanged engine.

The largest sheet yet, and a game built differently again: characteristics are
2D6 scores whose dice modifier is what the rules use, a skill has specialities
that a trained parent opens up at 0, and an untrained skill takes a penalty that
Jack-of-All-Trades reduces. Every skill shows its check DM against each of six
characteristics - about a thousand computed values - which is the sheet the
engine's size bounds are measured against.

Values are worked out by hand from the rules and the spreadsheet the sheet
follows. The repository is a sibling checkout, so the module skips when it is
not present.
"""
import json
import os
import re

import pytest

from backend.services import characters as svc

_DIR = os.path.abspath(os.path.join(
    os.path.dirname(__file__), "..", "..", "..", "community-add-ons", "character-sheets",
    "traveller-2e",
))
_SHEET = os.path.join(_DIR, "traveller-2e.json")
_LAYOUT = os.path.join(_DIR, "traveller-2e.html")
_STYLES = os.path.join(_DIR, "traveller-2e.css")

pytestmark = pytest.mark.skipif(
    not os.path.isfile(_SHEET),
    reason="the community-add-ons repository is not checked out beside this one",
)

BASE = {"str_base": 9, "dex_base": 10, "end_base": 8, "int_base": 11, "edu_base": 12,
        "soc_base": 5}


@pytest.fixture(scope="module")
def trav():
    with open(_SHEET, encoding="utf-8") as handle:
        raw = json.load(handle)
    raw.pop("$schema", None)
    for pointer, key, path in (("layout_file", "layout_html", _LAYOUT),
                               ("styles_file", "styles", _STYLES)):
        raw.pop(pointer, None)
        with open(path, encoding="utf-8") as handle:
            raw[key] = handle.read()
    return svc.validate_schema(raw, scope="gc-test")


def _computed(trav, **data):
    return svc.compute_values(trav, {**BASE, **data})


def _warnings(trav, **data):
    return [w["message"] for w in svc.run_validators(trav, {**BASE, **data})]


class TestTheSheet:
    def test_keeps_the_traveller_name_in_its_name_field(self, trav):
        assert trav["name_field"] == "hero_name"

    def test_carries_mongooses_fair_use_notice(self, trav):
        assert "owned by Mongoose Publishing" in trav["attribution"]
        assert "provided it contains this notice" in trav["attribution"]

    def test_every_value_has_a_place_on_the_layout(self, trav):
        with open(_LAYOUT, encoding="utf-8") as handle:
            html = handle.read()
        placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
        assert set(trav["fields"]) - placed == set()
        assert set(trav["computed"]) - placed == set()

    def test_a_new_traveller_renders(self, trav):
        computed = svc.compute_values(trav, {})
        assert computed["upp"] == "777777"
        assert computed["unskilled"] == -3
        assert computed["sk_admin_total"] == -3
        assert computed["wpn_1_attack"] == "--"


class TestCharacteristics:
    @pytest.mark.parametrize(
        "score, dm",
        [(0, -3), (1, -2), (2, -2), (3, -1), (5, -1), (6, 0), (8, 0), (9, 1), (11, 1),
         (12, 2), (14, 2), (15, 3), (18, 3)],
    )
    def test_the_dice_modifier_table(self, trav, score, dm):
        assert _computed(trav, str_base=score)["str_dm"] == dm

    def test_misc_adds_and_injury_takes_away(self, trav):
        computed = _computed(trav, str_base=9, str_misc=1, str_injury=4)
        assert computed["strength"] == 6
        assert computed["str_dm"] == 0

    def test_the_upp_is_written_in_hex(self, trav):
        assert _computed(trav)["upp"] == "9A8BC5"

    def test_psi_joins_the_upp_once_the_traveller_has_it(self, trav):
        assert _computed(trav, psi_base=9)["upp"] == "9A8BC59"


class TestSkills:
    def test_an_untrained_skill_takes_the_unskilled_penalty(self, trav):
        assert _computed(trav)["sk_admin_total"] == -3

    def test_jack_of_all_trades_reduces_it(self, trav):
        assert _computed(trav, sk_jack_of_all_trades="2")["sk_admin_total"] == -1

    def test_a_trained_speciality_opens_the_rest_at_zero(self, trav):
        computed = _computed(trav, sk_animals_handling="1")
        assert computed["sk_animals_handling_total"] == 1
        assert computed["sk_animals_training_total"] == 0
        assert computed["sk_animals_total"] == 0
        # Another skill is unaffected.
        assert computed["sk_art_total"] == -3

    def test_profession_does_not_open_its_specialities(self, trav):
        computed = _computed(trav, sk_profession="0")
        assert computed["sk_profession_total"] == 0
        assert computed["sk_profession_1_total"] == -3

    def test_each_check_adds_a_characteristic_dm(self, trav):
        computed = _computed(trav, sk_admin="2", sk_admin_misc=1)
        # 2 + 1, then INT 11 (+1) and SOC 5 (-1).
        assert computed["sk_admin_total"] == 3
        assert computed["sk_admin_int"] == "+4"
        assert computed["sk_admin_soc"] == "+2"

    def test_skill_levels_are_counted_against_edu_and_int(self, trav):
        computed = _computed(trav, sk_admin="2", sk_gun_combat="0", sk_gun_combat_slug="3")
        assert computed["skill_levels"] == 5
        assert computed["skill_levels_max"] == 3 * (12 + 11)
        assert not any("skill levels" in w for w in _warnings(trav, sk_admin="2"))
        too_many = {f"sk_science_{k}": "8" for k in ("archaeology", "astronomy", "biology",
                                                       "chemistry", "cosmology", "cybernetics",
                                                       "economics", "genetics", "history")}
        assert any("skill levels" in w for w in _warnings(trav, **too_many))

    def test_psionic_talents_check_against_psi(self, trav):
        computed = _computed(trav, psi_base=9, psi_telepathy="1")
        assert computed["psi_telepathy_check"] == "+2"
        assert computed["psi_awareness_check"] == "--"


class TestCombatAndGear:
    def test_a_gun_attacks_with_its_skill_and_dex(self, trav):
        computed = _computed(trav, sk_gun_combat_slug="2", wpn_1_skill="Gun Combat (Slug)")
        assert computed["wpn_1_attack"] == "+3"

    def test_melee_uses_the_better_of_str_and_dex(self, trav):
        computed = _computed(trav, str_base=12, wpn_2_skill="Melee (Blade)")
        # Untrained -3, plus STR 12 (+2) over DEX 10 (+1).
        assert computed["wpn_2_attack"] == "-1"

    def test_initiative_and_dodge(self, trav):
        computed = _computed(trav, int_base=12, sk_athletics_dexterity="2")
        assert computed["initiative_dm"] == "+2"
        assert computed["dodge_penalty"] == 2

    def test_worn_armour_adds_up(self, trav):
        armour = [{"worn": True, "protection": 5}, {"worn": False, "protection": 8}]
        assert _computed(trav, armour=armour, subdermal=2)["armour_total"] == 7

    def test_encumbrance_counts_quantity(self, trav):
        gear = [{"qty": 2, "mass": 3}, {"qty": None, "mass": 5}]
        computed = _computed(trav, gear=gear, sk_athletics_strength="1")
        assert computed["carried"] == 11
        # STR 9 + END 8 + Athletics (Strength) 1.
        assert computed["encumbrance_threshold"] == 18
        assert computed["encumbrance"] == "Okay"
        heavy = _computed(trav, gear=[{"qty": 1, "mass": 30}])
        assert heavy["encumbrance"] == "Encumbered"
        assert any("twice" in w for w in _warnings(trav, gear=[{"qty": 1, "mass": 40}]))

    @pytest.mark.parametrize(
        "soc, standard",
        [(1, "Very Poor"), (4, "Poor"), (7, "Good"), (9, "High"), (13, "Rich"),
         (15, "Ludicrously Rich")],
    )
    def test_standard_of_living_follows_soc(self, trav, soc, standard):
        assert _computed(trav, soc_base=soc)["standard_for_soc"] == standard

    def test_the_chosen_standard_sets_the_monthly_cost(self, trav):
        computed = _computed(trav, standard_chosen="Very High", mortgages=[{"payment": 300}])
        assert computed["living_cost"] == 2500
        assert computed["monthly_outgoings"] == 2800


class TestVehiclesAndShips:
    def test_a_vehicle_check_adds_skill_dex_and_agility(self, trav):
        computed = _computed(trav, v1_skill="Flyer (Grav)", sk_flyer_grav="2", v1_agility=1)
        assert computed["v1_check"] == "+4"

    def test_cruising_is_one_speed_band_slower_and_half_as_far_again(self, trav):
        computed = _computed(trav, v1_max_speed="Fast", v1_max_range=400)
        assert computed["v1_cruise_speed"] == "High"
        assert computed["v1_cruise_range"] == 600

    def test_drives_draw_power_for_their_tonnage(self, trav):
        computed = _computed(trav, ship_hull_tons=200, ship_thrust="2", ship_jump="3")
        assert computed["ship_power_basic_required"] == 40
        assert computed["ship_power_m_drive_required"] == 40
        assert computed["ship_power_j_drive_required"] == 60

    def test_thrust_zero_still_draws_a_quarter(self, trav):
        computed = _computed(trav, ship_hull_tons=100, ship_thrust="0")
        assert computed["ship_power_m_drive_required"] == 2.5

    def test_overloaded_holds_warn(self, trav):
        assert any("hold" in w for w in _warnings(
            trav, ship_cargo_tons=10, ship_stored=[{"qty": 3, "mass": 4}]))
        assert any("Vehicle 1" in w for w in _warnings(
            trav, v1_cargo=1, v1_stored=[{"qty": 1, "mass": 2}]))

    def test_radiation_takes_endurance_permanently(self, trav):
        assert _computed(trav, radiation=100)["radiation_effect"] == "None"
        assert _computed(trav, radiation=420)["radiation_effect"] == "-2 END permanently"
