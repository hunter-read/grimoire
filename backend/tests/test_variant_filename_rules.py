"""A library's own filename markers for variant kinds and labels (issue #569)."""
import json
from types import SimpleNamespace

import pytest

from backend.config import SessionLocal
from backend.models import AppSetting
from backend.services.duplicates.scoring import suggest_kind
from backend.services.filename_rules import variant_rules as vr


def _rule(match="token", value="nogrid", kind="gridless", label="", collection=None):
    return {"match": match, "value": value, "kind": kind, "label": label, "collection": collection}


def _file(filename, **kw):
    return SimpleNamespace(filename=filename, title=kw.get("title", ""), version=kw.get("version", ""))


@pytest.fixture
def clear_rules():
    """Leave no saved rules behind for the next test in this worker."""
    yield
    db = SessionLocal()
    db.query(AppSetting).filter_by(key=vr.SETTING_KEY).delete()
    db.commit()
    db.close()


class TestMatches:
    def test_prefix_ignores_case(self):
        assert vr.matches(_rule("prefix", "GL_"), "gl_Tavern.png")
        assert not vr.matches(_rule("prefix", "GL_"), "Tavern_GL.png")

    def test_suffix_is_checked_against_the_stem(self):
        assert vr.matches(_rule("suffix", "-pf"), "Rulebook-PF.pdf")
        assert not vr.matches(_rule("suffix", "-pf"), "Rulebook-PF-v2.pdf")

    def test_token_is_a_whole_token_not_a_substring(self):
        assert vr.matches(_rule("token", "grid"), "Tavern [grid].png")
        assert not vr.matches(_rule("token", "grid"), "Gridiron Tavern.png")

    def test_a_token_rule_may_span_tokens(self):
        assert vr.matches(_rule("token", "no grid"), "Tavern_No-Grid.png")
        assert not vr.matches(_rule("token", "no grid"), "Tavern grid no.png")

    def test_a_token_with_no_letters_matches_nothing(self):
        assert not vr.matches(_rule("token", "__"), "a__b.png")


class TestValidate:
    def test_cleans_and_keeps_order(self):
        rules = vr.validate_rules(
            [
                {"match": "prefix", "value": " GL_ ", "kind": "gridless"},
                {"match": "token", "value": "night", "label": " Night "},
            ]
        )
        assert rules == [
            _rule("prefix", "GL_", "gridless"),
            _rule("token", "night", None, "Night"),
        ]

    @pytest.mark.parametrize(
        "raw, message",
        [
            ("nope", "must be a list"),
            (["nope"], "not an object"),
            ([{"match": "regex", "value": "x", "kind": "other"}], "match must be"),
            ([{"match": "token", "value": " ", "kind": "other"}], "nothing to match"),
            ([{"match": "token", "value": "x" * 101, "kind": "other"}], "too long"),
            ([{"match": "token", "value": "--", "kind": "other"}], "no letters"),
            ([{"match": "token", "value": "x"}], "kind, a label"),
            ([{"match": "token", "value": "x", "kind": "bogus"}], "not a kind any"),
            ([{"match": "token", "value": "x", "kind": "gridless", "collection": "book"}], "book variants"),
            ([{"match": "token", "value": "x", "kind": "other", "collection": "scroll"}], "unknown collection"),
        ],
    )
    def test_rejects_with_a_useful_message(self, raw, message):
        with pytest.raises(vr.RuleError, match=message):
            vr.validate_rules(raw)

    def test_caps_the_list(self):
        with pytest.raises(vr.RuleError, match="At most"):
            vr.validate_rules([_rule()] * (vr.MAX_RULES + 1))


class TestSuggest:
    def test_a_marker_both_files_carry_says_nothing(self):
        rules = [_rule("prefix", "GL_", "gridless")]
        assert vr.suggest(rules, "GL_Tavern.png", "GL_Cellar.png", "map") == (None, "")

    def test_kind_and_label_come_from_separate_rules(self):
        rules = [_rule("token", "night", None, "Night"), _rule("prefix", "GL_", "gridless")]
        assert vr.suggest(rules, "GL_Tavern_Night.png", "Tavern.png", "map") == ("gridless", "Night")

    def test_first_distinguishing_rule_wins(self):
        rules = [_rule("prefix", "GL_", "gridless"), _rule("token", "tavern", "gridded")]
        assert vr.suggest(rules, "GL_Tavern.png", "Tavern2.png", "map")[0] == "gridless"

    def test_skips_rules_scoped_to_another_collection(self):
        rules = [_rule("prefix", "GL_", "gridless", collection="map")]
        assert vr.suggest(rules, "GL_x.png", "x.png", "token") == (None, "")

    def test_skips_a_kind_the_collection_cannot_have(self):
        rules = [_rule("prefix", "GL_", "gridless")]
        assert vr.suggest(rules, "GL_x.pdf", "x.pdf", "book") == (None, "")


class TestSuggestKind:
    def test_a_rule_beats_the_built_in_marker(self):
        rules = [_rule("token", "pf", "printer-friendly")]
        # Built-in would say nothing distinguishes these; the rule does.
        assert suggest_kind(_file("Rules-pf.pdf"), _file("Rules.pdf"), "book", rules) == (
            "printer-friendly",
            "",
        )

    def test_a_label_only_rule_keeps_the_built_in_kind(self):
        rules = [_rule("token", "night", None, "Night")]
        assert suggest_kind(_file("Tavern_nogrid_night.png"), _file("Tavern_grid.png"), "map", rules) == (
            "gridless",
            "Night",
        )

    def test_a_label_only_rule_with_no_built_in_kind_is_other(self):
        rules = [_rule("token", "night", None, "Night")]
        assert suggest_kind(_file("Tavern night.png"), _file("Tavern.png"), "map", rules) == (
            "other",
            "Night",
        )

    def test_a_rule_kind_drops_the_label_of_a_different_built_in_kind(self):
        rules = [_rule("prefix", "GL_", "gridless")]
        assert suggest_kind(_file("GL_Tavern v2.png"), _file("Tavern v1.png"), "map", rules) == (
            "gridless",
            "",
        )

    def test_without_rules_nothing_changes(self):
        assert suggest_kind(_file("Tavern_nogrid.png"), _file("Tavern_grid.png"), "map") == ("gridless", "")


class TestStorage:
    def test_round_trips(self, clear_rules):
        db = SessionLocal()
        saved = vr.save_rules(db, [{"match": "prefix", "value": "GL_", "kind": "gridless"}])
        assert vr.load_rules(db) == saved
        # Saving again replaces the row rather than adding one.
        vr.save_rules(db, [])
        assert vr.load_rules(db) == []
        db.close()

    def test_a_corrupt_setting_reads_as_no_rules(self, clear_rules):
        db = SessionLocal()
        db.add(AppSetting(key=vr.SETTING_KEY, value=json.dumps([{"match": "regex"}])))
        db.commit()
        assert vr.load_rules(db) == []
        db.query(AppSetting).filter_by(key=vr.SETTING_KEY).update({"value": "{not json"})
        db.commit()
        assert vr.load_rules(db) == []
        db.close()


class TestEndpoints:
    def test_get_and_put(self, client, admin_headers, clear_rules):
        assert client.get("/api/naming/variant-rules", headers=admin_headers).json() == {"rules": []}
        body = {"rules": [{"match": "prefix", "value": "GL_", "kind": "gridless", "collection": "map"}]}
        r = client.put("/api/naming/variant-rules", json=body, headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["rules"] == [_rule("prefix", "GL_", "gridless", collection="map")]
        assert client.get("/api/naming/variant-rules", headers=admin_headers).json() == r.json()

    def test_put_rejects_an_invalid_rule(self, client, admin_headers, clear_rules):
        body = {"rules": [{"match": "token", "value": "x"}]}
        r = client.put("/api/naming/variant-rules", json=body, headers=admin_headers)
        assert r.status_code == 400
        assert "kind, a label" in r.json()["detail"]

    def test_admin_only(self, client, gm_headers):
        assert client.get("/api/naming/variant-rules", headers=gm_headers).status_code == 403
