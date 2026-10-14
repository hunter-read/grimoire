"""The JSONPath subset character importers read exports with."""
import pytest

from backend.addons import jsonpath as jp

HERO = {
    "name": "Vex",
    "class": {
        "level": 2,
        "characteristics": [
            {"characteristic": "Might", "value": 2},
            {"characteristic": "Agility", "value": -1},
        ],
        "featuresByLevel": [
            {"level": 1, "features": [{"type": "Skill Choice", "data": {"selected": ["Climb"]}}]},
            {"level": 2, "features": [{"type": "Skill Choice", "data": {"selected": ["Swim"]}}]},
            {"level": 3, "features": [{"type": "Skill Choice", "data": {"selected": ["Hide"]}}]},
        ],
        "abilities": [{"id": "a1", "name": "Strike"}, {"id": "a2", "name": "Shove"}],
        "subclasses": [{"name": "One", "selected": False}, {"name": "Two", "selected": True}],
        "picks": {"selectedIDs": ["a2"]},
    },
    "state": {"hidden": False, "xp": 0, "notes": ""},
    "proficiencies": {"acrobatics": 2, "arcana": 4, "athletics": 2},
    "feats": [["Toughness", None, "General Feat"], ["Human", None, "Heritage"]],
}


class TestPaths:
    def test_members_and_indexes(self):
        assert jp.values(HERO, "$.name") == ["Vex"]
        assert jp.values(HERO, "$['name']") == ["Vex"]
        assert jp.values(HERO, "$.class.characteristics[0].value") == [2]
        assert jp.values(HERO, "$.class.characteristics[-1].characteristic") == ["Agility"]
        assert jp.values(HERO, "$.class.characteristics[5]") == []

    def test_wildcards_and_slices(self):
        assert jp.values(HERO, "$.class.abilities[*].name") == ["Strike", "Shove"]
        assert jp.values(HERO, "$.class.abilities.*.id") == ["a1", "a2"]
        assert jp.values(HERO, "$.class.featuresByLevel[1:].level") == [2, 3]
        assert jp.values(HERO, "$.class.featuresByLevel[:1].level") == [1]

    def test_a_union_of_member_names(self):
        assert jp.values(HERO, "$['name', 'nope', 'state'].xp") == [0]

    def test_recursive_descent_by_name(self):
        assert jp.values(HERO, "$..selected[*]") == ["Climb", "Swim", "Hide"]

    def test_recursive_descent_with_a_filter(self):
        found = jp.values(HERO, "$..[?(@.type == 'Skill Choice')].data.selected[*]")
        assert found == ["Climb", "Swim", "Hide"]

    def test_a_missing_member_selects_nothing(self):
        assert jp.values(HERO, "$.class.nope.deeper") == []
        assert jp.values(HERO, "$.name.length") == []

    def test_relative_paths_start_at_the_current_item(self):
        item = {"name": "Inner"}
        assert jp.values(HERO, "@.name", item) == ["Inner"]

    def test_keys_are_reported(self):
        keys = [key for key, _ in jp.query(HERO, "$.proficiencies[?(@ == 2)]")]
        assert keys == ["acrobatics", "athletics"]


class TestFilters:
    def test_equality(self):
        path = "$.class.characteristics[?(@.characteristic == 'Might')].value"
        assert jp.values(HERO, path) == [2]

    def test_comparison_against_an_absolute_path(self):
        path = "$.class.featuresByLevel[?(@.level <= $.class.level)].level"
        assert jp.values(HERO, path) == [1, 2]

    def test_truthiness(self):
        assert jp.values(HERO, "$.class.subclasses[?(@.selected)].name") == ["Two"]
        assert jp.values(HERO, "$.class.subclasses[?(!@.selected)].name") == ["One"]

    def test_in_looks_inside_a_list(self):
        path = "$.class.abilities[?(@.id in $..selectedIDs)].name"
        assert jp.values(HERO, path) == ["Shove"]

    def test_and_or_and_grouping(self):
        path = "$.class.featuresByLevel[?(@.level == 1 || (@.level > 1 && @.level != 3))].level"
        assert jp.values(HERO, path) == [1, 2]

    def test_index_inside_a_filter(self):
        assert jp.values(HERO, "$.feats[?(@[2] != 'Heritage')][0]") == ["Toughness"]

    def test_false_is_not_zero(self):
        # Python's False == 0 must not leak into the query language.
        assert [k for k, _ in jp.query(HERO, "$.state[?(@ == 0)]")] == ["xp"]
        assert [k for k, _ in jp.query(HERO, "$.state[?(@ == false)]")] == ["hidden"]

    def test_incomparable_values_do_not_match(self):
        assert jp.values(HERO, "$.class.characteristics[?(@.characteristic < 3)]") == []

    def test_literals(self):
        doc = {"items": [{"v": 1.5}, {"v": None}, {"v": True}]}
        assert jp.values(doc, "$.items[?(@.v == 1.5)].v") == [1.5]
        assert len(jp.values(doc, "$.items[?(@.v == null)]")) == 1
        assert jp.values(doc, "$.items[?(@.v == true)].v") == [True]
        assert jp.values(doc, "$.items[?(@.v == \"x\")]") == []


class TestParsing:
    @pytest.mark.parametrize(
        "path",
        [
            "",
            "name",
            "$.[",
            "$..",
            "$[?(@.a ==)]",
            "$.a b",
            "$[1.5]",
            "$[",
            "$[?(@.a == 'x')",
            "$.a ~",
            "$[]",
        ],
    )
    def test_malformed_paths_are_rejected(self, path):
        with pytest.raises(jp.JsonPathError):
            jp.compile_path(path)

    def test_an_overlong_path_is_rejected(self):
        with pytest.raises(jp.JsonPathError):
            jp.compile_path("$." + "a." * 300 + "b")

    def test_a_runaway_query_is_stopped(self, monkeypatch):
        monkeypatch.setattr(jp, "MAX_NODES", 5)
        with pytest.raises(jp.JsonPathError):
            jp.values({"a": list(range(50))}, "$..*")

    def test_deep_documents_do_not_exhaust_recursion(self):
        doc: dict = {}
        node = doc
        for _ in range(3000):
            node["n"] = {}
            node = node["n"]
        node["leaf"] = 1
        assert jp.values(doc, "$..leaf") == [1]
