"""Tests for index refresh, integrity-verified installation, and removal."""
import hashlib
import os

import httpx
import pytest
import yaml

from backend import config
from backend.addons import constants, fetch, install, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.addons.fetch import AddonFetchError
from backend.addons.registry import AddonError
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


def _yaml_bytes(data) -> bytes:
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
    """A stub for the download of individual add-on files, keyed by URL."""
    store: dict[str, bytes] = {}

    def fake_fetch_text(url):
        if url not in store:
            raise AddonFetchError(f"download returned HTTP 404 ({url})")
        return store[url]

    monkeypatch.setattr(install, "_fetch_text", fake_fetch_text)
    return store


def _seed_index(db, entries, url="https://example.com/index.json"):
    payload = {"version": 1, "generated": "", "addons": entries, "_url": url}
    registry.save_cached_index(db, payload)
    db.commit()


def _index_entry(manifest_body, **overrides):
    entry = {
        "id": "demo",
        "name": "Demo",
        "kind": "scraper",
        "target": "game-system",
        "version": "1.0.0",
        "path": "scrapers/demo/demo.yml",
        "requires_script": False,
        "sha256": _digest(manifest_body),
    }
    entry.update(overrides)
    return entry


class TestRefreshIndex:
    def test_fetches_and_caches_the_index(self, db, monkeypatch):
        payload = {"version": 1, "addons": [_index_entry(_yaml_bytes(MANIFEST))]}
        monkeypatch.setattr(install, "fetch_json", lambda url, **kw: payload)
        result = install.refresh_index(db, "https://example.com/index.json")
        assert len(result["addons"]) == 1
        assert registry.get_cached_index(db)["_url"] == "https://example.com/index.json"

    def test_rejects_a_non_http_index_url(self, db):
        with pytest.raises(AddonError, match="http"):
            install.refresh_index(db, "file:///etc/passwd")

    def test_propagates_a_fetch_failure(self, db, monkeypatch):
        def boom(url, **kw):
            raise AddonFetchError("source timed out")

        monkeypatch.setattr(install, "fetch_json", boom)
        with pytest.raises(AddonFetchError):
            install.refresh_index(db, "https://example.com/index.json")

    def test_a_non_object_index_yields_no_addons(self, db, monkeypatch):
        monkeypatch.setattr(install, "fetch_json", lambda url, **kw: ["nope"])
        assert install.refresh_index(db, "https://example.com/index.json")["addons"] == []

    def test_unknown_index_fields_are_tolerated(self, db, monkeypatch):
        """The index may gain fields ahead of this client; that must not break it."""
        entry = {**_index_entry(_yaml_bytes(MANIFEST)), "future_field": "x"}
        monkeypatch.setattr(
            install, "fetch_json", lambda url, **kw: {"version": 1, "addons": [entry]}
        )
        assert len(install.refresh_index(db, "https://example.com/i.json")["addons"]) == 1


class TestInstall:
    def test_installs_from_the_index(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body

        install.install(db, "demo")

        assert os.path.isfile(addons_dir / "demo" / "demo.yml")
        assert registry.load_manifest("demo").version == "1.0.0"
        assert registry.get_state_for(db, "demo")["source"] == "index"

    def test_unknown_addon_is_rejected(self, db, addons_dir, files):
        _seed_index(db, [])
        with pytest.raises(AddonError, match="not in the add-on index"):
            install.install(db, "ghost")

    def test_checksum_mismatch_is_refused(self, db, addons_dir, files):
        """A file that does not match the index has been altered — refuse it."""
        _seed_index(db, [_index_entry(b"different content")])
        files["https://example.com/scrapers/demo/demo.yml"] = _yaml_bytes(MANIFEST)
        with pytest.raises(AddonError, match="integrity check"):
            install.install(db, "demo")
        assert not os.path.isdir(addons_dir / "demo")

    def test_a_missing_checksum_is_not_enforced(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body, sha256="")])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")
        assert os.path.isfile(addons_dir / "demo" / "demo.yml")

    def test_an_invalid_manifest_is_rolled_back(self, db, addons_dir, files):
        body = _yaml_bytes({"id": "demo", "name": "x"})  # missing required fields
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        with pytest.raises(AddonError):
            install.install(db, "demo")
        assert not os.path.isdir(addons_dir / "demo")

    def test_a_failed_download_leaves_the_previous_version_intact(
        self, db, addons_dir, files
    ):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")

        # Now the source starts failing.
        files.clear()
        with pytest.raises(AddonFetchError):
            install.install(db, "demo")
        assert registry.load_manifest("demo").version == "1.0.0"

    def test_update_replaces_the_installed_version(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")

        newer = _yaml_bytes({**MANIFEST, "version": "2.0.0"})
        _seed_index(db, [_index_entry(newer, version="2.0.0")])
        files["https://example.com/scrapers/demo/demo.yml"] = newer
        install.install(db, "demo")

        assert registry.load_manifest("demo").version == "2.0.0"
        assert registry.get_state_for(db, "demo")["version"] == "2.0.0"

    def test_no_staging_directory_is_left_behind(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")
        assert not any(n.endswith(".incoming") for n in os.listdir(addons_dir))


class TestScriptInstall:
    @pytest.fixture
    def scripted(self, db, files):
        manifest = {**MANIFEST, "script": {"entry": "demo.py"}}
        body = _yaml_bytes(manifest)
        _seed_index(
            db,
            [
                _index_entry(
                    body, requires_script=True, script_sha256=_digest(SCRIPT_BODY)
                )
            ],
        )
        files["https://example.com/scrapers/demo/demo.yml"] = body
        files["https://example.com/scrapers/demo/demo.py"] = SCRIPT_BODY
        return body

    def test_script_is_downloaded(self, db, addons_dir, scripted):
        install.install(db, "demo")
        assert os.path.isfile(addons_dir / "demo" / "demo.py")

    def test_installs_unapproved_by_default(self, db, addons_dir, scripted):
        """Installing must not imply consent to execute."""
        install.install(db, "demo")
        assert registry.get_state_for(db, "demo")["script_approved"] is False
        ok, reason = registry.is_runnable(db, "demo", registry.load_manifest("demo"))
        assert not ok and reason

    def test_explicit_approval_is_recorded(self, db, addons_dir, scripted):
        install.install(db, "demo", approve_script=True)
        assert registry.get_state_for(db, "demo")["script_approved"] is True

    def test_script_checksum_mismatch_is_refused(self, db, addons_dir, files):
        manifest = {**MANIFEST, "script": {"entry": "demo.py"}}
        body = _yaml_bytes(manifest)
        _seed_index(
            db, [_index_entry(body, requires_script=True, script_sha256=_digest(b"other"))]
        )
        files["https://example.com/scrapers/demo/demo.yml"] = body
        files["https://example.com/scrapers/demo/demo.py"] = SCRIPT_BODY
        with pytest.raises(AddonError, match="integrity check"):
            install.install(db, "demo")

    def test_updating_a_script_revokes_approval(self, db, addons_dir, files, scripted):
        """Approval is granted to a specific script; a changed one needs re-consent."""
        install.install(db, "demo", approve_script=True)
        assert registry.get_state_for(db, "demo")["script_approved"] is True

        changed = b"def main():\n    print('different')\n"
        manifest = {**MANIFEST, "version": "2.0.0", "script": {"entry": "demo.py"}}
        body = _yaml_bytes(manifest)
        _seed_index(
            db,
            [
                _index_entry(
                    body,
                    version="2.0.0",
                    requires_script=True,
                    script_sha256=_digest(changed),
                )
            ],
        )
        files["https://example.com/scrapers/demo/demo.yml"] = body
        files["https://example.com/scrapers/demo/demo.py"] = changed

        install.install(db, "demo")  # update without re-approving
        assert registry.get_state_for(db, "demo")["script_approved"] is False

    def test_approving_a_yaml_addon_is_rejected(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")
        with pytest.raises(AddonError, match="does not use a script"):
            install.set_script_approved(db, "demo", True)


class TestUninstallAndToggles:
    @pytest.fixture
    def installed(self, db, addons_dir, files):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        install.install(db, "demo")

    def test_uninstall_removes_files_and_state(self, db, addons_dir, installed):
        install.uninstall(db, "demo")
        assert not os.path.isdir(addons_dir / "demo")
        assert registry.get_state_for(db, "demo") == {}

    def test_uninstalling_something_absent_is_an_error(self, db, addons_dir):
        with pytest.raises(AddonError, match="not installed"):
            install.uninstall(db, "ghost")

    def test_disable_and_re_enable(self, db, addons_dir, installed):
        install.set_enabled(db, "demo", False)
        assert registry.is_enabled(db, "demo") is False
        install.set_enabled(db, "demo", True)
        assert registry.is_enabled(db, "demo") is True

    def test_toggling_something_absent_is_an_error(self, db, addons_dir):
        with pytest.raises(AddonError):
            install.set_enabled(db, "ghost", True)

    def test_find_entry_and_available(self, db, addons_dir, installed):
        assert install.find_entry(db, "demo").id == "demo"
        assert install.find_entry(db, "ghost") is None
        assert [e.id for e in install.available(db)] == ["demo"]


class TestFetchText:
    def test_non_200_is_reported(self, monkeypatch):
        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get(self, url):
                return type("R", (), {"status_code": 404, "content": b""})()

        monkeypatch.setattr(httpx, "Client", lambda **kw: _Client())
        with pytest.raises(AddonFetchError, match="HTTP 404"):
            install._fetch_text("https://example.com/x.yml")

    def test_oversize_download_is_refused(self, monkeypatch):
        monkeypatch.setattr("backend.addons.install.HTTP_MAX_BYTES", 4)

        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get(self, url):
                return type("R", (), {"status_code": 200, "content": b"x" * 64})()

        monkeypatch.setattr(httpx, "Client", lambda **kw: _Client())
        with pytest.raises(AddonFetchError, match="too large"):
            install._fetch_text("https://example.com/x.yml")

    def test_timeout_is_reported(self, monkeypatch):
        class _Client:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def get(self, url):
                raise httpx.TimeoutException("slow")

        monkeypatch.setattr(httpx, "Client", lambda **kw: _Client())
        with pytest.raises(AddonFetchError, match="timed out"):
            install._fetch_text("https://example.com/x.yml")


class TestScriptEntryName:
    def test_reads_the_declared_entry(self, tmp_path):
        (tmp_path / "demo.yml").write_text(
            yaml.safe_dump({**MANIFEST, "script": {"entry": "run.py"}})
        )
        assert install._script_entry_name(str(tmp_path), "demo") == "run.py"

    @pytest.mark.parametrize("entry", ["../escape.py", "sub/x.py", ".hidden.py", ""])
    def test_path_like_entries_are_refused(self, tmp_path, entry):
        """Belt-and-braces against a manifest that slipped past model validation."""
        (tmp_path / "demo.yml").write_text(
            yaml.safe_dump({"id": "demo", "script": {"entry": entry}})
        )
        with pytest.raises(AddonError, match="invalid script entry"):
            install._script_entry_name(str(tmp_path), "demo")


def test_cache_is_untouched_by_install(db, addons_dir, files, tmp_path, monkeypatch):
    """Installing must not disturb cached source responses."""
    cache = tmp_path / "cache"
    cache.mkdir()
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(cache))
    fetch.write_cache("https://example.com/d.json", {"kept": True})

    body = _yaml_bytes(MANIFEST)
    _seed_index(db, [_index_entry(body)])
    files["https://example.com/scrapers/demo/demo.yml"] = body
    install.install(db, "demo")

    assert fetch.read_cache("https://example.com/d.json", 3600) == {"kept": True}


class TestExternalInstallKillSwitch:
    """DISABLE_EXTERNAL_ADD_ON_INSTALL stops anything reaching a community repo.

    The switch is deliberately install-time only: an operator who has locked it
    on still expects their existing add-ons to keep working.
    """

    def test_refresh_refuses_when_disabled(self, db, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        with pytest.raises(AddonError, match="disabled"):
            install.refresh_index(db)

    def test_install_refuses_when_disabled(self, db, addons_dir, files, monkeypatch):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)

        with pytest.raises(AddonError, match="disabled"):
            install.install(db, "demo")

    def test_nothing_is_written_to_disk_when_disabled(
        self, db, addons_dir, files, monkeypatch
    ):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)

        with pytest.raises(AddonError):
            install.install(db, "demo")

        assert not os.path.exists(os.path.join(addons_dir, "demo"))

    def test_install_works_again_once_re_enabled(
        self, db, addons_dir, files, monkeypatch
    ):
        body = _yaml_bytes(MANIFEST)
        _seed_index(db, [_index_entry(body)])
        files["https://example.com/scrapers/demo/demo.yml"] = body

        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        with pytest.raises(AddonError):
            install.install(db, "demo")

        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        install.install(db, "demo")
        assert os.path.exists(os.path.join(addons_dir, "demo"))

    def test_the_switch_is_read_live_not_captured_at_import(self, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        assert constants.external_installs_enabled() is False
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        assert constants.external_installs_enabled() is True
