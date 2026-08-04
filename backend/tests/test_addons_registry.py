"""Tests for add-on manifest validation, on-disk discovery, and install state."""
import json
import os

import pytest
import yaml
from pydantic import ValidationError

from backend.addons import registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.addons.manifest import AddonManifest
from backend.addons.registry import AddonError
from backend.config import SessionLocal
from backend.models import AppSetting

VALID = {
    "id": "demo",
    "name": "Demo",
    "version": "1.0.0",
    "kind": "scraper",
    "source": {"url": "https://example.com/d.json", "format": "json"},
    "search": {"fields": [{"field": "name"}], "identity": {"from": "name"}},
    "map": {"license": {"from": "license"}},
}


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        # Leave no add-on settings behind for the next test.
        for key in (SETTING_INSTALLED, SETTING_INDEX_URL, SETTING_ALLOW_SCRIPTS):
            row = session.query(AppSetting).filter_by(key=key).first()
            if row:
                session.delete(row)
        session.commit()
        session.close()


@pytest.fixture
def addons_dir(tmp_path, monkeypatch):
    """Point the registry at a throwaway add-ons directory."""
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    return directory


def _write_addon(root, addon_id, manifest=None, script=None):
    directory = root / addon_id
    directory.mkdir(parents=True, exist_ok=True)
    data = dict(manifest if manifest is not None else VALID)
    data["id"] = addon_id
    (directory / f"{addon_id}.yml").write_text(yaml.safe_dump(data))
    if script is not None:
        (directory / script).write_text("def main():\n    pass\n")
    return directory


# ---------------------------------------------------------------------------
# Manifest validation
# ---------------------------------------------------------------------------


class TestManifestValidation:
    def test_valid_manifest_loads(self):
        assert AddonManifest(**VALID).id == "demo"

    def test_unknown_keys_are_rejected(self):
        """A typo must be an error, not a silently ignored no-op."""
        with pytest.raises(ValidationError):
            AddonManifest(**{**VALID, "sauce": {}})

    def test_map_to_an_unknown_field_is_rejected(self):
        with pytest.raises(ValidationError, match="not valid for target"):
            AddonManifest(**{**VALID, "map": {"nonsense": {"from": "x"}}})

    def test_book_fields_are_rejected_on_a_system_scraper(self):
        """The allowlist is per-target: `isbn` is a book field, not a system one."""
        with pytest.raises(ValidationError, match="not valid for target"):
            AddonManifest(**{**VALID, "map": {"isbn": {"from": "x"}}})

    def test_book_fields_are_accepted_on_a_book_scraper(self):
        manifest = AddonManifest(
            **{**VALID, "target": "book", "map": {"isbn": {"from": "x"}}}
        )
        assert manifest.target == "book"
        assert "isbn" in manifest.mappable_fields

    def test_system_fields_are_rejected_on_a_book_scraper(self):
        with pytest.raises(ValidationError, match="not valid for target"):
            AddonManifest(
                **{**VALID, "target": "book", "map": {"dice_materials": {"from": "x"}}}
            )

    def test_map_cannot_reach_protected_columns(self):
        """A definition must not be able to write ids, covers, or flags."""
        for field in ("id", "slug", "cover_image", "is_explicit"):
            with pytest.raises(ValidationError):
                AddonManifest(**{**VALID, "map": {field: {"from": "x"}}})

    def test_manifest_needs_a_source_or_a_script(self):
        bare = {k: v for k, v in VALID.items() if k not in ("source", "search")}
        with pytest.raises(ValidationError, match="source.*script"):
            AddonManifest(**bare)

    def test_source_manifest_needs_a_search_block(self):
        no_search = {k: v for k, v in VALID.items() if k != "search"}
        with pytest.raises(ValidationError, match="search"):
            AddonManifest(**no_search)

    @pytest.mark.parametrize("url", ["file:///etc/passwd", "ftp://x/y", "/local/path"])
    def test_non_http_source_urls_are_rejected(self, url):
        """Blocks a definition pointing the fetcher at the local filesystem."""
        with pytest.raises(ValidationError):
            AddonManifest(**{**VALID, "source": {"url": url, "format": "json"}})

    @pytest.mark.parametrize("bad", ["Demo", "de mo", "demo/../x", "-demo", "demo-"])
    def test_unsafe_ids_are_rejected(self, bad):
        with pytest.raises(ValidationError):
            AddonManifest(**{**VALID, "id": bad})

    @pytest.mark.parametrize(
        "entry", ["../escape.py", "sub/dir.py", ".hidden.py", "notpython.txt"]
    )
    def test_script_entry_must_be_a_bare_py_filename(self, entry):
        """A path here would let an add-on execute a file outside its own dir."""
        with pytest.raises(ValidationError):
            AddonManifest(**{**VALID, "script": {"entry": entry}})

    def test_script_timeout_is_bounded(self):
        with pytest.raises(ValidationError):
            AddonManifest(**{**VALID, "script": {"entry": "s.py", "timeout": 9999}})

    def test_requires_script_reflects_the_script_block(self):
        assert AddonManifest(**VALID).requires_script is False
        assert AddonManifest(**{**VALID, "script": {"entry": "s.py"}}).requires_script


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


class TestDiscovery:
    def test_finds_installed_addons(self, addons_dir):
        _write_addon(addons_dir, "alpha")
        _write_addon(addons_dir, "beta")
        assert registry.installed_ids() == ["alpha", "beta"]

    def test_ignores_the_cache_directory(self, addons_dir):
        (addons_dir / ".cache").mkdir()
        _write_addon(addons_dir, "alpha")
        assert registry.installed_ids() == ["alpha"]

    def test_ignores_directories_without_a_manifest(self, addons_dir):
        (addons_dir / "empty").mkdir()
        assert registry.installed_ids() == []

    def test_missing_addons_dir_is_not_an_error(self, tmp_path, monkeypatch):
        monkeypatch.setattr(registry, "ADDONS_DIR", str(tmp_path / "nope"))
        assert registry.installed_ids() == []

    def test_load_manifest_reads_a_valid_addon(self, addons_dir):
        _write_addon(addons_dir, "alpha")
        assert registry.load_manifest("alpha").name == "Demo"

    def test_load_manifest_rejects_an_id_mismatch(self, addons_dir):
        directory = addons_dir / "alpha"
        directory.mkdir()
        (directory / "alpha.yml").write_text(yaml.safe_dump({**VALID, "id": "beta"}))
        with pytest.raises(AddonError, match="does not match directory"):
            registry.load_manifest("alpha")

    def test_load_manifest_reports_invalid_yaml(self, addons_dir):
        directory = addons_dir / "broken"
        directory.mkdir()
        (directory / "broken.yml").write_text("key: [unclosed")
        with pytest.raises(AddonError, match="unreadable"):
            registry.load_manifest("broken")

    def test_load_manifest_reports_a_schema_violation(self, addons_dir):
        directory = addons_dir / "bad"
        directory.mkdir()
        (directory / "bad.yml").write_text(yaml.safe_dump({"id": "bad", "name": "x"}))
        with pytest.raises(AddonError, match="invalid"):
            registry.load_manifest("bad")

    def test_load_manifest_on_a_missing_addon(self, addons_dir):
        with pytest.raises(AddonError, match="not installed"):
            registry.load_manifest("ghost")

    def test_load_all_skips_broken_addons(self, addons_dir):
        """One bad definition must not take the whole add-on system down."""
        _write_addon(addons_dir, "good")
        broken = addons_dir / "broken"
        broken.mkdir()
        (broken / "broken.yml").write_text("::: not yaml :::")
        assert list(registry.load_all()) == ["good"]

    @pytest.mark.parametrize("bad", ["../etc", "a/b", "", "x;rm -rf"])
    def test_addon_dir_rejects_path_traversal(self, bad):
        with pytest.raises(AddonError, match="invalid add-on id"):
            registry.addon_dir(bad)


# ---------------------------------------------------------------------------
# Settings and install state
# ---------------------------------------------------------------------------


class TestState:
    def test_index_url_default_and_override(self, db):
        assert registry.get_index_url(db).startswith("https://")
        registry.set_index_url(db, "https://example.com/index.json")
        db.commit()
        assert registry.get_index_url(db) == "https://example.com/index.json"

    def test_scripts_are_disallowed_by_default(self, db):
        """The global script switch must fail closed."""
        assert registry.scripts_allowed(db) is False

    def test_scripts_can_be_enabled(self, db):
        registry.set_scripts_allowed(db, True)
        db.commit()
        assert registry.scripts_allowed(db) is True

    def test_state_round_trips(self, db):
        registry.update_state_for(db, "demo", version="1.0.0", enabled=True)
        db.commit()
        assert registry.get_state_for(db, "demo")["version"] == "1.0.0"

    def test_state_updates_merge(self, db):
        registry.update_state_for(db, "demo", version="1.0.0")
        registry.update_state_for(db, "demo", enabled=False)
        db.commit()
        record = registry.get_state_for(db, "demo")
        assert record["version"] == "1.0.0" and record["enabled"] is False

    def test_dropping_state(self, db):
        registry.update_state_for(db, "demo", version="1")
        registry.drop_state_for(db, "demo")
        db.commit()
        assert registry.get_state_for(db, "demo") == {}

    def test_corrupt_state_json_is_ignored(self, db):
        db.add(AppSetting(key=SETTING_INSTALLED, value="{not json"))
        db.commit()
        assert registry.get_state(db) == {}

    def test_addons_are_enabled_unless_turned_off(self, db):
        assert registry.is_enabled(db, "never-seen") is True
        registry.update_state_for(db, "demo", enabled=False)
        db.commit()
        assert registry.is_enabled(db, "demo") is False


class TestRunnability:
    def test_yaml_addon_is_runnable(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        ok, reason = registry.is_runnable(db, "alpha", registry.load_manifest("alpha"))
        assert ok and reason == ""

    def test_disabled_addon_is_not_runnable(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        registry.update_state_for(db, "alpha", enabled=False)
        db.commit()
        ok, reason = registry.is_runnable(db, "alpha", registry.load_manifest("alpha"))
        assert not ok and "disabled" in reason

    def test_script_addon_blocked_without_the_global_switch(self, db, addons_dir):
        manifest = {**VALID, "script": {"entry": "s.py"}}
        _write_addon(addons_dir, "scripted", manifest=manifest, script="s.py")
        registry.update_state_for(db, "scripted", script_approved=True)
        db.commit()
        ok, reason = registry.is_runnable(
            db, "scripted", registry.load_manifest("scripted")
        )
        assert not ok and "not enabled" in reason

    def test_script_addon_blocked_without_approval(self, db, addons_dir):
        manifest = {**VALID, "script": {"entry": "s.py"}}
        _write_addon(addons_dir, "scripted", manifest=manifest, script="s.py")
        registry.set_scripts_allowed(db, True)
        db.commit()
        ok, reason = registry.is_runnable(
            db, "scripted", registry.load_manifest("scripted")
        )
        assert not ok and "not been approved" in reason

    def test_script_addon_runs_with_both_consents(self, db, addons_dir):
        manifest = {**VALID, "script": {"entry": "s.py"}}
        _write_addon(addons_dir, "scripted", manifest=manifest, script="s.py")
        registry.set_scripts_allowed(db, True)
        registry.update_state_for(db, "scripted", script_approved=True)
        db.commit()
        ok, _ = registry.is_runnable(db, "scripted", registry.load_manifest("scripted"))
        assert ok

    def test_get_runnable_raises_when_blocked(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        registry.update_state_for(db, "alpha", enabled=False)
        db.commit()
        with pytest.raises(AddonError, match="disabled"):
            registry.get_runnable(db, "alpha")


class TestEnabledForTarget:
    def test_returns_matching_scrapers(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        assert [m.id for m in registry.enabled_for_target(db, "game-system")] == ["alpha"]

    def test_excludes_disabled(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        registry.update_state_for(db, "alpha", enabled=False)
        db.commit()
        assert registry.enabled_for_target(db, "game-system") == []

    def test_excludes_unapproved_scripts(self, db, addons_dir):
        _write_addon(
            addons_dir, "scripted", manifest={**VALID, "script": {"entry": "s.py"}}, script="s.py"
        )
        assert registry.enabled_for_target(db, "game-system") == []


class TestDescribe:
    def test_serialises_an_addon(self, db, addons_dir):
        _write_addon(addons_dir, "alpha")
        described = registry.describe(db, "alpha")
        assert described["id"] == "alpha"
        assert described["requires_script"] is False
        assert described["runnable"] is True

    def test_reports_why_an_addon_is_blocked(self, db, addons_dir):
        _write_addon(
            addons_dir, "scripted", manifest={**VALID, "script": {"entry": "s.py"}}, script="s.py"
        )
        described = registry.describe(db, "scripted")
        assert described["runnable"] is False
        assert described["blocked_reason"]


def test_state_is_stored_as_json_in_app_settings(db):
    """State rides in the generic KV table, so the feature needs no migration."""
    registry.update_state_for(db, "demo", version="2.0.0")
    db.commit()
    row = db.query(AppSetting).filter_by(key=SETTING_INSTALLED).first()
    assert json.loads(row.value)["demo"]["version"] == "2.0.0"


def test_addons_dir_is_under_data_path():
    from backend.addons import constants

    assert constants.ADDONS_DIR.endswith(os.path.join("add-ons"))
