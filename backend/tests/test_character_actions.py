"""`actions` on a sheet: named buttons that change several values at once.

A rest is the case they were made for - every "used" counter that recovers on
that rest back to nought, hit points to their maximum - and a level gained as
a new row of a list. The server only checks them; the sheet works them out.
"""
import pytest

from backend.services import characters as svc


def _schema(actions, layout_html=None):
    document = {
        "id": "rest-demo",
        "name": "Rest Demo",
        "fields": {
            "hp": {"type": "number"},
            "hp_max": {"type": "number"},
            "notes": {"type": "textarea"},
            "skills": {"type": "multiselect", "options": ["a", "b"]},
            "resources": {
                "type": "list",
                "columns": [
                    {"key": "name", "type": "text"},
                    {"key": "used", "type": "number"},
                    {"key": "recovery", "type": "select", "options": ["short", "long"]},
                ],
            },
            "items": {
                "type": "content_list",
                "content_type": "item",
                "per_entry_fields": {"charges_used": {"type": "number"}},
            },
            "portrait_art": {"type": "image"},
        },
        "computed": {"level": {"formula": "hp_max + 1"}},
        "content_types": {
            "item": {"fields": {"name": {"type": "text"}, "charges": {"type": "number"}}}
        },
        "actions": actions,
    }
    if layout_html is not None:
        document["layout_html"] = layout_html
    return svc.validate_schema(document)


LONG_REST = {
    "name": "long_rest",
    "label": "Long rest",
    "confirm": "Take a long rest?",
    "steps": [
        {"set": "hp", "to": "hp_max"},
        {"each": "resources", "set": {"used": "0"}},
        {"each": "items", "where": "row.charges > 0", "set": {"charges_used": "0"}},
        {"append": "resources", "values": {"name": "'Level'", "used": "level - 1"}},
    ],
}


def test_valid_actions_are_kept():
    document = _schema([LONG_REST])
    assert document["actions"] == [LONG_REST]


def test_each_reads_row_and_where_is_optional():
    _schema([{"name": "short", "label": "Short", "steps": [
        {"each": "resources", "where": "row.recovery == 'short'", "set": {"used": "row.used - 1"}},
    ]}])


@pytest.mark.parametrize(
    "actions, message",
    [
        ({}, "'actions' must be a list"),
        ([{"label": "x", "steps": [{"set": "hp", "to": "1"}]}], "needs a 'name'"),
        ([{"name": "a", "label": "x", "steps": [{"set": "hp", "to": "1"}]}] * 2, "Two actions"),
        ([{"name": "a", "steps": [{"set": "hp", "to": "1"}]}], "needs a 'label'"),
        ([{"name": "a", "label": "x", "confirm": "", "steps": [{"set": "hp", "to": "1"}]}], "'confirm'"),
        ([{"name": "a", "label": "x", "steps": []}], "non-empty list of 'steps'"),
        ([{"name": "a", "label": "x", "steps": [{"to": "1"}]}], "exactly one of"),
        ([{"name": "a", "label": "x", "steps": [{"each": "resources", "append": "resources"}]}], "exactly one of"),
        ([{"name": "a", "label": "x", "steps": [{"set": "nope", "to": "1"}]}], "unknown field 'nope'"),
        ([{"name": "a", "label": "x", "steps": [{"set": "skills", "to": "1"}]}], "a multiselect"),
        ([{"name": "a", "label": "x", "steps": [{"set": "resources", "to": "1"}]}], "a list"),
        ([{"name": "a", "label": "x", "steps": [{"set": "hp", "to": "missing + 1"}]}], "unknown name: missing"),
        ([{"name": "a", "label": "x", "steps": [{"set": "hp", "to": "row.used"}]}], "unknown name: row"),
        ([{"name": "a", "label": "x", "steps": [{"set": "hp", "to": "(("}]}], "not a valid expression"),
        ([{"name": "a", "label": "x", "steps": [{"set": "notes", "to": "portrait_art"}]}], "image"),
        ([{"name": "a", "label": "x", "steps": [{"each": "hp", "set": {"used": "0"}}]}], "not a list or a content_list"),
        ([{"name": "a", "label": "x", "steps": [{"each": "resources", "set": {"nope": "0"}}]}], "does not have"),
        ([{"name": "a", "label": "x", "steps": [{"each": "resources", "set": {}}]}], "column formulas"),
        ([{"name": "a", "label": "x", "steps": [{"each": "resources", "where": "row.x ==", "set": {"used": "0"}}]}], "not a valid expression"),
        ([{"name": "a", "label": "x", "steps": [{"each": "items", "set": {"used": "0"}}]}], "does not have"),
        ([{"name": "a", "label": "x", "steps": [{"append": "items", "values": {"charges_used": "0"}}]}], "not a list"),
        ([{"name": "a", "label": "x", "steps": [{"append": "resources", "values": {"used": "row.used"}}]}], "unknown name: row"),
    ],
)
def test_bad_actions_are_refused(actions, message):
    with pytest.raises(svc.SchemaError, match=message):
        _schema(actions)


def test_too_many_steps_are_refused():
    steps = [{"set": "hp", "to": "1"}] * 51
    with pytest.raises(svc.SchemaError, match="more than 50 steps"):
        _schema([{"name": "a", "label": "x", "steps": steps}])


def test_g_action_is_a_layout_directive():
    document = _schema(
        [LONG_REST],
        layout_html='<g-action name="long_rest" label="Rest" visible_if="hp &lt; hp_max"></g-action>',
    )
    node = document["layout_ast"][0]
    assert node["tag"] == "g-action"
    assert node["attrs"] == {"name": "long_rest", "label": "Rest", "visible_if": "hp < hp_max"}


# --- a field's on_change and a prompt's on_skip ---------------------------------

def _follow_up_schema(on_change, on_skip=None):
    prompt = {
        "label": "Focus",
        "steps": [{"key": "what", "type": "select", "options": ["Bless", "Hex"]}],
        "apply": [{"set": "focus_on", "to": "answer.what"}],
    }
    if on_skip is not None:
        prompt["on_skip"] = on_skip
    return svc.validate_schema({
        "id": "focus-demo",
        "name": "Focus Demo",
        "fields": {
            "hp": {"type": "number", "on_change": [{"set": "focused", "to": "hp > 0 and focused"}]},
            "focused": {"type": "checkbox", "on_change": on_change},
            "focus_on": {"type": "text"},
        },
        "prompts": {"focus": prompt},
    })


def test_on_change_and_on_skip_are_kept():
    document = _follow_up_schema(
        [{"set": "focus_on", "to": "focused ? focus_on : ''"}, {"prompt": "focus"}],
        [{"set": "focused", "to": "false"}],
    )
    assert document["fields"]["focused"]["on_change"][1] == {"prompt": "focus"}
    assert document["prompts"]["focus"]["on_skip"] == [{"set": "focused", "to": "false"}]


@pytest.mark.parametrize(
    "on_change, on_skip, message",
    [
        ([{"set": "nowhere", "to": "1"}], None, "unknown field"),
        ([{"prompt": "missing"}], None, "unknown prompt"),
        ([{"set": "focus_on", "to": "1 +"}], None, "on_change"),
        ([{"prompt": "focus"}], [{"set": "nowhere", "to": "false"}], "on_skip"),
    ],
)
def test_bad_follow_ups_are_refused(on_change, on_skip, message):
    with pytest.raises(svc.SchemaError, match=message):
        _follow_up_schema(on_change, on_skip)
