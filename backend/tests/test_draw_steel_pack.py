"""The Draw Steel sheet against the Draw Steel: Heroes pack.

A second system's sheet and content, run through the same engine as 5e with no
change to it. Where 5e's tests check the arithmetic of one game, these also
check the engine held up for a game built differently: characteristics that are
bonuses rather than scores, stamina that grows with a kit's echelon bonus, a
heroic resource each class names differently, ancestries bought with points.

Values are worked out by hand from Draw Steel: Heroes. The repository is a
sibling checkout, so the module skips when it is not present.
"""
import json
import os
import re

import pytest

from backend.config import SessionLocal
from backend.services import characters as svc
from backend.services.characters import packs

_REPO = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "community-add-ons")
)
_SHEET = os.path.join(_REPO, "character-sheets", "draw-steel", "draw-steel.json")
_LAYOUT = os.path.join(_REPO, "character-sheets", "draw-steel", "draw-steel.html")
_PACK_DIR = os.path.join(_REPO, "content-packs", "draw-steel-core")

pytestmark = pytest.mark.skipif(
    not (os.path.isfile(_SHEET) and os.path.isdir(_PACK_DIR)),
    reason="the community-add-ons repository is not checked out beside this one",
)


def _rows(content_type: str) -> list[dict]:
    with open(os.path.join(_PACK_DIR, f"{content_type}.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def ds():
    with open(_SHEET, encoding="utf-8") as handle:
        raw = json.load(handle)
    raw.pop("$schema", None)
    document = svc.validate_schema(raw)
    entries = {}
    for type_name, type_definition in document["content_types"].items():
        for row in _rows(type_name):
            entries[row["_id"]] = packs._clean_entry(row, type_definition.get("fields") or {})
    return document, entries


def _computed(ds, **data):
    document, entries = ds
    return svc.compute_values(document, data, entries)


def _context(ds, **data):
    from backend.services.characters.schema import _build_context

    document, entries = ds
    return _build_context(document, data, entries)


class TestThePackFitsTheSheet:
    def test_every_file_is_a_declared_content_type(self, ds):
        document, _ = ds
        files = {
            name.removesuffix(".json")
            for name in os.listdir(_PACK_DIR)
            if name.endswith(".json") and not name.startswith("_")
        }
        assert files == set(document["content_types"])

    @pytest.mark.parametrize(
        "content_type",
        ["class", "subclass", "ancestry", "trait", "kit", "career", "culture", "domain",
         "perk", "title", "complication", "ability", "feature"],
    )
    def test_the_sheet_declares_every_property(self, ds, content_type):
        # The loader drops what a sheet does not declare; nothing here should
        # be silently lost on the way in.
        document, _ = ds
        declared = set(document["content_types"][content_type]["fields"])
        for row in _rows(content_type):
            assert set(row) - {"_id"} <= declared, row["_id"]

    def test_ids_are_unique_across_the_whole_pack(self, ds):
        # A stored reference is the id alone, so an ancestry trait and the
        # ability it grants sharing one id would resolve to either.
        document, _ = ds
        seen: dict = {}
        for type_name in document["content_types"]:
            for row in _rows(type_name):
                assert row["_id"] not in seen, (row["_id"], seen.get(row["_id"]), type_name)
                seen[row["_id"]] = type_name

    def test_loads_through_the_real_loader(self, ds):
        document, _ = ds
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, _PACK_DIR, schema_document=document)
            assert pack.entry_count == sum(
                len(_rows(t)) for t in document["content_types"]
            )
            assert "DRAW STEEL Creator License" in pack.attribution
            # MCDM's text under MCDM's licence; Forge Steel is credited as the
            # source of the conversion, not licensed from.
            assert pack.license == "Draw Steel Creator License"
            assert "Forge Steel" in pack.attribution
        finally:
            db.rollback()
            db.close()

    @pytest.mark.parametrize(
        "field,target_type",
        [("ancestry", "trait"), ("ancestry", "ability"), ("klass", "feature"),
         ("subclass", "feature"), ("kit", "ability")],
    )
    def test_every_grant_names_an_entry_in_the_pack(self, ds, field, target_type):
        document, entries = ds
        target_ids = {row["_id"] for row in _rows(target_type)}
        for rule in document["fields"][field]["on_pick"]:
            if "grant" not in rule:
                continue
            target = document["fields"][rule["grant"]]
            if target["content_type"] != target_type:
                continue
            for picked in _rows(document["fields"][field]["content_type"]):
                ids = [i.strip() for i in picked[rule["from"]].split(",") if i.strip()]
                names = [n.strip() for n in picked[rule["names"]].split(",") if n.strip()]
                # Names are the fallback without the pack, so they line up.
                assert len(ids) == len(names), picked["_id"]
                for entry_id, name in zip(ids, names):
                    assert entry_id in target_ids, entry_id
                    assert entries[entry_id]["name"].replace(",", "") == name

    @pytest.mark.parametrize("field", ["klass", "culture", "career"])
    def test_every_skill_choice_offers_real_skills(self, ds, field):
        document, _ = ds
        skills = set(document["fields"]["skills"]["options"])
        for rule in document["fields"][field]["on_pick"]:
            if "choose" not in rule:
                continue
            for picked in _rows(document["fields"][field]["content_type"]):
                assert set(picked[rule["from"]]) <= skills, picked["_id"]

    def test_the_sheet_keeps_the_hero_name_in_its_name_field(self, ds):
        document, _ = ds
        assert document["name_field"] == "hero_name"

    def test_every_value_has_a_place_on_the_layout(self, ds):
        with open(_LAYOUT, encoding="utf-8") as handle:
            html = handle.read()
        placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
        document, _ = ds
        assert set(document["fields"]) - placed == set()
        assert set(document["computed"]) - placed == set()


class TestDrawSteelDerivesFromChoices:
    def test_stamina_follows_class_level_and_kit(self, ds):
        # Fury: 21, +9 a level. Mountain kit: +9 per echelon. Level 4 is
        # echelon 2, so 21 + 27 + 18.
        context = _context(ds, klass={"_ref": "fury"}, kit={"_ref": "mountain"}, level=4)
        assert context["stamina_max"] == 66

    @pytest.mark.parametrize("level,echelon", [(1, 1), (3, 1), (4, 2), (7, 3), (10, 4)])
    def test_echelon(self, ds, level, echelon):
        assert _computed(ds, level=level)["echelon"] == echelon

    def test_current_stamina_follows_the_maximum_until_it_is_set(self, ds):
        assert _context(ds, klass={"_ref": "censor"})["stamina_current"] == 21
        assert _context(ds, klass={"_ref": "censor"}, stamina_current=4)["stamina_current"] == 4

    def test_winded_and_recovery_come_from_the_maximum(self, ds):
        computed = _computed(ds, klass={"_ref": "censor"})
        assert computed["winded"] == 10
        assert computed["recovery_value"] == 7
        assert computed["dying_at"] == -10

    def test_recoveries_and_resource_come_from_the_class(self, ds):
        context = _context(ds, klass={"_ref": "censor"})
        assert context["recoveries_max"] == 12
        assert context["resource_name"] == "Wrath"

    def test_primary_characteristics_start_at_two(self, ds):
        context = _context(ds, klass={"_ref": "tactician"})
        assert (context["might"], context["reason"], context["agility"]) == (2, 2, 0)

    def test_a_characteristic_the_player_sets_wins(self, ds):
        assert _context(ds, klass={"_ref": "tactician"}, might=-1)["might"] == -1

    def test_ancestry_sets_size_and_kit_adds_speed_and_stability(self, ds):
        context = _context(ds, ancestry={"_ref": "polder"}, kit={"_ref": "mountain"})
        assert context["size"] == "1S"
        assert context["speed"] == 5
        assert context["stability"] == 2
        context = _context(ds, kit={"_ref": "martial-artist"})
        assert context["speed"] == 8

    def test_kit_bonuses_fill_in(self, ds):
        context = _context(ds, kit={"_ref": "guisarmier"})
        assert context["melee_damage_bonus"] == "+2/+2/+2"
        assert context["melee_distance_bonus"] == 1
        assert context["disengage"] == 1

    def test_potency_follows_the_highest_characteristic(self, ds):
        computed = _computed(ds, might=2, agility=3, reason=-1, intuition=0, presence=1)
        assert (computed["potency_weak"], computed["potency_average"],
                computed["potency_strong"]) == (1, 2, 3)

    def test_with_nothing_picked_everything_is_plain(self, ds):
        context = _context(ds)
        assert context["stamina_max"] == 20
        assert context["speed"] == 5
        assert context["size"] == "1M"
        assert context["might"] == 0

    def test_any_calculated_value_can_be_set(self, ds):
        computed = _computed(ds, klass={"_ref": "censor"}, _overrides={"winded": 12})
        assert computed["winded"] == 12


class TestDrawSteelWarnings:
    def _warnings(self, ds, **data):
        document, entries = ds
        return [w["message"] for w in svc.run_validators(document, data, entries)]

    def test_traits_within_the_ancestry_points_pass(self, ds):
        traits = [{"_ref": "dwarf-great-fortitude"}, {"_ref": "dwarf-grounded"}]
        assert not self._warnings(ds, ancestry={"_ref": "dwarf"}, ancestry_traits=traits)

    def test_overspent_ancestry_points_warn(self, ds):
        traits = [{"_ref": "dwarf-great-fortitude"}, {"_ref": "dwarf-spark-off-your-skin"}]
        warnings = self._warnings(ds, ancestry={"_ref": "dwarf"}, ancestry_traits=traits)
        assert any("ancestry points" in w for w in warnings)

    def test_custom_traits_are_never_judged(self, ds):
        # No ancestry picked: a homebrew hero is the player's business.
        traits = [{"_inline": True, "name": "Wings", "cost": 9}]
        assert not self._warnings(ds, ancestry_traits=traits)

    def test_dead_is_flagged(self, ds):
        warnings = self._warnings(ds, klass={"_ref": "censor"}, stamina_current=-10)
        assert any("dead" in w for w in warnings)

    def test_a_fourth_leveled_treasure_warns(self, ds):
        three = [{"name": f"Treasure {n}"} for n in range(3)]
        assert not any("three" in w for w in self._warnings(ds, leveled_treasures=three))
        four = three + [{"name": "One too many"}]
        assert any("three" in w for w in self._warnings(ds, leveled_treasures=four))


class TestDrawSteelKitModifiers:
    """The printed sheet's Equipment and Modifiers box: the kit's own bonuses,
    filled in from the kit and editable, feeding the totals."""

    def test_the_kit_fills_its_boxes(self, ds):
        context = _context(ds, kit={"_ref": "mountain"})
        assert context["kit_speed"] == 0
        assert context["kit_stability"] == 2
        assert context["kit_weapon"]

    def test_an_edited_kit_bonus_reaches_the_total(self, ds):
        context = _context(ds, kit={"_ref": "martial-artist"}, kit_speed=1)
        assert context["speed"] == 6
        context = _context(ds, klass={"_ref": "fury"}, kit={"_ref": "mountain"}, level=4,
                           kit_stamina=0)
        # The fury's 21 + 9 per level after the first, and no kit stamina.
        assert context["stamina_max"] == 48

    def test_surge_damage_is_the_highest_characteristic(self, ds):
        assert _computed(ds, might=2, agility=3)["surge_damage"] == 3
