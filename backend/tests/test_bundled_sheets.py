"""Every character sheet in the community repository must load in the engine.

These are the shipped sheets (issue #134). A sheet that stops validating is a
sheet nobody can install, and the failure would otherwise surface as a support
question rather than a test.

The repository is a sibling checkout, so the whole module skips when it is not
present — a contributor working only on the app should not see failures for a
repo they have not cloned.
"""
import json
import os

import pytest

from backend.services import characters as svc

_REPO = os.path.abspath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "community-add-ons")
)
_SHEET_DIR = os.path.join(_REPO, "character-sheets")

pytestmark = pytest.mark.skipif(
    not os.path.isdir(_SHEET_DIR),
    reason="the community-add-ons repository is not checked out beside this one",
)


def _sheets():
    if not os.path.isdir(_SHEET_DIR):
        return []
    found = []
    for name in sorted(os.listdir(_SHEET_DIR)):
        path = os.path.join(_SHEET_DIR, name, f"{name}.json")
        if os.path.isfile(path):
            found.append(pytest.param(path, id=name))
    return found


def _load(path: str) -> dict:
    with open(path, encoding="utf-8") as handle:
        document = json.load(handle)
    # `$schema` is an editor affordance, not part of the document.
    document.pop("$schema", None)
    return document


@pytest.mark.parametrize("path", _sheets())
class TestBundledSheets:
    def test_validates(self, path):
        assert svc.validate_schema(_load(path))

    def test_computes_on_an_empty_character(self, path):
        """A brand-new character must render, not error."""
        document = svc.validate_schema(_load(path))
        assert svc.compute_values(document, {}) is not None
        assert svc.run_validators(document, {}) is not None
        assert svc.visible_fields(document, {}) is not None

    def test_carries_its_licence_and_credit(self, path):
        """Licensed content must credit its source; several licences demand it."""
        document = _load(path)
        if document.get("license"):
            assert document.get("attribution"), "a licensed sheet needs an attribution"

    def test_a_custom_layout_parses_and_scopes_its_css(self, path):
        document = svc.validate_schema(_load(path), scope="gc-test")
        raw = _load(path)
        if raw.get("layout_html"):
            assert document["layout_ast"], "layout_html produced no nodes"
        if raw.get("styles"):
            # Every rule is confined to the sheet, so a sheet cannot restyle
            # the app around it.
            for line in document["styles_css"].splitlines():
                if line.strip().startswith(("@", "}")) or "{" not in line:
                    continue
                assert ".gc-test" in line, f"unscoped rule: {line}"


    def test_its_layout_and_stylesheet_files_pass_import(self, path):
        """The sibling files are what gets installed, so they must pass too.

        Every shipped sheet names its layout and stylesheet as files, which
        import reads in and validates. The test above only sees inline ones, so
        a CSS property the server refuses reached a sheet unnoticed.
        """
        document = _load(path)
        folder = os.path.dirname(path)
        for pointer, key in (("layout_file", "layout_html"), ("styles_file", "styles")):
            name = document.pop(pointer, None)
            if name:
                with open(os.path.join(folder, name), encoding="utf-8") as handle:
                    document[key] = handle.read()
        validated = svc.validate_schema(document, scope="gc-test")
        if document.get("layout_html"):
            assert validated["layout_ast"]


def test_at_least_the_shipped_systems_are_present():
    """Phase 6 committed to five systems; the rest followed."""
    names = {os.path.basename(param.values[0]).removesuffix(".json") for param in _sheets()}
    assert {"dnd-5e-2024", "draw-steel", "pathfinder-2e", "cairn", "basic-fantasy",
            "call-of-cthulhu-7e", "traveller-2e", "cosmere-rpg", "dungeon-crawler-carl",
            "pathfinder-1e"} <= names


# --- the 5e sheet against the 5e SRD pack ------------------------------------

_PACK_DIR = os.path.join(_REPO, "content-packs", "dnd-5e-srd")


def _srd_entries(document: dict) -> dict:
    """Every SRD entry, cleaned against the sheet the way the loader does it.

    Cleaning matters: the loader drops any property the sheet does not declare,
    so this is also the check that the sheet declares what its rules read.
    """
    from backend.services.characters.packs import _clean_entry

    entries = {}
    for type_name, type_definition in document["content_types"].items():
        path = os.path.join(_PACK_DIR, f"{type_name}.json")
        if not os.path.isfile(path):
            continue
        with open(path, encoding="utf-8") as handle:
            for row in json.load(handle):
                cleaned = _clean_entry(row, type_definition.get("fields") or {})
                entries[row["_id"]] = cleaned
    return entries


@pytest.fixture(scope="module")
def dnd():
    if not os.path.isdir(_PACK_DIR):
        pytest.skip("the 5e SRD pack is not present")
    document = svc.validate_schema(
        _load(os.path.join(_SHEET_DIR, "dnd-5e-2024", "dnd-5e-2024.json"))
    )
    return document, _srd_entries(document)


def _sheet(dnd, **data):
    from backend.services.characters.schema import _build_context

    document, entries = dnd
    return _build_context(document, data, entries), svc.compute_values(document, data, entries)


class TestDnd5eDerivesFromChoices:
    """The 5e sheet's rules, checked against the real SRD content.

    Values here are worked out by hand from SRD 5.2, so a change to the sheet
    or the pack that breaks the arithmetic fails here rather than at a table.
    """

    def test_a_wizard_casts_with_intelligence(self, dnd):
        context, computed = _sheet(dnd, klass={"_ref": "wizard"}, intelligence=16, level=1)
        assert context["is_caster"] is True
        assert context["spell_ability"] == "intelligence"
        # 8 + proficiency 2 + Int modifier 3.
        assert computed["spell_save_dc"] == 13

    @pytest.mark.parametrize(
        "klass, ability",
        [
            ("bard", "charisma"),
            ("cleric", "wisdom"),
            ("druid", "wisdom"),
            ("paladin", "charisma"),
            ("ranger", "wisdom"),
            ("sorcerer", "charisma"),
            ("warlock", "charisma"),
        ],
    )
    def test_every_casting_class_derives_its_ability(self, dnd, klass, ability):
        context, _ = _sheet(dnd, klass={"_ref": klass})
        assert context["is_caster"] is True
        assert context["spell_ability"] == ability

    @pytest.mark.parametrize("klass", ["barbarian", "fighter", "monk", "rogue"])
    def test_a_non_casting_class_is_not_a_caster(self, dnd, klass):
        context, _ = _sheet(dnd, klass={"_ref": klass})
        assert context["is_caster"] is False

    def test_the_player_can_make_any_class_a_caster(self, dnd):
        context, _ = _sheet(dnd, klass={"_ref": "fighter"}, is_caster=True)
        assert context["is_caster"] is True

    def test_saving_throws_follow_the_class(self, dnd):
        context, _ = _sheet(dnd, klass={"_ref": "wizard"})
        profs = {
            ability
            for ability in (
                "strength", "dexterity", "constitution", "intelligence", "wisdom", "charisma"
            )
            if context[f"{ability}_save_prof"]
        }
        assert profs == {"intelligence", "wisdom"}

    @pytest.mark.parametrize(
        "klass, level, constitution, expected",
        [
            # Level 1: the die's maximum plus Con modifier.
            ("wizard", 1, 14, 8),
            # Then the die's average rounded up, plus Con, each level: 8 + 4 x 6.
            ("wizard", 5, 14, 32),
            # 12 + 2 x (6 + 2).
            ("fighter", 3, 14, 28),
            ("barbarian", 1, 10, 12),
        ],
    )
    def test_hit_points_use_the_fixed_value_rule(self, dnd, klass, level, constitution, expected):
        context, _ = _sheet(dnd, klass={"_ref": klass}, level=level, constitution=constitution)
        assert context["hp_max"] == expected

    def test_rolled_hit_points_override_the_fixed_value(self, dnd):
        context, _ = _sheet(dnd, klass={"_ref": "wizard"}, level=5, hp_max=27)
        assert context["hp_max"] == 27

    def test_hit_dice_follow_class_and_level(self, dnd):
        context, _ = _sheet(dnd, klass={"_ref": "fighter"}, level=3)
        assert context["hit_dice"] == "3d10"

    def test_species_sets_speed_and_size(self, dnd):
        context, _ = _sheet(dnd, species={"_ref": "halfling"})
        assert context["size"] == "Small"
        assert context["speed"] == 30

    def test_every_background_feat_is_in_the_pack(self, dnd):
        """A background naming a feat the pack lacks would only grant its name."""
        _, entries = dnd
        backgrounds = [e for e in entries.values() if "feat_id" in e]
        # SRD 5.2 has exactly four backgrounds.
        assert len(backgrounds) == 4
        for background in backgrounds:
            assert background["feat_id"] in entries, background["name"]

    def test_the_rules_survive_the_loader(self, dnd):
        """The loader drops undeclared properties, which would silently empty a rule."""
        _, entries = dnd
        assert entries["wizard"]["skill_choices"] == 2
        assert entries["rogue"]["skill_options"]
        assert entries["acolyte"]["skill_proficiencies"] == ["Insight", "Religion"]

    def test_with_nothing_picked_everything_is_plain(self, dnd):
        context, _ = _sheet(dnd)
        assert context["is_caster"] is False
        assert context["speed"] == 30
        assert context["hit_dice"] == ""


class TestDnd5eOverrides:
    """Anything the 5e sheet calculates, the player can set - AC first of all."""

    def test_armour_class_can_be_set(self, dnd):
        _, computed = _sheet(dnd, dexterity=14, _overrides={"armor_class": 19})
        assert computed["armor_class"] == 19

    def test_a_proficiency_override_reaches_the_save_dc(self, dnd):
        _, computed = _sheet(
            dnd, klass={"_ref": "wizard"}, intelligence=16, _overrides={"proficiency": 4}
        )
        # 8 + the overridden 4 + Int modifier 3.
        assert computed["spell_save_dc"] == 15


class TestDnd5ePageOne:
    """Scores, skills and the warnings for how scores were chosen."""

    def test_a_background_bonus_adds_to_the_base_score(self, dnd):
        _, computed = _sheet(dnd, intelligence=15, intelligence_bonus=2)
        assert computed["intelligence_score"] == 17
        assert computed["intelligence_mod"] == 3

    def test_skills_show_their_value_not_just_a_tick(self, dnd):
        _, computed = _sheet(dnd, dexterity=16, level=5, skill_profs=["Stealth"])
        # Dex +3, plus proficiency +3 at level 5 for the proficient one.
        assert computed["skill_stealth"] == "+6"
        assert computed["skill_acrobatics"] == "+3"

    def test_a_shield_adds_two(self, dnd):
        _, computed = _sheet(dnd, dexterity=14, shield=True)
        assert computed["armor_class"] == 14

    def _warnings(self, dnd, **data):
        document, entries = dnd
        return [r["message"] for r in svc.run_validators(document, data, entries)]

    def test_manual_scores_are_never_judged(self, dnd):
        assert not self._warnings(dnd, strength=18, dexterity=3)

    def test_background_bonuses_over_three_warn(self, dnd):
        warnings = self._warnings(dnd, strength_bonus=2, dexterity_bonus=2)
        assert any("3 in total" in w for w in warnings)

    def test_a_bonus_on_an_ability_the_background_does_not_list_warns(self, dnd):
        # The Acolyte lists Intelligence, Wisdom and Charisma.
        warnings = self._warnings(dnd, background={"_ref": "acolyte"}, strength_bonus=1)
        assert any("does not list" in w for w in warnings)
        assert not self._warnings(
            dnd, background={"_ref": "acolyte"}, wisdom_bonus=2, charisma_bonus=1
        )

    def test_species_grant_their_traits(self, dnd):
        document, entries = dnd
        rule = document["fields"]["species"]["on_pick"][0]
        assert rule["grant"] == "species_traits"
        # Every trait id a species lists is a trait in the pack, in the same
        # order as its names - which a grant falls back to without the pack.
        for species in (e for e in entries.values() if "trait_ids" in e):
            ids = [i.strip() for i in species["trait_ids"].split(",")]
            names = [n.strip() for n in species["traits"].split(",")]
            assert len(ids) == len(names), species["name"]
            for trait_id, name in zip(ids, names):
                assert entries[trait_id]["name"] == name
                assert entries[trait_id]["species"] == species["name"]

    def test_the_sheet_keeps_the_character_name_in_its_name_field(self, dnd):
        document, _ = dnd
        assert document["name_field"] == "hero_name"

    def test_every_value_has_a_place_on_the_layout(self, dnd):
        """A value only the All values dialog can reach is one the layout forgot."""
        import re

        with open(os.path.join(_SHEET_DIR, "dnd-5e-2024", "dnd-5e-2024.html")) as handle:
            html = handle.read()
        placed = set(re.findall(r'(?:name|field|count|value)="([a-z0-9_]+)"', html))
        # <g-tier fields="a b"> binds every list it names.
        for group in re.findall(r'fields="([a-z0-9_ ]+)"', html):
            placed.update(group.split())
        document, _ = dnd
        assert set(document["fields"]) - placed == set()
        assert set(document["computed"]) - placed == set()


class TestDnd5eExpertise:
    def test_expertise_doubles_proficiency(self, dnd):
        # Dex 16 (+3); level 5 proficiency is +3, doubled to +6.
        _, computed = _sheet(
            dnd, dexterity=16, level=5, skill_profs=["Stealth"], skill_expertise=["Stealth"]
        )
        assert computed["skill_stealth"] == "+9"

    def test_expertise_counts_even_without_the_proficiency_box(self, dnd):
        """Expertise implies proficiency; a player ticking only one is not wrong."""
        _, computed = _sheet(dnd, dexterity=16, level=5, skill_expertise=["Stealth"])
        assert computed["skill_stealth"] == "+9"

    def test_passive_perception_includes_expertise(self, dnd):
        _, computed = _sheet(dnd, wisdom=14, level=1, skill_expertise=["Perception"])
        # 10 + Wis 2 + 2 x proficiency 2.
        assert computed["passive_perception"] == 16



class TestDnd5eSpellSlots:
    """Slots derived from class and level, checked against the SRD 5.2 tables."""

    def _slots(self, dnd, klass, level):
        context, _ = _sheet(dnd, klass={"_ref": klass}, level=level)
        return [context[f"slots_{n}_total"] for n in range(1, 10)]

    @pytest.mark.parametrize(
        "level, expected",
        [
            (1, [2, 0, 0, 0, 0, 0, 0, 0, 0]),
            (5, [4, 3, 2, 0, 0, 0, 0, 0, 0]),
            (11, [4, 3, 3, 3, 2, 1, 0, 0, 0]),
            (20, [4, 3, 3, 3, 3, 2, 2, 1, 1]),
        ],
    )
    def test_a_full_caster(self, dnd, level, expected):
        assert self._slots(dnd, "wizard", level) == expected

    @pytest.mark.parametrize(
        "level, expected",
        [
            (1, [2, 0, 0, 0, 0]),
            (5, [4, 2, 0, 0, 0]),
            (13, [4, 3, 3, 1, 0]),
            (19, [4, 3, 3, 3, 2]),
        ],
    )
    def test_a_half_caster_is_the_full_table_at_half_level(self, dnd, level, expected):
        assert self._slots(dnd, "paladin", level)[:5] == expected

    @pytest.mark.parametrize(
        "level, slots, slot_level",
        [(1, 1, 1), (2, 2, 1), (5, 2, 3), (9, 2, 5), (11, 3, 5), (17, 4, 5)],
    )
    def test_a_warlock_has_pact_slots_instead(self, dnd, level, slots, slot_level):
        context, _ = _sheet(dnd, klass={"_ref": "warlock"}, level=level)
        assert context["pact_slots_total"] == slots
        assert context["pact_slot_level"] == slot_level
        assert self._slots(dnd, "warlock", level) == [0] * 9

    def test_a_non_caster_has_none(self, dnd):
        assert self._slots(dnd, "fighter", 20) == [0] * 9

    def test_the_caster_level_can_be_set_for_a_multiclass(self, dnd):
        """A Wizard 3 / Paladin 4 is caster level 5 - the player sets it."""
        context, _ = _sheet(dnd, klass={"_ref": "wizard"}, level=7, caster_level=5)
        assert [context[f"slots_{n}_total"] for n in (1, 2, 3)] == [4, 3, 2]


class TestDnd5eEquipmentAndFeatures:
    """The catalogue beyond the character-creation choices: gear, magic items, features."""

    def test_the_pack_holds_every_srd_spell(self, dnd):
        _, entries = dnd
        assert sum(1 for e in entries.values() if "school" in e) == 339

    def test_carried_weight_counts_quantity(self, dnd):
        # Chain mail 55 lb, two daggers at 1 lb, and a custom 3 lb idol.
        _, computed = _sheet(
            dnd,
            equipment=[
                {"_ref": "chain-mail"},
                {"_ref": "dagger", "_per": {"qty": 2}},
                {"_inline": True, "name": "Idol", "weight": 3},
            ],
        )
        assert computed["carried_weight"] == 60

    def test_weapons_carry_their_damage_and_mastery(self, dnd):
        _, entries = dnd
        assert entries["longsword"]["damage"] == "1d8 Slashing"
        assert entries["longsword"]["mastery"] == "Sap"
        assert entries["chain-mail"]["strength"] == 13

    def test_a_fourth_attuned_item_warns(self, dnd):
        document, entries = dnd
        items = [{"_ref": e, "_per": {"attuned": True}} for e in (
            "magic-amulet-of-health", "magic-cloak-of-protection", "magic-ring-of-protection",
        )]
        assert not [r for r in svc.run_validators(document, {"magic_items": items}, entries)
                    if "attuned" in r["message"]]
        items.append({"_ref": "magic-bracers-of-defense", "_per": {"attuned": True}})
        warnings = svc.run_validators(document, {"magic_items": items}, entries)
        assert any("attuned" in r["message"] for r in warnings)

    def test_every_magic_item_id_the_test_uses_is_real(self, dnd):
        _, entries = dnd
        for entry_id in ("magic-amulet-of-health", "magic-cloak-of-protection",
                         "magic-ring-of-protection", "magic-bracers-of-defense",
                         "magic-weapon-1-2-or-3"):
            assert entry_id in entries

    def test_a_class_grants_its_level_one_features(self, dnd):
        document, entries = dnd
        rule = document["fields"]["klass"]["on_pick"][-1]
        assert rule["grant"] == "features"
        for klass in (e for e in entries.values() if "hit_die" in e):
            ids = [i.strip() for i in klass["feature_ids"].split(",")]
            names = [n.strip() for n in klass["feature_names"].split(",")]
            assert ids and len(ids) == len(names), klass["name"]
            for feature_id, name in zip(ids, names):
                assert entries[feature_id]["name"] == name
                assert entries[feature_id]["class"] == klass["name"]
                assert entries[feature_id]["level"] == 1


class TestSrdPackIsSrdOnly:
    """The pack carries a CC BY 4.0 SRD attribution, so it must hold nothing else.

    It once held ten Player's Handbook backgrounds, nine PHB feats and the
    Aasimar under that attribution. These are the SRD 5.2 lists.
    """

    SRD = {
        "background": {"acolyte", "criminal", "sage", "soldier"},
        "species": {"dragonborn", "dwarf", "elf", "gnome", "goliath", "halfling", "human",
                    "orc", "tiefling"},
        "feat": {"alert", "magic-initiate", "savage-attacker", "skilled",
                 "ability-score-improvement", "grappler", "archery", "defense",
                 "great-weapon-fighting", "two-weapon-fighting", "boon-of-combat-prowess",
                 "boon-of-dimensional-travel", "boon-of-fate", "boon-of-irresistible-offense",
                 "boon-of-spell-recall", "boon-of-the-night-spirit", "boon-of-truesight"},
    }

    @pytest.mark.parametrize("content_type", ["background", "species", "feat"])
    def test_holds_only_srd_entries(self, content_type):
        if not os.path.isdir(_PACK_DIR):
            pytest.skip("the 5e SRD pack is not present")
        with open(os.path.join(_PACK_DIR, f"{content_type}.json"), encoding="utf-8") as handle:
            ids = {row["_id"] for row in json.load(handle)}
        assert ids <= self.SRD[content_type], ids - self.SRD[content_type]
