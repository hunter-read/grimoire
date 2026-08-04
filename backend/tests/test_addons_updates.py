"""Tests for keeping installed add-ons in step with the community index.

A scraper definition is expected to change whenever its source does, so noticing
and applying an update has to be a first-class path — not something a user only
discovers by uninstalling and reinstalling.
"""
import hashlib

import pytest
import yaml

from backend.addons import registry
from backend.addons import install as install_mod
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.addons.fetch import AddonFetchError
from backend.config import SessionLocal
from backend.models import AppSetting

MANIFEST = {
    "id": "demo",
    "name": "Demo",
    "version": "1.0.0",
    "kind": "scraper",
    "source": {"url": "https://example.com/d.json", "format": "json"},
    "search": {"fields": [{"field": "name"}], "identity": {"from": "name"}},
    "map": {"license": {"from": "license"}},
}

SCRIPT_BODY = b"def main():\n    pass\n"


def _yaml(data) -> bytes:
    return yaml.safe_dump(data).encode()


def _digest(body: bytes) -> str:
    return hashlib.sha256(body).hexdigest()


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
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


@pytest.fixture
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    return directory


@pytest.fixture
def files(monkeypatch):
    store: dict[str, bytes] = {}

    def fake_fetch_text(url):
        if url not in store:
            raise AddonFetchError(f"download returned HTTP 404 ({url})")
        return store[url]

    monkeypatch.setattr(install_mod, "_fetch_text", fake_fetch_text)
    return store


def _publish(db, files, version="1.0.0", addon_id="demo", **manifest_extra):
    """Put a version of an add-on in the index and make its files fetchable."""
    manifest = {**MANIFEST, "id": addon_id, "version": version, **manifest_extra}
    body = _yaml(manifest)
    entry = {
        "id": addon_id,
        "name": manifest["name"],
        "kind": "scraper",
        "target": "game-system",
        "version": version,
        "path": f"scrapers/{addon_id}/{addon_id}.yml",
        "requires_script": "script" in manifest,
        "sha256": _digest(body),
    }
    if "script" in manifest:
        entry["script_sha256"] = _digest(manifest_extra["_script_body"])
        files[f"https://example.com/scrapers/{addon_id}/{manifest['script']['entry']}"] = (
            manifest_extra["_script_body"]
        )
        manifest.pop("_script_body", None)
        body = _yaml({k: v for k, v in manifest.items() if k != "_script_body"})
        entry["sha256"] = _digest(body)

    files[f"https://example.com/scrapers/{addon_id}/{addon_id}.yml"] = body
    cached = registry.get_cached_index(db)
    entries = [e for e in (cached.get("addons") or []) if e["id"] != addon_id]
    entries.append(entry)
    registry.save_cached_index(
        db, {"version": 1, "addons": entries, "_url": "https://example.com/index.json"}
    )
    db.commit()
    return entry


# ---------------------------------------------------------------------------
# Version comparison
# ---------------------------------------------------------------------------


class TestVersionComparison:
    @pytest.mark.parametrize(
        "candidate,installed,expected",
        [
            ("1.0.1", "1.0.0", True),
            ("1.1.0", "1.0.9", True),
            ("2.0.0", "1.9.9", True),
            ("1.0.0", "1.0.0", False),
            ("1.0.0", "1.0.1", False),
            # The case a string comparison gets wrong.
            ("1.10.0", "1.9.0", True),
            ("1.9.0", "1.10.0", False),
        ],
    )
    def test_is_newer(self, candidate, installed, expected):
        assert registry.is_newer(candidate, installed) is expected

    def test_a_downgrade_in_the_index_is_not_an_update(self):
        """Republishing an older version must not prompt users to "update"."""
        assert registry.is_newer("0.9.0", "1.0.0") is False

    @pytest.mark.parametrize(
        "version,expected",
        [("1.2.3", (1, 2, 3)), ("2.0", (2, 0)), ("", (0,)), ("1.0.0-beta", (1, 0, 0))],
    )
    def test_parse_version(self, version, expected):
        assert registry.parse_version(version) == expected


# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------


class TestPendingUpdates:
    def test_none_when_versions_match(self, db, addons_dir, files):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        assert install_mod.pending_updates(db) == []

    def test_detected_when_the_index_moves_ahead(self, db, addons_dir, files):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        _publish(db, files, "1.1.0")
        assert install_mod.pending_updates(db) == [("demo", "1.0.0", "1.1.0")]

    def test_not_detected_for_an_older_index_entry(self, db, addons_dir, files):
        _publish(db, files, "2.0.0")
        install_mod.install(db, "demo")
        _publish(db, files, "1.0.0")
        assert install_mod.pending_updates(db) == []

    def test_a_hand_placed_addon_is_never_pending(self, db, addons_dir, files):
        """It has no index entry, so there is nothing to compare against."""
        directory = addons_dir / "local"
        directory.mkdir()
        (directory / "local.yml").write_text(yaml.safe_dump({**MANIFEST, "id": "local"}))
        assert install_mod.pending_updates(db) == []


# ---------------------------------------------------------------------------
# Applying
# ---------------------------------------------------------------------------


class TestUpdateAll:
    def test_updates_everything_pending(self, db, addons_dir, files):
        _publish(db, files, "1.0.0", addon_id="demo")
        _publish(db, files, "1.0.0", addon_id="other")
        install_mod.install(db, "demo")
        install_mod.install(db, "other")

        _publish(db, files, "2.0.0", addon_id="demo")
        _publish(db, files, "1.5.0", addon_id="other")

        result = install_mod.update_all(db)
        assert {u["id"] for u in result["updated"]} == {"demo", "other"}
        assert registry.load_manifest("demo").version == "2.0.0"
        assert registry.load_manifest("other").version == "1.5.0"

    def test_reports_what_changed(self, db, addons_dir, files):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        _publish(db, files, "1.2.0")
        result = install_mod.update_all(db)
        assert result["updated"] == [{"id": "demo", "from": "1.0.0", "to": "1.2.0"}]

    def test_is_a_no_op_when_up_to_date(self, db, addons_dir, files):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        assert install_mod.update_all(db) == {"updated": [], "failed": []}

    def test_one_failure_does_not_stop_the_others(self, db, addons_dir, files):
        """A single unreachable add-on must not block the rest."""
        _publish(db, files, "1.0.0", addon_id="demo")
        _publish(db, files, "1.0.0", addon_id="other")
        install_mod.install(db, "demo")
        install_mod.install(db, "other")

        _publish(db, files, "2.0.0", addon_id="demo")
        _publish(db, files, "2.0.0", addon_id="other")
        # Make just one of them undownloadable.
        del files["https://example.com/scrapers/demo/demo.yml"]

        result = install_mod.update_all(db)
        assert [f["id"] for f in result["failed"]] == ["demo"]
        assert [u["id"] for u in result["updated"]] == ["other"]
        assert registry.load_manifest("demo").version == "1.0.0"  # left intact

    def test_an_updated_script_loses_its_approval(self, db, addons_dir, files):
        """Consent was given to specific code; changed code must be re-approved."""
        registry.set_scripts_allowed(db, True)
        db.commit()
        _publish(
            db, files, "1.0.0",
            script={"entry": "demo.py"}, _script_body=SCRIPT_BODY,
        )
        install_mod.install(db, "demo", approve_script=True)
        assert registry.get_state_for(db, "demo")["script_approved"] is True

        _publish(
            db, files, "2.0.0",
            script={"entry": "demo.py"},
            _script_body=b"def main():\n    print('changed')\n",
        )
        install_mod.update_all(db)

        assert registry.get_state_for(db, "demo")["script_approved"] is False
        ok, reason = registry.is_runnable(db, "demo", registry.load_manifest("demo"))
        assert not ok and "approved" in reason


# ---------------------------------------------------------------------------
# API
# ---------------------------------------------------------------------------


class TestUpdateApi:
    @pytest.fixture(autouse=True)
    def _isolate(self, addons_dir):
        # addons_dir patches the module-level path the API also reads.
        return addons_dir

    def test_installed_rows_report_an_available_update(
        self, client, admin_headers, db, addons_dir, files
    ):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        _publish(db, files, "1.4.0")

        body = client.get("/api/addons", headers=admin_headers).json()
        row = next(a for a in body["installed"] if a["id"] == "demo")
        assert row["update_available"] is True
        assert row["available_version"] == "1.4.0"
        assert row["version"] == "1.0.0"

    def test_installed_rows_say_so_when_current(
        self, client, admin_headers, db, addons_dir, files
    ):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        body = client.get("/api/addons", headers=admin_headers).json()
        row = next(a for a in body["installed"] if a["id"] == "demo")
        assert row["update_available"] is False

    def test_an_addon_absent_from_the_index_reports_no_update(
        self, client, admin_headers, addons_dir
    ):
        directory = addons_dir / "local"
        directory.mkdir()
        (directory / "local.yml").write_text(yaml.safe_dump({**MANIFEST, "id": "local"}))
        body = client.get("/api/addons", headers=admin_headers).json()
        row = next(a for a in body["installed"] if a["id"] == "local")
        assert row["update_available"] is False
        assert row["available_version"] == ""

    def test_update_all_endpoint(
        self, client, admin_headers, db, addons_dir, files, monkeypatch
    ):
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        entry = _publish(db, files, "3.0.0")

        # The endpoint refreshes the index first; serve the one we just built.
        cached = registry.get_cached_index(db)
        monkeypatch.setattr(
            install_mod, "fetch_json", lambda url, **kw: {"version": 1, "addons": cached["addons"]}
        )
        # refresh_index stores the URL it fetched from; point it at the same
        # host the fixture serves files on.
        registry.set_index_url(db, "https://example.com/index.json")
        db.commit()

        response = client.post("/api/addons/update-all", headers=admin_headers)
        assert response.status_code == 200
        assert response.json()["updated"] == [
            {"id": "demo", "from": "1.0.0", "to": entry["version"]}
        ]

    def test_update_all_survives_an_unreachable_index(
        self, client, admin_headers, db, addons_dir, files, monkeypatch
    ):
        """A dead index falls back to the cached one rather than erroring."""
        _publish(db, files, "1.0.0")
        install_mod.install(db, "demo")
        _publish(db, files, "2.0.0")

        def boom(url, **kwargs):
            raise AddonFetchError("source timed out")

        monkeypatch.setattr(install_mod, "fetch_json", boom)
        response = client.post("/api/addons/update-all", headers=admin_headers)
        assert response.status_code == 200
        assert [u["id"] for u in response.json()["updated"]] == ["demo"]

    def test_update_all_requires_admin(self, client, gm_headers):
        assert client.post("/api/addons/update-all", headers=gm_headers).status_code == 403
