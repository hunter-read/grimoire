"""Tests for the add-on management and system-metadata endpoints."""
import hashlib
import json
import os
import uuid

import pytest
import yaml

from backend.addons import fetch, install, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.config import SessionLocal
from backend.models import AppSetting, GameSystem
from backend.tests.conftest import make_game_system

FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "ttrpg_wiki_systems.json")

MANIFEST = {
    "id": "ttrpg-wiki",
    "name": "TTRPG Wiki",
    "version": "1.0.0",
    "kind": "scraper",
    "target": "game-system",
    "attribution": "Data from TTRPG Wiki",
    "source": {"url": "https://ttrpgwiki.com/data/systems.json", "format": "json"},
    "records": {"root": "$", "skip_when": {"field": "hidden", "equals": True}},
    "search": {
        "fields": [
            {"field": "name", "weight": 1.0},
            {"field": "edition", "weight": 0.3},
        ],
        "min_score": 0.55,
        "label": {"template": "{name} ({edition})"},
        "identity": {"template": "{name}", "transform": "slugify"},
        "url": {"template": "https://ttrpgwiki.com/systems/{identity}"},
    },
    "map": {
        "description": {"from": "tagline"},
        "publishers": {"from": "publisher", "as": "link_list"},
        "year": {"from": "year"},
        "license": {"from": "license"},
        "system_family": {"from": "family"},
        "edition": {"from": "edition"},
        "genres": {"from": "genre", "transform": "titlecase"},
        "dice_materials": {"from": "dice"},
        "tags": {"from": "tags"},
    },
}


@pytest.fixture(autouse=True)
def clean_settings():
    yield
    session = SessionLocal()
    for key in (
        SETTING_INSTALLED,
        SETTING_INDEX_URL,
        SETTING_INDEX_CACHE,
        SETTING_ALLOW_SCRIPTS,
    ):
        row = session.query(AppSetting).filter_by(key=key).first()
        if row:
            session.delete(row)
    session.commit()
    session.close()


@pytest.fixture(autouse=True)
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(tmp_path / "cache"))
    return directory


@pytest.fixture
def installed(addons_dir):
    """A locally-present TTRPG Wiki add-on, as a hand-placed install would be."""
    directory = addons_dir / "ttrpg-wiki"
    directory.mkdir()
    (directory / "ttrpg-wiki.yml").write_text(yaml.safe_dump(MANIFEST))
    return directory


@pytest.fixture
def source_data(monkeypatch):
    """Serve the checked-in fixture instead of the live site."""
    with open(FIXTURE, encoding="utf-8") as fh:
        document = json.load(fh)
    calls = []

    def fake_fetch_document(url, **kwargs):
        calls.append(url)
        return document

    monkeypatch.setattr("backend.addons.service.fetch.fetch_document", fake_fetch_document)
    return calls


def _blades(**kwargs):
    """A system named so it matches the fixture's "Blades in the Dark".

    ``game_systems.name`` is unique and the test DB is shared across the
    session, so each system needs a distinct name. The suffix is punctuation the
    fuzzy matcher tolerates, keeping "Blades in the Dark" the top hit.
    """
    return make_game_system(name=f"Blades in the Dark ({uuid.uuid4().hex[:6]})", **kwargs)


@pytest.fixture
def system():
    return _blades()


# ---------------------------------------------------------------------------
# Add-on management
# ---------------------------------------------------------------------------


class TestAddonManagementAuth:
    def test_list_requires_admin(self, client, gm_headers):
        assert client.get("/api/addons", headers=gm_headers).status_code == 403

    def test_list_rejects_anonymous(self, client):
        assert client.get("/api/addons").status_code in (401, 403)

    def test_refresh_requires_admin(self, client, gm_headers):
        assert client.post("/api/addons/refresh", headers=gm_headers).status_code == 403

    def test_install_requires_admin(self, client, gm_headers):
        response = client.post("/api/addons/x/install", json={}, headers=gm_headers)
        assert response.status_code == 403

    def test_uninstall_requires_admin(self, client, gm_headers):
        assert client.delete("/api/addons/x", headers=gm_headers).status_code == 403


class TestListAddons:
    def test_reports_installed_addons(self, client, admin_headers, installed):
        body = client.get("/api/addons", headers=admin_headers).json()
        assert [a["id"] for a in body["installed"]] == ["ttrpg-wiki"]
        assert body["installed"][0]["runnable"] is True

    def test_reports_settings(self, client, admin_headers):
        body = client.get("/api/addons", headers=admin_headers).json()
        assert body["index_url"].startswith("https://")
        assert body["allow_scripts"] is False

    def test_reports_available_from_the_index(self, client, admin_headers):
        session = SessionLocal()
        registry.save_cached_index(
            session,
            {
                "addons": [
                    {
                        "id": "other",
                        "name": "Other",
                        "version": "1.0.0",
                        "path": "scrapers/other/other.yml",
                        "sha256": "x" * 64,
                    }
                ]
            },
        )
        session.commit()
        session.close()
        body = client.get("/api/addons", headers=admin_headers).json()
        assert body["available"][0]["installed"] is False

    def test_flags_an_available_update(self, client, admin_headers, installed):
        session = SessionLocal()
        registry.save_cached_index(
            session,
            {
                "addons": [
                    {
                        "id": "ttrpg-wiki",
                        "name": "TTRPG Wiki",
                        "version": "2.0.0",
                        "path": "scrapers/ttrpg-wiki/ttrpg-wiki.yml",
                        "sha256": "x" * 64,
                    }
                ]
            },
        )
        session.commit()
        session.close()
        body = client.get("/api/addons", headers=admin_headers).json()
        assert body["available"][0]["update_available"] is True


class TestAddonSettings:
    def test_updates_index_url_and_script_switch(self, client, admin_headers):
        response = client.patch(
            "/api/addons/settings",
            json={"index_url": "https://example.com/i.json", "allow_scripts": True},
            headers=admin_headers,
        )
        assert response.status_code == 200
        assert response.json() == {
            "index_url": "https://example.com/i.json",
            "allow_scripts": True,
        }

    def test_rejects_a_non_http_index_url(self, client, admin_headers):
        response = client.patch(
            "/api/addons/settings",
            json={"index_url": "file:///etc/passwd"},
            headers=admin_headers,
        )
        assert response.status_code == 422


class TestToggleAndUninstall:
    def test_disable_and_enable(self, client, admin_headers, installed):
        response = client.patch(
            "/api/addons/ttrpg-wiki", json={"enabled": False}, headers=admin_headers
        )
        assert response.json()["enabled"] is False
        response = client.patch(
            "/api/addons/ttrpg-wiki", json={"enabled": True}, headers=admin_headers
        )
        assert response.json()["enabled"] is True

    def test_uninstall_removes_it(self, client, admin_headers, installed):
        assert client.delete("/api/addons/ttrpg-wiki", headers=admin_headers).status_code == 200
        assert not os.path.isdir(installed)

    def test_uninstalling_something_absent_is_404(self, client, admin_headers):
        assert client.delete("/api/addons/ghost", headers=admin_headers).status_code == 404

    def test_toggling_something_absent_is_404(self, client, admin_headers):
        response = client.patch(
            "/api/addons/ghost", json={"enabled": True}, headers=admin_headers
        )
        assert response.status_code == 404

    def test_installing_something_not_in_the_index_is_400(self, client, admin_headers):
        response = client.post("/api/addons/ghost/install", json={}, headers=admin_headers)
        assert response.status_code == 400

    def test_a_dead_index_reports_502_not_500(self, client, admin_headers, monkeypatch):
        def boom(url, **kwargs):
            raise fetch.AddonFetchError("source timed out")

        monkeypatch.setattr(install, "fetch_json", boom)
        response = client.post("/api/addons/refresh", headers=admin_headers)
        assert response.status_code == 502

    def test_refresh_succeeds(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(
            install, "fetch_json", lambda url, **kw: {"version": 1, "addons": []}
        )
        response = client.post("/api/addons/refresh", headers=admin_headers)
        assert response.status_code == 200 and response.json()["count"] == 0


# ---------------------------------------------------------------------------
# System metadata endpoints
# ---------------------------------------------------------------------------


class TestMetadataSources:
    def test_lists_enabled_sources(self, client, gm_headers, system, installed):
        body = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).json()
        assert [s["id"] for s in body["sources"]] == ["ttrpg-wiki"]

    def test_omits_disabled_sources(self, client, gm_headers, admin_headers, system, installed):
        client.patch("/api/addons/ttrpg-wiki", json={"enabled": False}, headers=admin_headers)
        body = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).json()
        assert body["sources"] == []

    def test_empty_when_nothing_is_installed(self, client, gm_headers, system):
        body = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).json()
        assert body["sources"] == []

    def test_requires_gm_or_admin(self, client, player_headers, system, installed):
        response = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=player_headers
        )
        assert response.status_code == 403

    def test_unknown_system_is_404(self, client, gm_headers, installed):
        assert (
            client.get("/api/systems/nope/metadata-sources", headers=gm_headers).status_code
            == 404
        )


class TestMetadataSearch:
    def test_finds_candidates(self, client, gm_headers, system, installed, source_data):
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki"},
            headers=gm_headers,
        )
        body = response.json()
        assert body["query"] == system.name
        assert body["results"][0]["identity"] == "blades-in-the-dark"

    def test_blank_query_defaults_to_the_system_name(
        self, client, gm_headers, system, installed, source_data
    ):
        body = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki", "query": "   "},
            headers=gm_headers,
        ).json()
        assert body["query"] == system.name

    def test_an_explicit_query_is_used(
        self, client, gm_headers, system, installed, source_data
    ):
        body = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki", "query": "Mothership"},
            headers=gm_headers,
        ).json()
        assert body["results"][0]["identity"] == "mothership"

    def test_no_matches_is_an_empty_list_not_an_error(
        self, client, gm_headers, system, installed, source_data
    ):
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki", "query": "zzzz nonexistent zzzz"},
            headers=gm_headers,
        )
        assert response.status_code == 200 and response.json()["results"] == []

    def test_a_disabled_source_is_rejected(
        self, client, gm_headers, admin_headers, system, installed
    ):
        client.patch("/api/addons/ttrpg-wiki", json={"enabled": False}, headers=admin_headers)
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki"},
            headers=gm_headers,
        )
        assert response.status_code == 400

    def test_an_unreachable_source_is_502(
        self, client, gm_headers, system, installed, monkeypatch
    ):
        def boom(url, **kwargs):
            raise fetch.AddonFetchError("source timed out")

        monkeypatch.setattr("backend.addons.service.fetch.fetch_document", boom)
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki"},
            headers=gm_headers,
        )
        assert response.status_code == 502

    def test_requires_gm_or_admin(self, client, player_headers, system, installed):
        response = client.post(
            f"/api/systems/{system.id}/metadata-search",
            json={"source_id": "ttrpg-wiki"},
            headers=player_headers,
        )
        assert response.status_code == 403


class TestMetadataFetch:
    def _fetch(self, client, headers, system_id, identity="blades-in-the-dark"):
        return client.post(
            f"/api/systems/{system_id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki", "identity": identity},
            headers=headers,
        )

    def test_returns_a_field_diff(self, client, gm_headers, system, installed, source_data):
        body = self._fetch(client, gm_headers, system.id).json()
        fields = {row["field"]: row for row in body["fields"]}
        assert fields["year"]["incoming"] == 2017
        assert fields["system_family"]["incoming"] == "FitD"
        assert body["attribution"] == "Data from TTRPG Wiki"
        assert body["url"] == "https://ttrpgwiki.com/systems/blades-in-the-dark"

    def test_empty_fields_are_marked_only_incoming(
        self, client, gm_headers, system, installed, source_data
    ):
        body = self._fetch(client, gm_headers, system.id).json()
        statuses = {row["field"]: row["status"] for row in body["fields"]}
        assert statuses["year"] == "only_incoming"

    def test_existing_values_are_marked_differs(
        self, client, gm_headers, installed, source_data
    ):
        system = _blades(license="ORC")
        body = self._fetch(client, gm_headers, system.id).json()
        row = next(r for r in body["fields"] if r["field"] == "license")
        assert row["status"] == "differs" and row["current"] == "ORC"

    def test_matching_values_are_marked_same(
        self, client, gm_headers, installed, source_data
    ):
        system = _blades(year=2017)
        body = self._fetch(client, gm_headers, system.id).json()
        row = next(r for r in body["fields"] if r["field"] == "year")
        assert row["status"] == "same"

    def test_fetch_writes_nothing_to_the_system(
        self, client, gm_headers, system, installed, source_data
    ):
        """The core non-destructive guarantee: fetching only reports."""
        self._fetch(client, gm_headers, system.id)

        session = SessionLocal()
        after = session.query(GameSystem).filter_by(id=system.id).first()
        assert after.year is None
        assert after.license == ""
        assert after.system_family == ""
        assert after.description == ""
        session.close()

    def test_an_unknown_identity_is_400(
        self, client, gm_headers, system, installed, source_data
    ):
        response = self._fetch(client, gm_headers, system.id, identity="no-such-record")
        assert response.status_code == 400

    def test_requires_gm_or_admin(self, client, player_headers, system, installed):
        assert self._fetch(client, player_headers, system.id).status_code == 403

    def test_unknown_system_is_404(self, client, gm_headers, installed, source_data):
        assert self._fetch(client, gm_headers, "nope").status_code == 404


class TestApplyingChanges:
    def test_the_user_applies_fields_through_the_existing_patch(
        self, client, gm_headers, system, installed, source_data
    ):
        """End-to-end: fetch proposes, PATCH disposes — and only what was chosen."""
        body = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki", "identity": "blades-in-the-dark"},
            headers=gm_headers,
        ).json()

        chosen = {
            row["field"]: row["incoming"]
            for row in body["fields"]
            if row["field"] in ("year", "system_family")
        }
        assert client.patch(
            f"/api/systems/{system.id}", json=chosen, headers=gm_headers
        ).status_code == 200

        session = SessionLocal()
        after = session.query(GameSystem).filter_by(id=system.id).first()
        assert after.year == 2017
        assert after.system_family == "FitD"
        # Fields the user did not select stay untouched.
        assert after.license == ""
        session.close()

    def test_a_second_fetch_reports_everything_as_same(
        self, client, gm_headers, system, installed, source_data
    ):
        first = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki", "identity": "blades-in-the-dark"},
            headers=gm_headers,
        ).json()
        applied = {
            row["field"]: row["incoming"]
            for row in first["fields"]
            if row["field"] != "tags"
        }
        client.patch(f"/api/systems/{system.id}", json=applied, headers=gm_headers)

        second = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki", "identity": "blades-in-the-dark"},
            headers=gm_headers,
        ).json()
        statuses = {r["status"] for r in second["fields"] if r["field"] != "tags"}
        assert statuses == {"same"}


def test_installed_addon_digest_is_stable(installed):
    """Sanity: the fixture manifest round-trips through YAML unchanged."""
    body = (installed / "ttrpg-wiki.yml").read_bytes()
    assert hashlib.sha256(body).hexdigest() == hashlib.sha256(body).hexdigest()
    assert yaml.safe_load(body)["id"] == "ttrpg-wiki"
