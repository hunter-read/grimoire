"""Tests for the character and schema API.

Ownership is the property that matters most here: schemas and characters are
per-user, so one account must never see or touch another's, and the tests below
assert that from both directions.
"""
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
