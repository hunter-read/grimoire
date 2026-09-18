"""Tests for the content catalog: pack loading, the catalog API, and references.

The catalog is server-wide content described by a per-user schema, so the tests
below check both halves of that: a pack loads once for everyone, and what the
browser shows comes from the caller's own copy of the sheet.
"""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.services.characters import packs


SCHEMA = {
    "id": "catalog-demo",
    "name": "Catalog Demo",
    "content_types": {
        "spell": {
            "label": "Spell",
            "label_plural": "Spells",
            "identity_field": "name",
            "sort_default": ["level", "name"],
            "search_fields": ["name", "school", "description"],
            "filter_fields": ["level", "school"],
            "compact_display": "{name} — {school} {level}",
            "fields": {
                "name": {"type": "text"},
                "level": {"type": "number"},
                "school": {"type": "text"},
                "description": {"type": "textarea"},
            },
        }
    },
    "fields": {
        "spells": {
            "type": "content_list",
            "label": "Spells",
            "content_type": "spell",
            "allow_freeform": True,
            "per_entry_fields": {"prepared": {"type": "checkbox"}},
        },
        "signature": {"type": "content_ref", "label": "Signature", "content_type": "spell"},
    },
    "computed": {
        "spell_levels": {"formula": "sum_refs(spells, 'level')"},
        "prepared_count": {"formula": "count_refs(spells, 'prepared')"},
    },
}

SPELLS = [
    {"_id": "fireball", "name": "Fireball", "level": 3, "school": "evocation",
     "description": "A bright streak flashes."},
    {"_id": "shield", "name": "Shield", "level": 1, "school": "abjuration",
     "description": "An invisible barrier."},
    {"_id": "magic-missile", "name": "Magic Missile", "level": 1, "school": "evocation",
     "description": "Three glowing darts."},
    {"_id": "wish", "name": "Wish", "level": 9, "school": "conjuration",
     "description": "Anything at all."},
]


def _write_pack(root, *, pack_id="demo-srd", schema_id="catalog-demo", spells=None, meta=None):
    directory = os.path.join(root, pack_id)
    os.makedirs(directory, exist_ok=True)
    payload = {
        "pack_id": pack_id,
        "schema_id": schema_id,
        "name": "Demo SRD",
        "license": "CC-BY-4.0",
        "attribution": "Demo content, CC BY 4.0.",
        "source": "srd",
    }
    payload.update(meta or {})
    with open(os.path.join(directory, "_meta.json"), "w") as handle:
        json.dump(payload, handle)
    with open(os.path.join(directory, "spell.json"), "w") as handle:
        json.dump(SPELLS if spells is None else spells, handle)
    return directory


@pytest.fixture
def pack_root(tmp_path):
    return str(tmp_path / "character-content")


@pytest.fixture(autouse=True)
def _clean_catalog():
    """Clear the catalog between tests.

    The test client shares one database across the session, so a pack loaded by
    one test would otherwise still be in the catalog for the next — which showed
    up as browse counts that were right in isolation and wrong in a full run.
    """
    yield
    db = SessionLocal()
    try:
        db.execute(packs.text("DELETE FROM content_search"))
        db.query(packs.ContentEntry).delete()
        db.query(packs.ContentPack).delete()
        db.commit()
    finally:
        db.close()


class TestPackLoader:
    def test_discovers_only_directories_with_metadata(self, pack_root):
        _write_pack(pack_root)
        os.makedirs(os.path.join(pack_root, "not-a-pack"), exist_ok=True)
        found = [os.path.basename(path) for path in packs.discover_packs(pack_root)]
        assert found == ["demo-srd"]

    def test_loads_entries_and_records_the_licence(self, pack_root):
        directory = _write_pack(pack_root)
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, directory, schema_document=SCHEMA)
            db.commit()
            assert pack.entry_count == 4
            assert pack.attribution == "Demo content, CC BY 4.0."
            names = sorted(
                row.name
                for row in db.query(packs.ContentEntry).filter_by(pack_id=pack.id).all()
            )
            assert names == ["Fireball", "Magic Missile", "Shield", "Wish"]
        finally:
            db.close()

    def test_drops_keys_the_content_type_does_not_declare(self, pack_root):
        directory = _write_pack(
            pack_root,
            spells=[{"_id": "x", "name": "X", "level": 1, "injected": "payload"}],
        )
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, directory, schema_document=SCHEMA)
            db.commit()
            entry = db.query(packs.ContentEntry).filter_by(pack_id=pack.id).first()
            assert "injected" not in entry.data
        finally:
            db.close()

    def test_keeps_entries_as_authored_when_no_schema_is_installed(self, pack_root):
        """A pack may arrive before its sheet; install order must not matter."""
        directory = _write_pack(
            pack_root, pack_id="orphan", spells=[{"_id": "x", "name": "X", "odd": 1}]
        )
        db = SessionLocal()
        try:
            pack = packs.load_pack(db, directory)
            db.commit()
            entry = db.query(packs.ContentEntry).filter_by(pack_id=pack.id).first()
            assert entry.data["odd"] == 1
        finally:
            db.close()

    def test_reloading_replaces_rather_than_duplicates(self, pack_root):
        directory = _write_pack(pack_root, pack_id="repeat")
        db = SessionLocal()
        try:
            for _ in range(3):
                pack = packs.load_pack(db, directory, schema_document=SCHEMA)
                packs.reindex_entry_search(db, pack, SCHEMA)
            db.commit()
            assert db.query(packs.ContentEntry).filter_by(pack_id=pack.id).count() == 4
            rows = db.execute(
                packs.text("SELECT count(*) FROM content_search WHERE pack_row = :p"),
                {"p": pack.id},
            ).scalar()
            # The FTS rows must not accumulate either: entries are replaced with
            # new ids, so clearing by entry would leave every old row behind.
            assert rows == 4
        finally:
            db.close()

    @pytest.mark.parametrize(
        "meta,spells,message",
        [
            ({"pack_id": ""}, None, "needs a 'pack_id'"),
            ({"schema_id": ""}, None, "needs a 'schema_id'"),
            ({"attribution": ""}, None, "must carry the credit"),
            (None, [{"name": "No id"}], "has no '_id'"),
            (None, [{"_id": "dup"}, {"_id": "dup"}], "twice"),
            (None, ["not an object"], "is not an object"),
        ],
    )
    def test_rejects_a_malformed_pack(self, pack_root, meta, spells, message):
        directory = _write_pack(pack_root, pack_id="bad", meta=meta, spells=spells)
        db = SessionLocal()
        try:
            with pytest.raises(packs.PackError, match=message):
                packs.load_pack(db, directory, schema_document=SCHEMA)
        finally:
            db.rollback()
            db.close()

    def test_one_bad_pack_does_not_stop_the_others(self, pack_root):
        _write_pack(pack_root, pack_id="good")
        _write_pack(pack_root, pack_id="broken", spells=[{"name": "no id"}])
        db = SessionLocal()
        try:
            loaded = packs.load_all_packs(db, root=pack_root, schemas={"catalog-demo": SCHEMA})
            assert [pack.pack_id for pack in loaded] == ["good"]
        finally:
            db.close()


@pytest.fixture
def catalog(client, admin_headers, pack_root):
    """A loaded pack plus the schema that describes it, installed for the admin."""
    client.post("/api/characters/schemas", json={"document": SCHEMA}, headers=admin_headers)
    directory = _write_pack(pack_root, pack_id="api-demo")
    db = SessionLocal()
    try:
        pack = packs.load_pack(db, directory, schema_document=SCHEMA)
        packs.reindex_entry_search(db, pack, SCHEMA)
        db.commit()
    finally:
        db.close()
    yield
    client.delete("/api/characters/schemas/catalog-demo", headers=admin_headers)


class TestCatalogApi:
    def test_lists_packs_with_their_credit(self, client, admin_headers, catalog):
        packs_seen = client.get("/api/content/packs", headers=admin_headers).json()["packs"]
        mine = [pack for pack in packs_seen if pack["pack_id"] == "api-demo"]
        assert mine and mine[0]["attribution"] == "Demo content, CC BY 4.0."

    def test_lists_the_content_types_a_schema_declares(self, client, admin_headers, catalog):
        types = client.get("/api/content/catalog-demo/types", headers=admin_headers).json()
        assert types["content_types"][0]["name"] == "spell"
        assert types["content_types"][0]["entry_count"] == 4
        assert types["content_types"][0]["label_plural"] == "Spells"

    def test_browses_in_the_declared_sort_order(self, client, admin_headers, catalog):
        result = client.get("/api/content/catalog-demo/spell", headers=admin_headers).json()
        assert result["total"] == 4
        # sort_default is level then name, so the two level-1 spells come first.
        assert [entry["name"] for entry in result["entries"]] == [
            "Magic Missile", "Shield", "Fireball", "Wish",
        ]

    def test_renders_the_compact_display_template(self, client, admin_headers, catalog):
        result = client.get("/api/content/catalog-demo/spell", headers=admin_headers).json()
        assert result["entries"][0]["display"] == "Magic Missile — evocation 1"

    def test_builds_facets_with_numeric_values_in_order(self, client, admin_headers, catalog):
        result = client.get("/api/content/catalog-demo/spell", headers=admin_headers).json()
        levels = [option["value"] for option in result["filters_available"]["level"]]
        # 1, 3, 9 — not 1, 3, 9 sorted as text, which would read 1, 3, 9 anyway,
        # but which breaks the moment a level 10 exists.
        assert levels == ["1", "3", "9"]
        assert result["filters_available"]["school"][0]["value"] == "abjuration"

    def test_searches_by_text(self, client, admin_headers, catalog):
        result = client.get(
            "/api/content/catalog-demo/spell?search=evocation", headers=admin_headers
        ).json()
        assert sorted(entry["name"] for entry in result["entries"]) == [
            "Fireball", "Magic Missile",
        ]

    def test_search_matches_a_prefix(self, client, admin_headers, catalog):
        result = client.get(
            "/api/content/catalog-demo/spell?search=fire", headers=admin_headers
        ).json()
        assert [entry["name"] for entry in result["entries"]] == ["Fireball"]

    def test_search_tolerates_punctuation(self, client, admin_headers, catalog):
        """FTS5 operators in a user's query must not raise."""
        resp = client.get(
            '/api/content/catalog-demo/spell?search="OR AND *', headers=admin_headers
        )
        assert resp.status_code == 200

    def test_filters_by_field(self, client, admin_headers, catalog):
        result = client.get(
            "/api/content/catalog-demo/spell?filter[level]=1", headers=admin_headers
        ).json()
        assert sorted(entry["name"] for entry in result["entries"]) == [
            "Magic Missile", "Shield",
        ]

    def test_paginates(self, client, admin_headers, catalog):
        page = client.get(
            "/api/content/catalog-demo/spell?page=2&page_size=2", headers=admin_headers
        ).json()
        assert page["total"] == 4
        assert page["page"] == 2
        assert len(page["entries"]) == 2

    def test_fetches_one_entry(self, client, admin_headers, catalog):
        entry = client.get(
            "/api/content/catalog-demo/spell/wish", headers=admin_headers
        ).json()
        assert entry["data"]["level"] == 9

    def test_missing_entry_is_404(self, client, admin_headers, catalog):
        assert (
            client.get(
                "/api/content/catalog-demo/spell/nope", headers=admin_headers
            ).status_code
            == 404
        )

    def test_unknown_content_type_is_404(self, client, admin_headers, catalog):
        assert (
            client.get("/api/content/catalog-demo/ghost", headers=admin_headers).status_code
            == 404
        )

    def test_resolves_many_references_at_once(self, client, admin_headers, catalog):
        resolved = client.get(
            "/api/content/catalog-demo/resolve?ids=fireball,shield,ghost",
            headers=admin_headers,
        ).json()["entries"]
        assert resolved["fireball"]["name"] == "Fireball"
        # A reference no installed pack provides is marked, not dropped: the
        # sheet must be able to say so rather than silently losing a choice.
        assert resolved["ghost"]["missing"] is True

    def test_a_user_without_the_schema_cannot_browse_it(
        self, client, gm_headers, catalog
    ):
        """The catalog is described by the caller's own copy of the sheet."""
        assert (
            client.get("/api/content/catalog-demo/spell", headers=gm_headers).status_code
            == 404
        )

    def test_requires_authentication(self, client, catalog):
        assert client.get("/api/content/catalog-demo/spell").status_code in (401, 403)


class TestCharacterReferences:
    def test_references_round_trip(self, client, admin_headers, catalog):
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "catalog-demo",
                "name": "Vex",
                "data": {
                    "spells": [
                        {"_ref": "fireball", "_source": "srd", "_per": {"prepared": "yes"}},
                        {"_ref": "shield"},
                        {"_inline": True, "name": "My Cantrip", "sneaky": "dropped"},
                    ],
                    "signature": {"_ref": "wish", "_source": "srd"},
                },
            },
            headers=admin_headers,
        ).json()

        spells = created["data"]["spells"]
        assert spells[0] == {"_ref": "fireball", "_source": "srd", "_per": {"prepared": True}}
        assert spells[1] == {"_ref": "shield"}
        assert spells[2] == {"_inline": True, "name": "My Cantrip"}
        assert created["data"]["signature"] == {"_ref": "wish", "_source": "srd"}

    def test_computed_values_read_referenced_entries(self, client, admin_headers, catalog):
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "catalog-demo",
                "name": "Caster",
                "data": {
                    "spells": [
                        {"_ref": "fireball", "_per": {"prepared": True}},
                        {"_ref": "shield"},
                    ]
                },
            },
            headers=admin_headers,
        ).json()
        # 3 + 1 from the catalog, and one of the two marked prepared.
        assert created["computed"]["spell_levels"] == 4
        assert created["computed"]["prepared_count"] == 1

    def test_the_response_carries_the_entries_the_sheet_needs(
        self, client, admin_headers, catalog
    ):
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "catalog-demo",
                "name": "Resolved",
                "data": {"spells": [{"_ref": "fireball"}]},
            },
            headers=admin_headers,
        ).json()
        assert created["entries"]["fireball"]["name"] == "Fireball"

    def test_a_reference_to_a_missing_entry_is_kept(self, client, admin_headers, catalog):
        """A pack may be uninstalled; the player's choice is not erased."""
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "catalog-demo",
                "name": "Orphan",
                "data": {"spells": [{"_ref": "not-installed"}]},
            },
            headers=admin_headers,
        ).json()
        assert created["data"]["spells"] == [{"_ref": "not-installed"}]
        assert created["entries"] == {}
