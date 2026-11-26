"""Paged prompts and the `entries` step.

A level gained with many steps - a subclass, an ability increase or a feat,
spells - is shown a page at a time, and a page can be skipped to be chosen
later, through another of the sheet's prompts. A spell list asks for several
catalog entries in one step. The server only checks the shape; the sheet
pages, filters and picks.
"""
import pytest

from backend.services import characters as svc

from .test_character_prompts import LEVEL_UP, LINEAGE, _document, _validate

SPELLS = {
    "key": "spells",
    "type": "entries",
    "label": "Spells learned",
    "content_type": "feat",
    "count": "level - 2",
    "filters": {"category": "General"},
    "filter": "entry.level <= level and not has_ref(feats, entry._ref)",
}

PAGED = {
    **LEVEL_UP,
    "paged": True,
    "pages": {
        "improvement": {"label": "Improvement", "later": "lineage"},
        "spells": {"label": "Spells"},
    },
    "steps": [
        LEVEL_UP["steps"][0],
        {**LEVEL_UP["steps"][1], "page": "improvement"},
        {**LEVEL_UP["steps"][2], "page": "improvement"},
        {**LEVEL_UP["steps"][3], "page": "improvement"},
        {**SPELLS, "page": "spells"},
    ],
    "apply": [
        {
            "pick": "feats",
            "entry": "answer.spells",
            "values": {"from_level": "level + entry.level"},
        },
        {"unpick": "feats", "entry": "answer.spells"},
    ],
}


def _prompts(level_up):
    return {"level_up": level_up, "lineage": LINEAGE}


def test_a_paged_prompt_with_an_entries_step_is_accepted():
    validated = _validate(_document(_prompts(PAGED)))
    assert validated["prompts"]["level_up"]["pages"]["improvement"]["later"] == "lineage"


def test_an_entries_count_may_be_a_number():
    _validate(_document(_prompts({**PAGED, "pages": {}, "steps": [{**SPELLS, "count": 3}]})))


def test_a_pick_value_reads_the_entry_picked():
    prompts = _prompts(
        {
            **LEVEL_UP,
            "apply": [{"pick": "feats", "entry": "answer.feat", "values": {"from_level": "entry.level"}}],
        }
    )
    _validate(_document(prompts))


def test_entry_is_unknown_outside_a_pick_value():
    prompts = _prompts({**LEVEL_UP, "apply": [{"set": "level", "to": "entry.level"}]})
    with pytest.raises(svc.SchemaError, match="unknown name"):
        _validate(_document(prompts))


def _paged(**changes):
    return _prompts({**PAGED, **changes})


def _step(**changes):
    return _paged(steps=[LEVEL_UP["steps"][0], {**SPELLS, "page": "spells", **changes}], pages={})


@pytest.mark.parametrize(
    ("prompts", "message"),
    [
        (_step(count=0), "'count'"),
        (_step(count=21), "'count'"),
        (_step(count=True), "'count'"),
        (_step(count="nowhere"), "unknown name"),
        (_step(content_type="spell"), "unknown content type"),
        (_step(filters={"level": True}), "fixed values"),
        (_step(filter="entry.level <"), "spells"),
        (_step(page="two words"), "valid identifier"),
        (_step(page=3), "valid identifier"),
        (_paged(paged="yes"), "'paged'"),
        (_prompts({**PAGED, "paged": False}), "only a paged prompt"),
        (_prompts({**LEVEL_UP, "pages": {}}), "only a paged prompt"),
        (_paged(pages=[]), "'pages'"),
        (_paged(pages={"nowhere": {"label": "Lost"}}), "not the 'page' of any"),
        (_paged(pages={"spells": "Spells"}), "page 'spells'"),
        (_paged(pages={"spells": {"label": ""}}), "label"),
        (_paged(pages={"spells": {"later": "nowhere"}}), "unknown prompt"),
        (_paged(pages={"spells": {"later": ["lineage"]}}), "unknown prompt"),
        (_paged(pages={"spells": {"later": "level_up"}}), "another prompt"),
    ],
)
def test_a_broken_paged_prompt_is_refused(prompts, message):
    with pytest.raises(svc.SchemaError, match=message):
        _validate(_document(prompts))


def test_entries_is_listed_among_the_step_types():
    with pytest.raises(svc.SchemaError, match="entries"):
        _validate(_document(_prompts({**LEVEL_UP, "steps": [{"key": "x", "type": "dice"}]})))
