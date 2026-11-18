"""`prompts` on a sheet: windows asking the player a few questions.

A level gained is the case they were made for - the hit points rolled, then
an ability increase or a feat picked from the catalog - and the choices a
pick asks for, such as a species' lineage. The server only checks them and
keeps the list of prompts the player put off; the sheet asks and writes.
"""
import pytest

from backend.routers.characters.core import _coerce_pending_prompts
from backend.services import characters as svc

LEVEL_UP = {
    "label": "Level up",
    "steps": [
        {"key": "hp", "type": "number", "label": "Hit points", "average": "hit_die / 2 + 1", "min": 0},
        {
            "key": "kind",
            "type": "select",
            "options": [{"value": "asi", "label": "Ability Score Improvement"}, "feat"],
            "visible_if": "level >= 3",
        },
        {
            "key": "asi",
            "type": "distribute",
            "options": ["str", "dex"],
            "patterns": ["2", "1,1"],
            "visible_if": "answer.kind == 'asi'",
        },
        {
            "key": "feat",
            "type": "entry",
            "content_type": "feat",
            "filters": {"category": "General"},
            "filter": "entry.level <= level and not has_ref(feats, entry._ref)",
            "visible_if": "answer.kind == 'feat'",
        },
        {"key": "skills", "type": "choose", "target": "skills", "count": "row.skill_count"},
    ],
    "apply": [
        {"set": "hp_max", "to": "hp_max + answer.hp"},
        {"set": "str", "to": "str + answer.asi.str"},
        {"append": "advancements", "values": {"level": "level", "hp": "answer.hp"}},
        {"add": "skills", "values": "answer.skills"},
        {"pick": "feats", "entry": "answer.feat", "values": {"from_level": "level"}},
        {"pick": "origin", "entry": "answer.feat"},
        {"prompt": "lineage"},
    ],
}

LINEAGE = {
    "label": "Lineage",
    "steps": [{"key": "pick", "type": "select", "options": "row.lineages"}],
    "apply": [{"set": "lineage", "to": "answer.pick"}],
}


def _document(prompts=None, **extra):
    document = {
        "id": "prompt-demo",
        "name": "Prompt Demo",
        "fields": {
            "level": {"type": "number"},
            "hit_die": {"type": "number"},
            "hp_max": {"type": "number"},
            "str": {"type": "number"},
            "lineage": {"type": "select", "options": ["a", "b"]},
            "skills": {"type": "multiselect", "options": ["a", "b"]},
            "advancements": {
                "type": "list",
                "columns": [{"key": "level", "type": "number"}, {"key": "hp", "type": "number"}],
            },
            "feats": {
                "type": "content_list",
                "content_type": "feat",
                "per_entry_fields": {"from_level": {"type": "number"}},
            },
            "origin": {"type": "content_ref", "content_type": "feat"},
            "species": {
                "type": "content_ref",
                "content_type": "feat",
                "on_pick": [{"prompt": "lineage"}],
            },
        },
        "content_types": {
            "feat": {"fields": {"name": {"type": "text"}, "level": {"type": "number"}}}
        },
        "prompts": {"level_up": LEVEL_UP, "lineage": LINEAGE} if prompts is None else prompts,
    }
    document.update(extra)
    return document


def _validate(document):
    return svc.validate_schema(document)


def test_a_prompt_with_every_kind_of_step_is_accepted():
    validated = _validate(_document())
    assert set(validated["prompts"]) == {"level_up", "lineage"}


def test_an_action_and_a_rule_may_open_a_prompt():
    document = _document(
        actions=[{"name": "gain", "label": "Gain a level", "steps": [{"prompt": "level_up"}]}]
    )
    _validate(document)


def _with_step(step):
    return {"level_up": {**LEVEL_UP, "steps": [step]}, "lineage": LINEAGE}


def _with_apply(apply_step):
    return {"level_up": {**LEVEL_UP, "apply": [apply_step]}, "lineage": LINEAGE}


@pytest.mark.parametrize(
    ("prompts", "message"),
    [
        ({"bad-name": LINEAGE, "lineage": LINEAGE}, "valid identifier"),
        ({"lineage": {**LINEAGE, "label": ""}}, "label"),
        ({"lineage": {**LINEAGE, "steps": []}}, "non-empty list of 'steps'"),
        (_with_step({"type": "number"}), "'key'"),
        (_with_step({"key": "x", "type": "dice"}), "'type'"),
        (_with_step({"key": "x", "type": "number", "visible_if": "nowhere > 1"}), "unknown name"),
        (_with_step({"key": "x", "type": "choose"}), "'options' or a multiselect 'target'"),
        (_with_step({"key": "x", "type": "choose", "target": "level"}), "multiselect"),
        (_with_step({"key": "x", "type": "choose", "target": "skills", "count": 0}), "'count'"),
        (_with_step({"key": "x", "type": "distribute", "options": ["a"], "patterns": ["+2"]}), "patterns"),
        (_with_step({"key": "x", "type": "distribute", "options": [], "patterns": ["2"]}), "options"),
        (_with_step({"key": "x", "type": "entry", "content_type": "spell"}), "unknown content type"),
        (
            _with_step({"key": "x", "type": "entry", "content_type": "feat", "filter": "nope"}),
            "unknown name",
        ),
        (_with_step({"key": "x", "type": "number", "min": "low"}), "'min'"),
        (_with_step({"key": "x", "type": "select", "options": [True]}), "options"),
        (_with_apply({"set": "feats", "to": "1"}), "single value"),
        (_with_apply({"add": "level", "values": "answer.x"}), "not a multiselect"),
        (_with_apply({"pick": "skills", "entry": "answer.x"}), "content_ref or a content_list"),
        (
            _with_apply({"pick": "feats", "entry": "answer.x", "values": {"nope": "1"}}),
            "does not have",
        ),
        (_with_apply({"prompt": "nowhere"}), "unknown prompt"),
        (_with_apply({"grant": "level", "from": "'a'"}), "multiselect or a content_list"),
        (_with_apply({"grant": "feats"}), "'from'"),
        (_with_apply({"grant": "feats", "from": "nowhere"}), "unknown name"),
        (_with_apply({"grant": "skills", "from": "'a'", "names": "'a'"}), "content_list target"),
        (_with_apply({"grant": "feats", "from": "'a'", "carry": {"nope": "1"}}), "does not declare"),
        (_with_apply({"grant": "feats", "from": "'a'", "carry": []}), "'carry'"),
        (_with_apply({"grant": "feats", "from": "'a'", "source": "origin"}), "'source'"),
        (_with_apply({"grant": "feats", "from": "'a'", "source": "nowhere"}), "'source'"),
        (_with_apply({"set": "level", "to": "missing + 1"}), "unknown name"),
    ],
)
def test_a_broken_prompt_is_refused(prompts, message):
    with pytest.raises(svc.SchemaError, match=message):
        _validate(_document(prompts))


def test_a_grant_step_reads_formulas_and_records_under_a_pick():
    prompts = _with_apply(
        {
            "grant": "feats",
            "from": "row.feature_ids",
            "names": "row.feature_names",
            "carry": {"name": "'x'"},
            "source": "species",
        }
    )
    _validate(_document(prompts))
    _validate(_document(_with_apply({"grant": "skills", "from": "answer.skills"})))


def test_grant_belongs_to_prompts_only():
    document = _document(
        actions=[{"name": "a", "label": "A", "steps": [{"grant": "skills", "from": "'a'"}]}]
    )
    with pytest.raises(svc.SchemaError, match="exactly one of"):
        _validate(document)


def test_two_steps_may_not_share_a_key():
    step = {"key": "x", "type": "number"}
    with pytest.raises(svc.SchemaError, match="two steps keyed"):
        _validate(_document({"lineage": {**LINEAGE, "steps": [step, step]}}))


def test_add_and_pick_belong_to_prompts_only():
    document = _document(
        actions=[{"name": "a", "label": "A", "steps": [{"add": "skills", "values": "1"}]}]
    )
    with pytest.raises(svc.SchemaError, match="exactly one of"):
        _validate(document)


def test_an_action_may_not_open_an_unknown_prompt():
    document = _document(
        actions=[{"name": "a", "label": "A", "steps": [{"prompt": "nowhere"}]}]
    )
    with pytest.raises(svc.SchemaError, match="unknown prompt"):
        _validate(document)


def test_an_on_pick_rule_may_not_open_an_unknown_prompt():
    document = _document({"level_up": LEVEL_UP, "lineage": {**LINEAGE}})
    document["fields"]["species"]["on_pick"] = [{"prompt": "nowhere"}]
    with pytest.raises(svc.SchemaError, match="unknown prompt"):
        _validate(document)


def test_g_action_may_name_a_prompt():
    document = _document(layout_html='<g-action prompt="level_up" label="Level up"></g-action>')
    validated = _validate(document)
    assert "prompt" in str(validated["layout_ast"])


class TestPendingPrompts:
    document = _document()

    def test_keeps_a_prompt_with_its_pick(self):
        assert _coerce_pending_prompts(
            self.document,
            [{"prompt": "lineage", "source": "species", "ref": "elf"}, {"prompt": "level_up"}],
        ) == [{"prompt": "lineage", "source": "species", "ref": "elf"}, {"prompt": "level_up"}]

    @pytest.mark.parametrize(
        "value",
        [
            [{"prompt": "nowhere"}],
            [{"source": "species"}],
            ["lineage"],
            "not a list",
        ],
    )
    def test_drops_what_the_sheet_does_not_declare(self, value):
        assert _coerce_pending_prompts(self.document, value) == []

    def test_drops_an_unknown_source_and_repeats(self):
        assert _coerce_pending_prompts(
            self.document,
            [
                {"prompt": "lineage", "source": "nowhere", "ref": "elf"},
                {"prompt": "lineage"},
                {"prompt": "lineage", "extra": {"a": 1}},
            ],
        ) == [{"prompt": "lineage"}]

    def test_keeps_at_most_twenty(self):
        many = [{"prompt": "lineage", "source": "species", "ref": str(i)} for i in range(30)]
        assert len(_coerce_pending_prompts(self.document, many)) == 20

    def test_a_sheet_without_prompts_keeps_none(self):
        assert _coerce_pending_prompts({"fields": {}}, [{"prompt": "lineage"}]) == []
