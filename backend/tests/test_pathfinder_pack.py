"""The Pathfinder 2e sheet against the Pathfinder Player Core pack.

A third system through the unchanged engine. Pathfinder is shaped differently
again: attributes are modifiers, a proficiency is one of five ranks that adds
your level only once trained, a skill has four rungs rather than 5e's two, and
hit points come from ancestry and class together.

Values are worked out by hand from Pathfinder Player Core. The repository is a
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
_SHEET = os.path.join(_REPO, "character-sheets", "pathfinder-2e", "pathfinder-2e.json")
_LAYOUT = os.path.join(_REPO, "character-sheets", "pathfinder-2e", "pathfinder-2e.html")
_PACK_DIR = os.path.join(_REPO, "content-packs", "pf2e-player-core")

pytestmark = pytest.mark.skipif(
    not (os.path.isfile(_SHEET) and os.path.isdir(_PACK_DIR)),
    reason="the community-add-ons repository is not checked out beside this one",
)

TYPES = ["ancestry", "heritage", "background", "class", "feature", "feat", "spell"]


def _rows(content_type: str) -> list[dict]:
    with open(os.path.join(_PACK_DIR, f"{content_type}.json"), encoding="utf-8") as handle:
        return json.load(handle)


@pytest.fixture(scope="module")
def pf():
    with open(_SHEET, encoding="utf-8") as handle:
        raw = json.load(handle)
    raw.pop("$schema", None)
    document = svc.validate_schema(raw)
    entries = {}
    for type_name, type_definition in document["content_types"].items():
        for row in _rows(type_name):
            entries[row["_id"]] = packs._clean_entry(row, type_definition.get("fields") or {})
    return document, entries


def _computed(pf, **data):
    document, entries = pf
    return svc.compute_values(document, data, entries)


def _context(pf, **data):
    from backend.services.characters.schema import _build_context

    document, entries = pf
    return _build_context(document, data, entries)


class TestThePackFitsTheSheet:
    def test_every_file_is_a_declared_content_type(self, pf):
        document, _ = pf
        files = {
            name.removesuffix(".json")
            for name in os.listdir(_PACK_DIR)
            if name.endswith(".json") and not name.startswith("_")
        }
        assert files == set(document["content_types"]) == set(TYPES)

    @pytest.mark.parametrize("content_type", TYPES)
    def test_the_sheet_declares_every_property(self, pf, content_type):
        document, _ = pf
        declared = set(document["content_types"][content_type]["fields"])
        for row in _rows(content_type):
            assert set(row) - {"_id"} <= declared, row["_id"]

    def test_ids_are_unique_across_the_whole_pack(self, pf):
        seen: dict = {}
        for type_name in TYPES:
            for row in _rows(type_name):
                assert row["_id"] not in seen, (row["_id"], seen.get(row["_id"]), type_name)
                seen[row["_id"]] = type_name

    def test_no_foundry_markup_survives(self):
        # Foundry's macros and HTML are converted to plain text on the way in.
        for type_name in TYPES:
            for row in _rows(type_name):
                assert not re.search(r"@\w+\[|\[\[/|<\w", row["description"]), row["_id"]

    def test_carries_rules_text_only(self):
        # Paizo's world is Reserved Material under ORC: no deity, place or
        # plane should reach a table through this pack.
        setting = re.compile(r"\b(Golarion|Inner Sea|Absalom|Pharasma|Sarenrae|Desna|Nethys|"
                             r"First World|Netherworld|Cheliax|Andoran|Pathfinder Society)\b")
        for type_name in TYPES:
            for row in _rows(type_name):
                for value in row.values():
                    if isinstance(value, str):
                        assert not setting.search(value), (row["_id"], value[:80])

    def test_ancestries_and_classes_describe_their_rules_not_their_colour(self):
        dwarf = next(r for r in _rows("ancestry") if r["_id"] == "dwarf")
        assert dwarf["description"].startswith("Hit Points: 10.")
        assert "stoic" not in dwarf["description"]
        wizard = next(r for r in _rows("class") if r["_id"] == "wizard")
        assert wizard["description"].startswith("Key attribute: Intelligence.")

    def test_loads_through_the_real_loader(self, pf):
        document, _ = pf
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, _PACK_DIR, schema_document=document)
            assert pack.entry_count == sum(len(_rows(t)) for t in TYPES)
            assert pack.license == "ORC"
            assert "Pathfinder Player Core © 2023, Paizo Inc." in pack.attribution
        finally:
            db.rollback()
            db.close()

    @pytest.mark.parametrize("field", ["ancestry", "klass"])
    def test_every_feature_grant_names_a_feature_in_the_pack(self, pf, field):
        document, entries = pf
        features = {row["_id"] for row in _rows("feature")}
        rule = next(r for r in document["fields"][field]["on_pick"] if r.get("grant") == "features")
        for picked in _rows(document["fields"][field]["content_type"]):
            ids = [i.strip() for i in picked[rule["from"]].split(",") if i.strip()]
            names = [n.strip() for n in picked[rule["names"]].split(",") if n.strip()]
            assert len(ids) == len(names), picked["_id"]
            for entry_id, name in zip(ids, names):
                assert entry_id in features, entry_id
                assert entries[entry_id]["name"].replace(",", "") == name

    def test_every_background_feat_is_in_the_pack(self, pf):
        _, entries = pf
        for background in _rows("background"):
            if " or " in background["feat"]:
                # Martial Disciple's feat depends on the skill chosen, which a
                # grant cannot follow, so it is granted by name for the player.
                assert background["feat_id"] == ""
                continue
            assert background["feat_id"] in entries, background["_id"]
            assert entries[background["feat_id"]]["name"] == background["feat"]

    @pytest.mark.parametrize(
        "content_type,prop",
        [("class", "trained_skills"), ("class", "either_skills"), ("class", "skill_options"),
         ("background", "skills"), ("background", "either_skills")],
    )
    def test_every_skill_granted_or_offered_is_a_real_skill(self, pf, content_type, prop):
        document, _ = pf
        skills = set(document["fields"]["skills_trained"]["options"])
        for row in _rows(content_type):
            assert set(row[prop]) <= skills, row["_id"]

    def test_the_sheet_keeps_the_character_name_in_its_name_field(self, pf):
        document, _ = pf
        assert document["name_field"] == "hero_name"

    def test_every_value_has_a_place_on_the_layout(self, pf):
        with open(_LAYOUT, encoding="utf-8") as handle:
            html = handle.read()
        placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
        for group in re.findall(r'fields="([a-z0-9_ ]+)"', html):
            placed.update(group.split())
        document, _ = pf
        assert set(document["fields"]) - placed == set()
        assert set(document["computed"]) - placed == set()


class TestPathfinderDerivesFromChoices:
    @pytest.mark.parametrize("level,expected", [(1, 22), (5, 70)])
    def test_hit_points_are_ancestry_plus_class_and_constitution_each_level(self, pf, level,
                                                                            expected):
        # Dwarf 10, fighter 10 a level, Constitution +2.
        context = _context(pf, ancestry={"_ref": "dwarf"}, klass={"_ref": "fighter"},
                           constitution=2, level=level)
        assert context["hp_max"] == expected

    def test_current_hp_follows_the_maximum_until_it_is_set(self, pf):
        picks = {"ancestry": {"_ref": "dwarf"}, "klass": {"_ref": "fighter"}}
        assert _context(pf, **picks)["hp_current"] == 20
        assert _context(pf, **picks, hp_current=3)["hp_current"] == 3

    def test_ancestry_sets_speed_size_senses_and_languages(self, pf):
        context = _context(pf, ancestry={"_ref": "dwarf"})
        assert (context["speed"], context["size"]) == (20, "Medium")
        assert context["senses"] == "Darkvision"
        assert "Dwarven" in context["languages"]
        assert _context(pf, ancestry={"_ref": "goblin"})["size"] == "Small"

    def test_the_class_sets_perception_and_saves(self, pf):
        fighter = _context(pf, klass={"_ref": "fighter"})
        assert (fighter["perception_prof"], fighter["fortitude_prof"], fighter["reflex_prof"],
                fighter["will_prof"]) == (4, 4, 4, 2)
        wizard = _context(pf, klass={"_ref": "wizard"})
        assert (wizard["perception_prof"], wizard["will_prof"]) == (2, 4)

    def test_saves_add_the_level_once_trained(self, pf):
        # Fighter level 3, Con +3, expert Fortitude: 3 + 3 + 4.
        computed = _computed(pf, klass={"_ref": "fighter"}, level=3, constitution=3)
        assert computed["fortitude"] == "+10"

    def test_key_attribute_follows_the_class(self, pf):
        assert _context(pf, klass={"_ref": "wizard"})["key_ability"] == "intelligence"
        # A fighter's is Strength or Dexterity; Strength is offered first.
        assert _context(pf, klass={"_ref": "fighter"})["key_ability"] == "strength"

    def test_armour_proficiency_follows_what_is_worn(self, pf):
        fighter = {"klass": {"_ref": "fighter"}}
        assert _context(pf, **fighter, armor_category="heavy")["ac_prof"] == 2
        assert _context(pf, klass={"_ref": "wizard"}, armor_category="heavy")["ac_prof"] == 0

    def test_armour_class(self, pf):
        # 10 + Dex 2 + trained (level 1 + 2).
        assert _computed(pf, klass={"_ref": "fighter"}, dexterity=2)["armor_class"] == 15
        raised = _computed(pf, klass={"_ref": "fighter"}, dexterity=2, shield_raised=True)
        assert raised["armor_class"] == 17

    @pytest.mark.parametrize(
        "ladder,expected",
        [({}, "+4"), ({"skills_trained": ["Arcana"]}, "+7"),
         ({"skills_trained": ["Arcana"], "skills_expert": ["Arcana"]}, "+9"),
         ({"skills_trained": ["Arcana"], "skills_expert": ["Arcana"],
           "skills_master": ["Arcana"], "skills_legendary": ["Arcana"]}, "+13")],
    )
    def test_a_skill_adds_level_and_rank_once_trained(self, pf, ladder, expected):
        # Intelligence +4 at level 1.
        assert _computed(pf, intelligence=4, level=1, **ladder)["skill_arcana"] == expected

    def test_a_background_lore_starts_trained(self, pf):
        context = _context(pf, background={"_ref": "acolyte"})
        assert context["lore_1_name"] == "Scribing Lore"
        assert context["lore_1_prof"] == 2

    def test_casters_and_their_tradition_follow_the_class(self, pf):
        wizard = _context(pf, klass={"_ref": "wizard"})
        assert wizard["is_caster"] is True
        assert wizard["spell_tradition"] == "Arcane"
        fighter = _context(pf, klass={"_ref": "fighter"})
        assert not fighter["is_caster"]
        assert fighter["caster_level"] == 0

    def test_the_player_can_make_anyone_a_caster(self, pf):
        assert _context(pf, klass={"_ref": "fighter"}, is_caster=True)["is_caster"] is True

    @pytest.mark.parametrize(
        "level,expected",
        [(1, {1: 2}), (2, {1: 3}), (3, {1: 3, 2: 2}), (10, {5: 3, 6: 0}),
         (17, {8: 3, 9: 2}), (19, {9: 3, 10: 1})],
    )
    def test_spell_slots_follow_the_full_caster_table(self, pf, level, expected):
        context = _context(pf, klass={"_ref": "wizard"}, level=level)
        for rank, slots in expected.items():
            assert context[f"slots_{rank}_total"] == slots, rank
        assert context["cantrips_total"] == 5

    def test_with_nothing_picked_everything_is_plain(self, pf):
        context = _context(pf)
        assert (context["hp_max"], context["speed"], context["size"]) == (10, 25, "Medium")
        assert context["perception_prof"] == 2
        assert not context["is_caster"]

    def test_any_calculated_value_can_be_set(self, pf):
        assert _computed(pf, _overrides={"armor_class": 25})["armor_class"] == 25


class TestPathfinderWarnings:
    def _warnings(self, pf, **data):
        document, entries = pf
        return [w["message"] for w in svc.run_validators(document, data, entries)]

    def test_a_heritage_from_another_ancestry_warns(self, pf):
        heritage = next(h for h in _rows("heritage") if h["ancestry"] == "Elf")
        warnings = self._warnings(pf, ancestry={"_ref": "dwarf"},
                                  heritage={"_ref": heritage["_id"]})
        assert any("heritage" in w for w in warnings)

    def test_a_versatile_heritage_suits_any_ancestry(self, pf):
        assert not self._warnings(pf, ancestry={"_ref": "dwarf"}, heritage={"_ref": "aiuvarin"})

    def test_a_first_level_attribute_above_four_warns(self, pf):
        assert self._warnings(pf, level=1, strength=5)
        assert not self._warnings(pf, level=5, strength=5)
