"""Tests for how the running version is resolved (issue #457).

The Docker image bakes APP_VERSION in at build time, but a source checkout or a
release tarball has no such env var. These pin the fallback chain so a
non-Docker install reports its real version instead of a hardcoded one.

``_version_from_file`` is exercised directly rather than by re-importing
``backend.config``: the module opens a database engine and a cache client at
import time, so reloading it under a monkeypatched environment would be a far
heavier thing to do than the behaviour under test warrants.
"""
import os

from backend import config


class TestVersionFile:
    def test_reads_an_arbitrary_version_file(self, monkeypatch, tmp_path):
        target = tmp_path / "VERSION"
        target.write_text("4.5.6\n", encoding="utf-8")
        monkeypatch.setattr(config, "_VERSION_FILE", str(target))
        assert config._version_from_file() == "4.5.6"

    def test_version_file_is_a_release_number(self):
        # Guards against the file being emptied or filled with a placeholder:
        # whatever is in it is what a tarball install will display.
        value = config._version_from_file()
        assert value
        parts = value.split(".")
        assert len(parts) == 3 and all(p.isdigit() for p in parts), value

    def test_missing_file_yields_empty_string(self, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "_VERSION_FILE", str(tmp_path / "nope"))
        assert config._version_from_file() == ""

    def test_directory_in_place_of_file_yields_empty_string(self, monkeypatch, tmp_path):
        # An OSError that is not FileNotFoundError still has to degrade rather
        # than take the process down at import time.
        monkeypatch.setattr(config, "_VERSION_FILE", str(tmp_path))
        assert config._version_from_file() == ""

    def test_surrounding_whitespace_is_stripped(self, monkeypatch, tmp_path):
        target = tmp_path / "VERSION"
        target.write_text("  9.9.9\n\n", encoding="utf-8")
        monkeypatch.setattr(config, "_VERSION_FILE", str(target))
        assert config._version_from_file() == "9.9.9"


class TestResolvedVersion:
    def test_version_is_not_the_old_hardcoded_fallback(self):
        # "1.0.0" named a real release, so it was indistinguishable from a
        # genuinely old install. Nothing should report it by accident again.
        assert config.VERSION != "1.0.0"

    def test_version_matches_env_or_the_shipped_file(self):
        # In the test environment APP_VERSION is normally unset, so this
        # exercises the file fallback end to end; if CI does set it, the env
        # var is what should have won.
        expected = os.environ.get("APP_VERSION") or config._version_from_file()
        assert config.VERSION == expected
        assert config.VERSION != "unknown"
