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
        (_with_step({"key": "x", "type": "choose", "target": ["skills"]}), "multiselect"),
        (_with_step({"key": "x", "type": "choose", "target": {}}), "multiselect"),
        (_with_step({"key": "x", "type": "entry", "content_type": ["feat"]}), "unknown content type"),
        (_with_step({"key": "x", "type": "entry", "content_type": {}}), "unknown content type"),
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
        (_with_apply({"grant": "feats", "from": "'a'", "carry": {"name": "'b'"}}), "'names' sets"),
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
            "carry": {"level": "1"},
            "source": "species",
        }
    )
    _validate(_document(prompts))
    _validate(_document(_with_apply({"grant": "skills", "from": "answer.skills"})))


@pytest.mark.parametrize(
    "grant",
    [
        {"grant": "feats", "from": "origin"},
        {"grant": "feats", "from": "'a'", "names": "concat(origin, '')"},
        {"grant": "feats", "from": "'a'", "carry": {"level": "len(feats)"}},
    ],
)
def test_a_grant_may_not_read_a_field_its_prompt_picks(grant):
    # Worked out as the prompt opened, it would read the entry being replaced.
    prompts = {
        "level_up": {
            **LEVEL_UP,
            "apply": [
                grant,
                {"pick": "origin", "entry": "answer.feat"},
                {"unpick": "feats", "entry": "answer.feat"},
            ],
        },
        "lineage": LINEAGE,
    }
    with pytest.raises(svc.SchemaError, match="which this prompt picks"):
        _validate(_document(prompts))
    # A sheet installed before the check still loads.
    svc.validate_schema(_document(prompts), stored=True)
    # Another prompt picking the field does not stop this one reading it.
    _validate(_document({"level_up": {**LEVEL_UP, "apply": [grant]}, "lineage": LINEAGE}))


def test_an_unpick_step_takes_a_row_out_of_a_content_list():
    _validate(_document(_with_apply({"unpick": "feats", "entry": "answer.feat"})))
    with pytest.raises(svc.SchemaError, match="not a content_list"):
        _validate(_document(_with_apply({"unpick": "skills", "entry": "answer.feat"})))
    with pytest.raises(svc.SchemaError, match="'entry'"):
        _validate(_document(_with_apply({"unpick": "feats"})))
    document = _document(
        actions=[{"name": "a", "label": "A", "steps": [{"unpick": "feats", "entry": "'x'"}]}]
    )
    with pytest.raises(svc.SchemaError, match="exactly one of"):
        _validate(document)


def test_a_start_prompt_names_a_prompt_and_a_condition():
    prompts = {"level_up": LEVEL_UP, "lineage": LINEAGE}
    _validate(_document(prompts, start_prompt={"prompt": "level_up", "when": "level == 0"}))
    _validate(_document(prompts, start_prompt={"prompt": "lineage"}))
    with pytest.raises(svc.SchemaError, match="unknown prompt"):
        _validate(_document(prompts, start_prompt={"prompt": "nowhere"}))
    with pytest.raises(svc.SchemaError, match="start_prompt"):
        _validate(_document(prompts, start_prompt={"prompt": "lineage", "when": "missing + 1"}))


@pytest.mark.parametrize("name", [[], {}, 1, None, True])
def test_a_start_prompt_that_is_not_text_is_refused(name):
    with pytest.raises(svc.SchemaError, match="unknown prompt"):
        _validate(_document(start_prompt={"prompt": name}))


@pytest.mark.parametrize("per_entry", [False, True])
def test_a_content_picker_must_pick_from_a_declared_content_type(per_entry):
    def with_picker(content_type):
        picker = {"type": "content_ref", "content_type": content_type}
        document = _document()
        document["fields"]["x"] = (
            {"type": "content_list", "content_type": "feat", "per_entry_fields": {"y": picker}}
            if per_entry
            else picker
        )
        return document

    _validate(with_picker("feat"))
    with pytest.raises(svc.SchemaError, match="does not define"):
        _validate(with_picker("spell"))


def test_a_stored_schema_keeps_a_per_entry_picker_naming_no_content_type():
    # Installed before per-entry pickers were checked: it still loads, rather
    # than coming back as an empty sheet. A top-level one was always refused.
    document = _document()
    document["fields"]["x"] = {
        "type": "content_list",
        "content_type": "feat",
        "per_entry_fields": {"y": {"type": "content_ref", "content_type": "spell"}},
    }
    validated = svc.validate_schema(document, stored=True)
    assert "x" in validated["fields"]
    document["fields"]["z"] = {"type": "content_ref", "content_type": "spell"}
    with pytest.raises(svc.SchemaError, match="does not define"):
        svc.validate_schema(document, stored=True)


def test_a_step_label_may_be_a_formula():
    step = {"key": "x", "type": "number", "label": "X", "label_formula": "concat('Level ', level)"}
    _validate(_document(_with_step(step)))
    with pytest.raises(svc.SchemaError, match="label_formula"):
        _validate(_document(_with_step({**step, "label_formula": "missing + 1"})))


def test_grant_belongs_to_prompts_only():
    document = _document(
        actions=[{"name": "a", "label": "A", "steps": [{"grant": "skills", "from": "'a'"}]}]
    )
    with pytest.raises(svc.SchemaError, match="exactly one of"):
        _validate(document)


@pytest.mark.parametrize("kind", [[], {}, 1, None, True])
def test_a_step_type_that_is_not_text_is_refused(kind):
    with pytest.raises(svc.SchemaError, match="'type'"):
        _validate(_document(_with_step({"key": "x", "type": kind})))


def test_a_step_type_that_is_not_text_is_a_400(client, player_headers):
    document = {
        "id": "d",
        "name": "D",
        "fields": {"hp": {"type": "number"}},
        "prompts": {
            "p": {
                "label": "P",
                "steps": [{"key": "k", "type": []}],
                "apply": [{"set": "hp", "to": "1"}],
            }
        },
    }
    res = client.post(
        "/api/characters/schemas",
        json={"document": document},
        headers=player_headers,
    )
    assert res.status_code == 400


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


def test_g_action_may_not_open_an_unknown_prompt():
    document = _document(layout_html='<g-action prompt="level_upp" label="Level up"></g-action>')
    with pytest.raises(svc.SchemaError, match="unknown prompt 'level_upp'"):
        _validate(document)


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
            [{"prompt": ["lineage"]}],
            [{"prompt": {"lineage": 1}}],
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
