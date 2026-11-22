"""A compendium reads what a page shows, not every entry of the type.

Opening one entry used to read every entry of its type and pick one out in
Python, and turning a page read every entry whole to sort, filter and count
facets. Now an entry is looked up by its id, and a browse reads only the few
JSON values the sort, filters and facets name for each entry, reading whole
only the page it returns. These pin that down with a pack of thousands of
entries, and check the answers are the same as reading everything whole.
"""
import random
import uuid
from contextlib import contextmanager
from typing import Any, Iterator

import pytest
from sqlalchemy import event, insert

from backend.config import SessionLocal
from backend.models import (
    CharacterSchema,
    ContentEntry,
    ContentPack,
    GameSystem,
    Ruleset,
    RulesetEntry,
    SystemCharacterSheet,
    SystemContentPack,
)
from backend.services import json_fields
from backend.services.characters import compendium, packs

from .conftest import make_game_system

SHEET_ID = "compendium-scale"

SPELL = {
    "label": "Spell",
    "label_plural": "Spells",
    "identity_field": "name",
    "sort_default": ["level", "name"],
    "search_fields": ["name", "description"],
    "filter_fields": ["level", "school", "ritual", "classes", "subclass"],
    "filter_depends": {"subclass": "classes"},
    "compact_display": "{school} {level}",
    "fields": {
        "name": {"type": "text"},
        "level": {"type": "number"},
        "school": {"type": "text"},
        "ritual": {"type": "checkbox"},
        "classes": {"type": "text"},
        "subclass": {"type": "text"},
        "description": {"type": "textarea"},
        "meta": {"type": "text"},
    },
}
SHEET = {
    "id": SHEET_ID,
    "name": "Scale Sheet",
    "system": "Scale RPG",
    "content_types": {"spell": SPELL},
    "fields": {"spells": {"type": "content_list", "content_type": "spell"}},
}

NAMES = ["Fireball", "fireball", "Éclair", "éclair", "Ångström", "Zap", "zap", "Bolt", "Ice", ""]
SCHOOLS = ["Evocation", "evocation", "Abjuration", "Illusion", "", None]
CLASSES = ["Wizard", "Cleric", "Bard"]


def _spell(rng: random.Random, index: int) -> dict[str, Any]:
    """An entry as a pack might author it: mixed types, gaps and all."""
    data: dict[str, Any] = {"name": f"{rng.choice(NAMES)} {index % 7}"}
    level = rng.choice([0, 1, 3, 3, 9, "3", 2.5, None, True, "missing"])
    if level != "missing":
        data["level"] = level
    school = rng.choice(SCHOOLS)
    if school is not None:
        data["school"] = school
    ritual = rng.choice([True, False, "missing"])
    if ritual != "missing":
        data["ritual"] = ritual
    classes = rng.choice([[], ["Wizard"], ["Wizard", "Cleric"], "Bard", None])
    if classes is not None:
        data["classes"] = classes
    if rng.random() < 0.3:
        data["subclass"] = rng.choice(["Evoker", "Life", "Lore"])
    if rng.random() < 0.2:
        data["meta"] = {"page": index, "tags": ["a", True]}
    data["description"] = rng.choice(
        ["A bright streak of fire.", "A shimmering barrier.", "Ice and frost.", "Thunder!"]
    )
    return data


def _add_entries(db, pack: ContentPack, start: int, count: int, *, index_search: bool) -> None:
    rng = random.Random(start)
    rows = []
    for index in range(start, start + count):
        data = _spell(rng, index)
        rows.append({
            "id": str(uuid.uuid4()),
            "pack_id": pack.id,
            "schema_id": SHEET_ID,
            "content_type": "spell",
            "entry_id": f"spell-{index}",
            "source": "srd",
            "name": str(data.get("name") or f"spell-{index}"),
            "data": data,
        })
    # A type nobody declares, whose definition is inferred from its entries.
    for index in range(start, start + max(1, count // 50)):
        rows.append({
            "id": str(uuid.uuid4()),
            "pack_id": pack.id,
            "schema_id": SHEET_ID,
            "content_type": "rule",
            "entry_id": f"rule-{index}",
            "source": "srd",
            "name": f"Rule {index % 5}",
            "data": {"name": f"Rule {index % 5}", "bonus": index % 3, "flag": index % 2 == 0},
        })
    db.execute(insert(ContentEntry), rows)
    pack.entry_count = (pack.entry_count or 0) + len(rows)
    if index_search:
        packs.reindex_entry_search(db, pack, SHEET)
    db.commit()


@pytest.fixture
def shelf(client, admin_headers, admin_id):
    """A system linked to one pack and the server-wide sheet that describes it."""
    response = client.post(
        "/api/characters/schemas", json={"document": SHEET}, headers=admin_headers,
        params={"server_wide": "true"},
    )
    assert response.status_code == 200, response.text
    system = make_game_system()
    db = SessionLocal()
    try:
        pack = ContentPack(pack_id=f"scale-{uuid.uuid4().hex[:8]}", schema_id=SHEET_ID,
                           name="Scale SRD")
        db.add(pack)
        db.flush()
        db.add(SystemContentPack(game_system_id=system.id, pack_id=pack.pack_id))
        db.add(SystemCharacterSheet(game_system_id=system.id, schema_id=SHEET_ID))
        db.commit()
        yield {"system_id": system.id, "pack_row": pack.id, "pack_id": pack.pack_id,
               "user_id": admin_id}
    finally:
        db.rollback()
        db.execute(packs.text("DELETE FROM content_search WHERE pack_row = :p"),
                   {"p": pack.id})
        db.query(ContentEntry).filter_by(pack_id=pack.id).delete()
        db.query(ContentPack).filter_by(id=pack.id).delete()
        db.query(SystemContentPack).filter_by(game_system_id=system.id).delete()
        db.query(SystemCharacterSheet).filter_by(game_system_id=system.id).delete()
        db.query(RulesetEntry).filter_by(schema_id=SHEET_ID).delete()
        db.query(Ruleset).filter_by(schema_id=SHEET_ID).delete()
        db.query(CharacterSchema).filter_by(schema_id=SHEET_ID).delete()
        db.query(GameSystem).filter_by(id=system.id).delete()
        db.commit()
        db.close()


def _fill(shelf, count: int, *, start: int = 0, index_search: bool = False) -> None:
    db = SessionLocal()
    try:
        pack = db.query(ContentPack).filter_by(id=shelf["pack_row"]).one()
        _add_entries(db, pack, start, count, index_search=index_search)
    finally:
        db.close()


def _add_rulesets(shelf) -> str:
    """A ruleset imported from the pack: one unchanged copy, one variant, one new."""
    db = SessionLocal()
    try:
        ruleset = Ruleset(name="SRD copy", schema_id=SHEET_ID, source_pack_id=shelf["pack_id"])
        db.add(ruleset)
        db.flush()
        original = db.query(ContentEntry).filter_by(
            pack_id=shelf["pack_row"], entry_id="spell-1"
        ).one()
        db.add_all([
            RulesetEntry(ruleset_id=ruleset.id, schema_id=SHEET_ID, content_type="spell",
                         entry_id="spell-1", name=original.name, data=dict(original.data)),
            RulesetEntry(ruleset_id=ruleset.id, schema_id=SHEET_ID, content_type="spell",
                         entry_id="spell-2", name="Fireball 2",
                         data={"name": "Fireball 2", "level": 4, "school": "Evocation",
                               "classes": ["Wizard"], "description": "House fire."}),
            RulesetEntry(ruleset_id=ruleset.id, schema_id=SHEET_ID, content_type="spell",
                         entry_id="house-only", name="Zap 9",
                         data={"name": "Zap 9", "level": 1, "ritual": True}),
        ])
        db.commit()
        return ruleset.id
    finally:
        db.close()


@contextmanager
def _counted(db) -> Iterator[dict[str, Any]]:
    """Count the statements ``db`` sends and the whole pack entries it reads."""
    seen: dict[str, Any] = {"statements": [], "entries": 0}
    conn = db.connection()

    def record(_conn, _cursor, statement, *_args):
        seen["statements"].append(statement)

    def loaded(_target, _context):
        seen["entries"] += 1

    event.listen(conn, "before_cursor_execute", record)
    event.listen(ContentEntry, "load", loaded)
    try:
        yield seen
    finally:
        event.remove(conn, "before_cursor_execute", record)
        event.remove(ContentEntry, "load", loaded)


def _comp(db, shelf) -> compendium.Compendium:
    system = db.query(GameSystem).filter_by(id=shelf["system_id"]).one()
    return compendium.load(db, system, shelf["user_id"])


def _browse(shelf, content_type: str = "spell", **params) -> tuple[dict, dict]:
    db = SessionLocal()
    try:
        comp = _comp(db, shelf)
        with _counted(db) as seen:
            body = compendium.browse(db, comp, content_type, **params)
        return body, {"statements": len(seen["statements"]), "entries": seen["entries"],
                      "sql": seen["statements"]}
    finally:
        db.close()


def _find(shelf, entry_id: str, origin=None, content_type: str = "spell") -> tuple[Any, dict]:
    db = SessionLocal()
    try:
        comp = _comp(db, shelf)
        with _counted(db) as seen:
            body = compendium.find_entry(db, comp, content_type, entry_id, origin)
        return body, {"statements": len(seen["statements"]), "entries": seen["entries"],
                      "sql": seen["statements"]}
    finally:
        db.close()


# --- at scale ---------------------------------------------------------------


class TestAtScale:
    def test_opening_an_entry_reads_that_entry_alone(self, shelf):
        _fill(shelf, 5000)
        _add_rulesets(shelf)
        body, before = _find(shelf, "spell-4321")
        assert body["entry_id"] == "spell-4321"
        assert before["entries"] == 1
        # Every statement that reads pack entries asks for this one by id.
        reads = [sql for sql in before["sql"] if "FROM content_entries" in sql]
        assert reads and all("entry_id = " in sql for sql in reads)

        # Doubling the pack changes neither what is read nor how often.
        _fill(shelf, 5000, start=5000)
        _body, after = _find(shelf, "spell-4321")
        assert (after["statements"], after["entries"]) == (before["statements"], 1)

    def test_a_page_reads_only_its_own_entries_whole(self, shelf):
        _fill(shelf, 5000)
        body, before = _browse(shelf, page=3, page_size=40)
        assert body["total"] == 5000
        assert len(body["entries"]) == 40
        assert before["entries"] == 40
        # The scan over the whole type never fetches an entry's whole document.
        scans = [sql for sql in before["sql"]
                 if "FROM content_entries" in sql and "content_entries.id IN" not in sql]
        assert scans and not any("content_entries.data AS" in sql for sql in scans)

        _fill(shelf, 5000, start=5000)
        body, after = _browse(shelf, page=3, page_size=40)
        assert body["total"] == 10000
        assert (after["statements"], after["entries"]) == (before["statements"], 40)

    def test_filters_and_search_read_only_the_page(self, shelf):
        _fill(shelf, 5000, index_search=True)
        body, seen = _browse(shelf, search="fire", filters={"classes": "wizard"})
        assert body["total"] > 50
        assert seen["entries"] == 50

    def test_an_inferred_type_reads_its_sample_and_its_page(self, shelf):
        _fill(shelf, 5000)
        body, seen = _browse(shelf, "rule", page_size=20)
        assert body["total"] == 100
        assert body["content_type"]["fields"]["bonus"]["type"] == "number"
        assert seen["entries"] <= compendium._INFER_SAMPLE + 20


# --- same answers -------------------------------------------------------------


BROWSES: list[dict[str, Any]] = [
    {},
    {"page": 2, "page_size": 7},
    {"page": 999},
    {"sort": "school,name"},
    {"sort": "ritual, classes"},
    {"sort": "meta"},
    {"filters": {"school": "evocation"}},
    {"filters": {"classes": "wizard"}},
    {"filters": {"classes": "Wizard", "subclass": "evoker"}},
    {"filters": {"subclass": "Life"}},
    {"filters": {"level": "3", "school": "Evocation"}},
    {"filters": {"level": "2.5"}},
    {"filters": {"ritual": "yes"}},
    {"filters": {"school": "necromancy"}},
    {"filters": {"description": "thunder!"}},
    {"filters": {"odd key": "x"}},
    {"search": "fire"},
    {"search": "fire", "filters": {"level": "3"}, "page_size": 5},
    {"search": "zz-nothing"},
]


def _whole_reads(monkeypatch) -> None:
    """Read every entry whole, as the compendium did before."""
    monkeypatch.setattr(compendium, "_projectable", lambda _keys: False)


class TestSameAnswers:
    @pytest.fixture
    def filled(self, shelf):
        _fill(shelf, 400, index_search=True)
        ruleset_id = _add_rulesets(shelf)
        return {**shelf, "ruleset_id": ruleset_id}

    @pytest.mark.parametrize("params", BROWSES)
    def test_browse_matches_reading_everything(self, filled, monkeypatch, params):
        fast, _ = _browse(filled, **params)
        with monkeypatch.context() as patch:
            _whole_reads(patch)
            slow, _ = _browse(filled, **params)
        assert fast == slow

    @pytest.mark.parametrize("params", [{}, {"sort": "bonus,flag"}, {"filters": {"flag": "yes"}}])
    def test_inferred_browse_matches_reading_everything(self, filled, monkeypatch, params):
        fast, _ = _browse(filled, "rule", **params)
        with monkeypatch.context() as patch:
            _whole_reads(patch)
            slow, _ = _browse(filled, "rule", **params)
        assert fast == slow

    def test_a_ruleset_copy_shows_once_and_a_variant_beside_it(self, filled):
        body, _ = _browse(filled, page_size=200, filters={"classes": "wizard"})
        ids = [(row["entry_id"], row["ruleset"]) for row in body["entries"]]
        assert ("spell-1", True) not in ids
        variant = next(row for row in body["entries"]
                       if row["entry_id"] == "spell-2" and row["ruleset"])
        assert variant["data"]["description"] == "House fire."

    def test_find_entry_picks_by_origin(self, filled):
        ruleset = f"ruleset:{filled['ruleset_id']}"
        pack_copy, _ = _find(filled, "spell-2")
        assert pack_copy["origin"] == filled["pack_id"]
        house, _ = _find(filled, "spell-2", origin=ruleset)
        assert house["data"]["description"] == "House fire."
        assert house["type_definition"]["label"] == "Spell"
        only_pack, _ = _find(filled, "spell-2", origin=filled["pack_id"])
        assert only_pack["origin"] == filled["pack_id"]
        # The unchanged copy is hidden, even asked for by its ruleset.
        assert _find(filled, "spell-1", origin=ruleset)[0] is None
        # Only the ruleset has it, so without an origin it is the ruleset's.
        assert _find(filled, "house-only")[0]["origin"] == ruleset
        assert _find(filled, "house-only", origin=filled["pack_id"])[0] is None
        assert _find(filled, "spell-2", origin="no-such-pack")[0] is None
        assert _find(filled, "spell-2", content_type="rule")[0] is None
        assert _find(filled, "rule-3", content_type="rule")[0]["data"]["bonus"] == 0

    def test_browse_over_http_still_works(self, client, admin_headers, filled):
        url = f"/api/systems/{filled['system_id']}/compendium/spell"
        response = client.get(url, params={"filter[school]": "Abjuration", "page_size": 3},
                              headers=admin_headers)
        assert response.status_code == 200, response.text
        body = response.json()
        assert len(body["entries"]) == 3
        assert all(row["data"]["school"] == "Abjuration" for row in body["entries"])


# --- reading JSON values ----------------------------------------------------------


class TestJsonFields:
    def test_values_keep_their_json_types(self, shelf):
        _fill(shelf, 30)
        db = SessionLocal()
        try:
            keys = ["level", "ritual", "classes", "meta", "absent"]
            columns, decode = json_fields.select_keys(db, ContentEntry.data, keys)
            rows = (
                db.query(ContentEntry.data, *columns)
                .filter(ContentEntry.pack_id == shelf["pack_row"])
                .all()
            )
            assert rows
            for row in rows:
                assert decode(row[1:]) == {key: row[0].get(key) for key in keys}
            # One key reads the same way as several.
            single, decode_one = json_fields.select_keys(db, ContentEntry.data, ["ritual"])
            for data, value in db.query(ContentEntry.data, *single).filter(
                ContentEntry.pack_id == shelf["pack_row"]
            ):
                assert decode_one([value]) == {"ritual": data.get("ritual")}
        finally:
            db.close()

    def test_no_keys_selects_nothing(self):
        db = SessionLocal()
        try:
            columns, decode = json_fields.select_keys(db, ContentEntry.data, [])
            assert columns == [] and decode([]) == {}
        finally:
            db.close()

    def test_a_key_needing_quotes_is_refused(self):
        assert json_fields.can_select("level")
        assert not json_fields.can_select('le"vel')
        assert not json_fields.can_select("odd key")
        assert not json_fields.can_select(3)
        with pytest.raises(ValueError):
            json_fields.select_keys(None, ContentEntry.data, ["odd key"])

    @pytest.mark.parametrize("dialect,found", [
        ("sqlite", ['[1, true]', [1, True]]),
        ("postgresql", ['{"a": 1, "b": true}', {"a": 1, "b": True}, {"a": 1, "b": True, "c": 0}]),
    ])
    def test_each_dialect_decodes_its_shape(self, dialect, found):
        decode = json_fields.select_keys(_Bind(dialect), ContentEntry.data, ["a", "b"])[1]
        for value in found:
            assert decode([value]) == {"a": 1, "b": True}
        # A missing or non-object document has none of the keys.
        for empty in ([None], [], ["3"]):
            assert decode(empty) == {"a": None, "b": None}

    def test_a_document_that_is_not_an_object_reads_as_empty(self, shelf):
        db = SessionLocal()
        try:
            pack = db.query(ContentPack).filter_by(id=shelf["pack_row"]).one()
            for index, data in enumerate([[1, 2], "text", None]):
                db.add(ContentEntry(pack_id=pack.id, schema_id=SHEET_ID, content_type="odd",
                                    entry_id=f"odd-{index}", name="Odd", data=data))
            db.commit()
            columns, decode = json_fields.select_keys(db, ContentEntry.data, ["a", "b"])
            rows = db.query(*columns).filter(ContentEntry.content_type == "odd").all()
            assert [decode(row) for row in rows] == [{"a": None, "b": None}] * 3
        finally:
            db.close()


class _Bind:
    """Just enough of an engine for ``is_postgres`` to name a dialect."""

    def __init__(self, name: str) -> None:
        self.dialect = type("Dialect", (), {"name": name})()
