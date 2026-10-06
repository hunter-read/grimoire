"""Tests for the character and schema API.

Ownership is the property that matters most here: schemas and characters are
per-user, so one account must never see or touch another's, and the tests below
assert that from both directions.
"""
import json

import pytest


SCHEMA = {
    "id": "test-rpg",
    "name": "Test RPG",
    "system": "Test RPG",
    "version": "1.0.0",
    "fields": {
        "strength": {"type": "number", "label": "Strength", "min": 1, "max": 20,
                     "default": 10},
        "class_name": {"type": "select", "label": "Class",
                       "options": ["fighter", "wizard"]},
        "notes": {"type": "textarea", "label": "Notes"},
        "inspired": {"type": "checkbox", "label": "Inspired"},
    },
    "computed": {"str_mod": {"formula": "floor((strength - 10) / 2)"}},
}


@pytest.fixture
def installed_schema(client, admin_headers):
    resp = client.post(
        "/api/characters/schemas", json={"document": SCHEMA}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text
    yield resp.json()
    client.delete("/api/characters/schemas/test-rpg", headers=admin_headers)


class TestSchemaEndpoints:
    def test_install_and_list(self, client, admin_headers, installed_schema):
        assert installed_schema["schema_id"] == "test-rpg"
        resp = client.get("/api/characters/schemas", headers=admin_headers)
        assert resp.status_code == 200
        ids = [s["schema_id"] for s in resp.json()["schemas"]]
        assert "test-rpg" in ids

    def test_get_returns_the_validated_document(
        self, client, admin_headers, installed_schema
    ):
        resp = client.get("/api/characters/schemas/test-rpg", headers=admin_headers)
        assert resp.status_code == 200
        document = resp.json()["document"]
        assert "strength" in document["fields"]
        assert document["layout"]

    def test_installing_twice_updates_rather_than_duplicating(
        self, client, admin_headers, installed_schema
    ):
        updated = dict(SCHEMA, name="Renamed RPG")
        resp = client.post(
            "/api/characters/schemas", json={"document": updated}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "Renamed RPG"

        listing = client.get("/api/characters/schemas", headers=admin_headers).json()
        matches = [s for s in listing["schemas"] if s["schema_id"] == "test-rpg"]
        assert len(matches) == 1

    def test_rejects_an_invalid_schema(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={"document": {"id": "bad", "name": "Bad",
                               "fields": {"x": {"type": "wormhole"}}}},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "wormhole" in resp.json()["detail"]

    def test_rejects_a_schema_with_a_hostile_layout(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={
                "document": {
                    "id": "hostile", "name": "Hostile", "fields": {},
                    "layout_html": '<div onclick="alert(1)">x</div>',
                }
            },
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "onclick" in resp.json()["detail"]

    def test_records_source_provenance(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={
                "document": dict(SCHEMA, id="sourced"),
                "source_id": "dnd-5e",
                "source_url": "https://example.com/dnd-5e.json",
                "source_version": "2.1.0",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_community"] is True
        assert body["source_version"] == "2.1.0"
        client.delete("/api/characters/schemas/sourced", headers=admin_headers)

    def test_get_missing_schema_is_404(self, client, admin_headers):
        resp = client.get("/api/characters/schemas/nope", headers=admin_headers)
        assert resp.status_code == 404

    def test_delete(self, client, admin_headers):
        client.post(
            "/api/characters/schemas",
            json={"document": dict(SCHEMA, id="throwaway")},
            headers=admin_headers,
        )
        resp = client.delete("/api/characters/schemas/throwaway", headers=admin_headers)
        assert resp.status_code == 200
        assert (
            client.get(
                "/api/characters/schemas/throwaway", headers=admin_headers
            ).status_code
            == 404
        )

    def test_requires_authentication(self, client):
        assert client.get("/api/characters/schemas").status_code in (401, 403)


class TestCharacterEndpoints:
    def test_create_computes_derived_values(
        self, client, admin_headers, installed_schema
    ):
        resp = client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Thorin",
                  "data": {"strength": 16}},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["name"] == "Thorin"
        assert body["data"]["strength"] == 16
        assert body["computed"]["str_mod"] == 3

    def test_create_against_a_missing_schema_is_rejected(self, client, admin_headers):
        resp = client.post(
            "/api/characters",
            json={"schema_ref": "not-installed", "name": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_values_are_coerced_to_their_declared_types(
        self, client, admin_headers, installed_schema
    ):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "test-rpg",
                "name": "Coerced",
                "data": {
                    "strength": "99",          # above max → clamped
                    "class_name": "bard",      # not an option → dropped to ""
                    "inspired": "yes",         # → True
                    "unknown_field": "x",      # not declared → not stored
                },
            },
            headers=admin_headers,
        )
        data = resp.json()["data"]
        assert data["strength"] == 20
        assert data["class_name"] == ""
        assert data["inspired"] is True
        assert "unknown_field" not in data

    def test_update_is_a_partial_patch(self, client, admin_headers, installed_schema):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Patch",
                  "data": {"strength": 12, "notes": "keep me"}},
            headers=admin_headers,
        ).json()

        resp = client.put(
            f"/api/characters/{created['id']}",
            json={"data": {"strength": 18}},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["data"]["strength"] == 18
        assert body["data"]["notes"] == "keep me"
        assert body["computed"]["str_mod"] == 4

    def test_rename(self, client, admin_headers, installed_schema):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Before"},
            headers=admin_headers,
        ).json()
        resp = client.put(
            f"/api/characters/{created['id']}",
            json={"name": "After"},
            headers=admin_headers,
        )
        assert resp.json()["name"] == "After"

    def test_list_and_filter_by_schema(self, client, admin_headers, installed_schema):
        client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Listed"},
            headers=admin_headers,
        )
        resp = client.get("/api/characters?schema_ref=test-rpg", headers=admin_headers)
        assert resp.status_code == 200
        names = [c["name"] for c in resp.json()["characters"]]
        assert "Listed" in names

    def test_delete(self, client, admin_headers, installed_schema):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Doomed"},
            headers=admin_headers,
        ).json()
        assert (
            client.delete(
                f"/api/characters/{created['id']}", headers=admin_headers
            ).status_code
            == 200
        )
        assert (
            client.get(
                f"/api/characters/{created['id']}", headers=admin_headers
            ).status_code
            == 404
        )

    def test_a_character_survives_its_schema_being_uninstalled(
        self, client, admin_headers
    ):
        """Removing a sheet definition must not destroy the character."""
        client.post(
            "/api/characters/schemas",
            json={"document": dict(SCHEMA, id="temporary")},
            headers=admin_headers,
        )
        created = client.post(
            "/api/characters",
            json={"schema_ref": "temporary", "name": "Orphan",
                  "data": {"strength": 14}},
            headers=admin_headers,
        ).json()

        client.delete("/api/characters/schemas/temporary", headers=admin_headers)

        resp = client.get(f"/api/characters/{created['id']}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["schema_missing"] is True
        assert body["data"]["strength"] == 14
        assert body["computed"] == {}


class TestOwnership:
    """Schemas and characters are per-user; one account must not reach another's."""

    def test_a_schema_is_not_visible_to_another_user(
        self, client, admin_headers, gm_headers, installed_schema
    ):
        listing = client.get("/api/characters/schemas", headers=gm_headers).json()
        assert "test-rpg" not in [s["schema_id"] for s in listing["schemas"]]
        assert (
            client.get(
                "/api/characters/schemas/test-rpg", headers=gm_headers
            ).status_code
            == 404
        )

    def test_a_character_is_not_readable_by_another_user(
        self, client, admin_headers, gm_headers, installed_schema
    ):
        created = client.post(
            "/api/characters",
            json={"schema_ref": "test-rpg", "name": "Private"},
            headers=admin_headers,
        ).json()

        assert (
            client.get(f"/api/characters/{created['id']}", headers=gm_headers).status_code
            == 404
        )
        assert (
            client.put(
                f"/api/characters/{created['id']}",
                json={"name": "Hijacked"},
                headers=gm_headers,
            ).status_code
            == 404
        )
        assert (
            client.delete(
                f"/api/characters/{created['id']}", headers=gm_headers
            ).status_code
            == 404
        )

    def test_two_users_can_install_the_same_schema_id_independently(
        self, client, admin_headers, gm_headers, installed_schema
    ):
        resp = client.post(
            "/api/characters/schemas",
            json={"document": dict(SCHEMA, name="GM's Copy")},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "GM's Copy"

        # The admin's copy is untouched.
        mine = client.get(
            "/api/characters/schemas/test-rpg", headers=admin_headers
        ).json()
        assert mine["name"] == "Test RPG"
        client.delete("/api/characters/schemas/test-rpg", headers=gm_headers)


PHASE2_SCHEMA = {
    "id": "phase2-rpg",
    "name": "Phase 2 RPG",
    "fields": {
        "level": {"type": "number", "label": "Level", "min": 1, "max": 20, "default": 1},
        "languages": {
            "type": "multiselect",
            "label": "Languages",
            "options": ["common", "elvish", "dwarvish"],
        },
        "equipment": {
            "type": "list",
            "label": "Equipment",
            "columns": [
                {"key": "name", "type": "text"},
                {"key": "qty", "type": "number", "default": 1, "min": 0},
                {"key": "equipped", "type": "checkbox"},
            ],
        },
    },
    "computed": {"carried": {"formula": "sum_where(equipment, 'qty')"}},
    "validators": [
        {
            "rule": "count_where(equipment, 'equipped') <= 2",
            "severity": "warning",
            "message": "You have more equipped than you can carry",
        }
    ],
}


@pytest.fixture
def phase2_schema(client, admin_headers):
    resp = client.post(
        "/api/characters/schemas", json={"document": PHASE2_SCHEMA}, headers=admin_headers
    )
    assert resp.status_code == 200, resp.text
    yield resp.json()
    client.delete("/api/characters/schemas/phase2-rpg", headers=admin_headers)


class TestPhase2Fields:
    def test_list_rows_round_trip(self, client, admin_headers, phase2_schema):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Packrat",
                "data": {
                    "equipment": [
                        {"name": "Sword", "qty": "2", "equipped": "yes"},
                        {"name": "Rope"},
                    ]
                },
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        rows = resp.json()["data"]["equipment"]
        assert rows[0] == {"name": "Sword", "qty": 2, "equipped": True}
        # Missing cells fall back to the column defaults.
        assert rows[1] == {"name": "Rope", "qty": 1, "equipped": False}

    def test_computed_reads_across_rows(self, client, admin_headers, phase2_schema):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Counter",
                "data": {"equipment": [{"qty": 2}, {"qty": 3}]},
            },
            headers=admin_headers,
        )
        assert resp.json()["computed"]["carried"] == 5

    def test_a_row_key_the_schema_does_not_declare_is_dropped(
        self, client, admin_headers, phase2_schema
    ):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Sneaky",
                "data": {"equipment": [{"name": "X", "injected": "payload"}]},
            },
            headers=admin_headers,
        )
        assert "injected" not in resp.json()["data"]["equipment"][0]

    def test_multiselect_keeps_only_declared_options_in_schema_order(
        self, client, admin_headers, phase2_schema
    ):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Linguist",
                "data": {"languages": ["dwarvish", "klingon", "common"]},
            },
            headers=admin_headers,
        )
        assert resp.json()["data"]["languages"] == ["common", "dwarvish"]


class TestValidatorsOverTheApi:
    def test_a_failing_validator_is_reported(self, client, admin_headers, phase2_schema):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Overloaded",
                "data": {"equipment": [{"equipped": True}] * 3},
            },
            headers=admin_headers,
        )
        validators = resp.json()["validators"]
        assert len(validators) == 1
        assert validators[0]["severity"] == "warning"
        assert "more equipped" in validators[0]["message"]

    def test_a_passing_character_reports_none(self, client, admin_headers, phase2_schema):
        resp = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Tidy",
                "data": {"equipment": [{"equipped": True}]},
            },
            headers=admin_headers,
        )
        assert resp.json()["validators"] == []

    def test_a_validator_never_blocks_saving(self, client, admin_headers, phase2_schema):
        """A sheet mid-edit is routinely invalid; refusing to save would lose work."""
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Mid-edit",
                "data": {"equipment": [{"equipped": True}] * 5},
            },
            headers=admin_headers,
        )
        assert created.status_code == 200
        assert created.json()["validators"]

    def test_validators_are_reevaluated_on_update(self, client, admin_headers, phase2_schema):
        created = client.post(
            "/api/characters",
            json={
                "schema_ref": "phase2-rpg",
                "name": "Changing",
                "data": {"equipment": [{"equipped": True}] * 3},
            },
            headers=admin_headers,
        ).json()
        assert created["validators"]

        updated = client.put(
            f"/api/characters/{created['id']}",
            json={"data": {"equipment": [{"equipped": True}]}},
            headers=admin_headers,
        )
        assert updated.json()["validators"] == []


class TestPastingASheet:
    """Installing a sheet from pasted text rather than a parsed document.

    A sheet is hand-written, so the paste box has to accept what people actually
    write: YAML as readily as JSON, and a custom layout's HTML and CSS as their
    own fields rather than escaped into one JSON string.
    """

    YAML_SHEET = """
id: yaml-demo
name: YAML Demo
version: 1.0.0
system: Demo
fields:
  level:
    type: number
    label: Level
    default: 1
computed:
  double:
    formula: level * 2
"""

    def _cleanup(self, client, headers, schema_id):
        client.delete(f"/api/characters/schemas/{schema_id}", headers=headers)

    def test_installs_a_sheet_written_as_yaml(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={"text": self.YAML_SHEET},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.json()
        assert resp.json()["schema_id"] == "yaml-demo"

        body = client.get("/api/characters/schemas/yaml-demo", headers=admin_headers).json()
        assert body["document"]["fields"]["level"]["label"] == "Level"
        # The formula survives the YAML round trip and still computes.
        assert body["document"]["computed"]["double"]["formula"] == "level * 2"
        self._cleanup(client, admin_headers, "yaml-demo")

    def test_yaml_comments_are_allowed(self, client, admin_headers):
        """The main reason to prefer YAML: a sheet can explain itself."""
        resp = client.post(
            "/api/characters/schemas",
            json={"text": "# A demo sheet\nid: commented\nname: Commented\n"
                          "fields:\n  hp:\n    type: number  # hit protection\n"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        self._cleanup(client, admin_headers, "commented")

    def test_installs_a_sheet_written_as_json(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={"text": json.dumps({"id": "json-demo", "name": "JSON Demo",
                                      "fields": {"level": {"type": "number"}}})},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        self._cleanup(client, admin_headers, "json-demo")

    def test_layout_and_styles_arrive_as_their_own_fields(self, client, admin_headers):
        """So a custom sheet's HTML does not have to be escaped into JSON."""
        resp = client.post(
            "/api/characters/schemas",
            json={
                "text": "id: sidecar-demo\nname: Sidecar\nfields:\n  hp:\n    type: number\n",
                "layout": '<div class="sheet"><g-field name="hp" /></div>',
                "styles": ".sheet { display: grid; }",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.json()
        document = client.get(
            "/api/characters/schemas/sidecar-demo", headers=admin_headers
        ).json()["document"]
        assert "g-field" in document["layout_html"]
        assert "display: grid" in document["styles"]
        self._cleanup(client, admin_headers, "sidecar-demo")

    def test_pasted_layout_wins_over_one_inlined_in_the_document(
        self, client, admin_headers
    ):
        """The separate field is the more specific thing the user just provided."""
        resp = client.post(
            "/api/characters/schemas",
            json={
                "text": json.dumps({
                    "id": "override-demo", "name": "Override",
                    "fields": {"hp": {"type": "number"}},
                    "layout_html": "<div><g-label name='hp' /></div>",
                }),
                "layout": "<section><g-field name='hp' /></section>",
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        document = client.get(
            "/api/characters/schemas/override-demo", headers=admin_headers
        ).json()["document"]
        assert "g-field" in document["layout_html"]
        assert "g-label" not in document["layout_html"]
        self._cleanup(client, admin_headers, "override-demo")

    def test_a_sidecar_pointer_is_dropped_rather_than_stored(self, client, admin_headers):
        """`layout_file` is a repo convention; what is stored is self-contained."""
        resp = client.post(
            "/api/characters/schemas",
            json={"text": "id: pointer-demo\nname: Pointer\nlayout_file: x.html\n"
                          "styles_file: x.css\nfields:\n  hp:\n    type: number\n"},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        document = client.get(
            "/api/characters/schemas/pointer-demo", headers=admin_headers
        ).json()["document"]
        assert "layout_file" not in document
        assert "styles_file" not in document
        self._cleanup(client, admin_headers, "pointer-demo")

    def test_a_pasted_layout_is_still_validated(self, client, admin_headers):
        """Pasting is not a way around the layout allowlist."""
        resp = client.post(
            "/api/characters/schemas",
            json={
                "text": "id: hostile\nname: Hostile\nfields:\n  hp:\n    type: number\n",
                "layout": '<div onclick="steal()"><g-field name="hp" /></div>',
            },
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_a_pasted_stylesheet_is_still_filtered(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={
                "text": "id: fixed\nname: Fixed\nfields:\n  hp:\n    type: number\n",
                "layout": "<div><g-field name='hp' /></div>",
                "styles": ".sheet { position: fixed; top: 0; }",
            },
            headers=admin_headers,
        )
        # Filtered rather than refused - the property is dropped and the rest kept.
        if resp.status_code == 200:
            document = client.get(
                "/api/characters/schemas/fixed", headers=admin_headers
            ).json()["document"]
            assert "position" not in document.get("styles", "")
            self._cleanup(client, admin_headers, "fixed")
        else:
            assert resp.status_code == 400

    def test_unparseable_text_says_so(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas",
            json={"text": "fields: [unclosed"},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "JSON or YAML" in resp.json()["detail"]

    def test_a_list_is_not_a_sheet(self, client, admin_headers):
        resp = client.post(
            "/api/characters/schemas", json={"text": "- one\n- two\n"}, headers=admin_headers
        )
        assert resp.status_code == 400
        assert "mapping" in resp.json()["detail"]

    def test_an_empty_paste_is_refused(self, client, admin_headers):
        resp = client.post("/api/characters/schemas", json={"text": "   "},
                           headers=admin_headers)
        assert resp.status_code == 400

    def test_nothing_at_all_is_refused(self, client, admin_headers):
        resp = client.post("/api/characters/schemas", json={}, headers=admin_headers)
        assert resp.status_code == 400

    def test_a_parsed_document_still_works(self, client, admin_headers):
        """The catalogue installer and older clients send `document`."""
        resp = client.post(
            "/api/characters/schemas",
            json={"document": {"id": "parsed-demo", "name": "Parsed",
                               "fields": {"hp": {"type": "number"}}}},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        self._cleanup(client, admin_headers, "parsed-demo")


class TestOverridesAndGrants:
    """Resetting a derived value, and remembering what a pick granted."""

    SCHEMA = {
        "id": "grant-demo",
        "name": "Grant Demo",
        "fields": {
            "background": {
                "type": "content_ref",
                "content_type": "background",
                "on_pick": [{"grant": "skills", "from": "skill_proficiencies"}],
            },
            "skills": {"type": "multiselect", "options": ["Arcana", "History"]},
            "speed": {"type": "number", "default": 30},
        },
        "content_types": {
            "background": {
                "identity_field": "name",
                "fields": {
                    "name": {"type": "text"},
                    "skill_proficiencies": {
                        "type": "multiselect",
                        "options": ["Arcana", "History"],
                    },
                },
            }
        },
    }

    @pytest.fixture
    def character(self, client, admin_headers):
        client.post(
            "/api/characters/schemas", json={"document": self.SCHEMA}, headers=admin_headers
        )
        created = client.post(
            "/api/characters",
            json={"schema_ref": "grant-demo", "name": "Granted", "data": {"speed": 40}},
            headers=admin_headers,
        ).json()
        yield created["id"]
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)
        client.delete("/api/characters/schemas/grant-demo", headers=admin_headers)

    def _update(self, client, headers, character_id, **body):
        return client.put(f"/api/characters/{character_id}", json=body, headers=headers)

    def test_unset_hands_a_field_back_to_its_default(self, client, admin_headers, character):
        body = self._update(client, admin_headers, character, unset=["speed"]).json()
        assert "speed" not in body["data"]

    def test_unset_and_data_in_one_patch(self, client, admin_headers, character):
        body = self._update(
            client, admin_headers, character, data={"skills": ["Arcana"]}, unset=["speed"]
        ).json()
        assert body["data"]["skills"] == ["Arcana"]
        assert "speed" not in body["data"]

    def test_unsetting_an_absent_field_is_harmless(self, client, admin_headers, character):
        resp = self._update(client, admin_headers, character, unset=["never_set"])
        assert resp.status_code == 200

    def test_stores_what_a_pick_granted(self, client, admin_headers, character):
        body = self._update(
            client,
            admin_headers,
            character,
            data={"_granted": {"background": {"skills": ["Arcana"]}}},
        ).json()
        assert body["data"]["_granted"] == {"background": {"skills": ["Arcana"]}}

    @pytest.mark.parametrize(
        "granted",
        [
            # A source with no on_pick rules has nothing to record.
            {"speed": {"skills": ["Arcana"]}},
            # Nor does an undeclared source, or an undeclared target.
            {"nonsense": {"skills": ["Arcana"]}},
            {"background": {"nowhere": ["Arcana"]}},
            # And the shape is enforced, not trusted.
            {"background": "not a mapping"},
            {"background": {"skills": "not a list"}},
            "not a mapping at all",
        ],
    )
    def test_drops_anything_outside_the_narrow_shape(
        self, client, admin_headers, character, granted
    ):
        """Allowed through only because it is narrow - not a way to write any JSON."""
        body = self._update(
            client, admin_headers, character, data={"_granted": granted}
        ).json()
        assert body["data"].get("_granted", {}) == {}

    def test_keeps_only_text_values(self, client, admin_headers, character):
        body = self._update(
            client,
            admin_headers,
            character,
            data={"_granted": {"background": {"skills": ["Arcana", {"x": 1}, None]}}},
        ).json()
        assert body["data"]["_granted"] == {"background": {"skills": ["Arcana"]}}

    def test_other_underscore_keys_are_still_dropped(self, client, admin_headers, character):
        body = self._update(
            client, admin_headers, character, data={"_anything": {"a": 1}}
        ).json()
        assert "_anything" not in body["data"]


class TestOverridingComputedValuesApi:
    SCHEMA = {
        "id": "override-api",
        "name": "Override API",
        "fields": {"dexterity": {"type": "number", "default": 14}},
        "computed": {"armor_class": {"formula": "10 + floor((dexterity - 10) / 2)"}},
    }

    @pytest.fixture
    def character(self, client, admin_headers):
        client.post(
            "/api/characters/schemas", json={"document": self.SCHEMA}, headers=admin_headers
        )
        created = client.post(
            "/api/characters", json={"schema_ref": "override-api", "name": "AC"}, headers=admin_headers
        ).json()
        yield created["id"]
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)
        client.delete("/api/characters/schemas/override-api", headers=admin_headers)

    def _put(self, client, headers, character_id, overrides):
        return client.put(
            f"/api/characters/{character_id}",
            json={"data": {"_overrides": overrides}},
            headers=headers,
        ).json()

    def test_the_server_computes_with_the_override(self, client, admin_headers, character):
        body = self._put(client, admin_headers, character, {"armor_class": 19})
        assert body["computed"]["armor_class"] == 19
        assert body["data"]["_overrides"] == {"armor_class": 19}

    def test_leaving_a_name_out_resets_it(self, client, admin_headers, character):
        self._put(client, admin_headers, character, {"armor_class": 19})
        body = self._put(client, admin_headers, character, {})
        assert body["computed"]["armor_class"] == 12

    @pytest.mark.parametrize(
        "overrides, kept",
        [
            ({"not_computed": 5}, {}),
            ({"dexterity": 5}, {}),
            ({"armor_class": {"nested": 1}}, {}),
            ({"armor_class": ["list"]}, {}),
            ({"armor_class": "   "}, {}),
            ({"armor_class": " 17 "}, {"armor_class": "17"}),
            ({"armor_class": True}, {"armor_class": True}),
            ("not a mapping", {}),
        ],
    )
    def test_keeps_only_short_scalars_for_computed_names(
        self, client, admin_headers, character, overrides, kept
    ):
        body = self._put(client, admin_headers, character, overrides)
        assert body["data"].get("_overrides", {}) == kept


class TestNameField:
    """A sheet's name field and the character's name are one value."""

    SCHEMA = {
        "id": "named-demo",
        "name": "Named Demo",
        "name_field": "hero_name",
        "fields": {"hero_name": {"type": "text"}, "level": {"type": "number", "default": 1}},
    }

    @pytest.fixture
    def installed(self, client, admin_headers):
        client.post("/api/characters/schemas", json={"document": self.SCHEMA}, headers=admin_headers)
        yield
        client.delete("/api/characters/schemas/named-demo", headers=admin_headers)

    def _create(self, client, headers, **body):
        return client.post(
            "/api/characters", json={"schema_ref": "named-demo", **body}, headers=headers
        ).json()

    def test_the_name_given_at_creation_fills_the_field(self, client, admin_headers, installed):
        created = self._create(client, admin_headers, name="Vex")
        assert created["data"]["hero_name"] == "Vex"
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)

    def test_a_name_in_the_data_is_not_overwritten(self, client, admin_headers, installed):
        created = self._create(client, admin_headers, name="Vex", data={"hero_name": "Vex the Bold"})
        assert created["data"]["hero_name"] == "Vex the Bold"
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)

    def test_editing_the_field_renames_the_character(self, client, admin_headers, installed):
        created = self._create(client, admin_headers, name="Vex")
        body = client.put(
            f"/api/characters/{created['id']}",
            json={"data": {"hero_name": "Vesper"}},
            headers=admin_headers,
        ).json()
        assert body["name"] == "Vesper"
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)

    def test_renaming_the_character_updates_the_field(self, client, admin_headers, installed):
        created = self._create(client, admin_headers, name="Vex")
        body = client.put(
            f"/api/characters/{created['id']}", json={"name": "Vesper"}, headers=admin_headers
        ).json()
        assert body["data"]["hero_name"] == "Vesper"
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)

    def test_a_sheet_without_one_is_unaffected(self, client, admin_headers):
        schema = {**self.SCHEMA, "id": "unnamed-demo"}
        schema.pop("name_field")
        client.post("/api/characters/schemas", json={"document": schema}, headers=admin_headers)
        created = client.post(
            "/api/characters", json={"schema_ref": "unnamed-demo", "name": "Vex"}, headers=admin_headers
        ).json()
        assert "hero_name" not in created["data"]
        client.delete(f"/api/characters/{created['id']}", headers=admin_headers)
        client.delete("/api/characters/schemas/unnamed-demo", headers=admin_headers)

    @pytest.mark.parametrize(
        "name_field, message",
        [("nowhere", "unknown field"), ("level", "must be a text field"), (5, "unknown field")],
    )
    def test_must_name_a_text_field(self, name_field, message):
        from backend.services import characters as svc

        with pytest.raises(svc.SchemaError, match=message):
            svc.validate_schema({**self.SCHEMA, "name_field": name_field})


class TestStartingValues:
    """A new character stores its sheet's starting values."""

    SCHEMA = {
        "id": "start-demo",
        "name": "Start",
        "fields": {
            "level": {"type": "number", "default": 1},
            "strength": {"type": "number", "default": 10},
            "notes": {"type": "text"},
            "speed": {"type": "number", "default": 30, "default_from": "level * 5"},
        },
    }

    @pytest.fixture
    def created(self, client, admin_headers):
        client.post("/api/characters/schemas", json={"document": self.SCHEMA}, headers=admin_headers)
        body = client.post(
            "/api/characters",
            json={"schema_ref": "start-demo", "name": "New", "data": {"strength": 15}},
            headers=admin_headers,
        ).json()
        yield body
        client.delete(f"/api/characters/{body['id']}", headers=admin_headers)
        client.delete("/api/characters/schemas/start-demo", headers=admin_headers)

    def test_stores_each_default(self, created):
        assert created["data"]["level"] == 1

    def test_a_value_given_at_creation_wins(self, created):
        assert created["data"]["strength"] == 15

    def test_a_field_without_a_default_stays_unset(self, created):
        assert "notes" not in created["data"]

    def test_a_derived_field_is_not_stored(self, created):
        """Storing it would make it the player's own, and it would stop following."""
        assert "speed" not in created["data"]
