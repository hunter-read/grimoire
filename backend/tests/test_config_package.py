"""backend.config is a package split by concern, with one copy of each setting (issue #714).

``config.X`` reads ``X`` from the module that defines it and assigning it writes
there, so a test patching ``config.X`` reaches code inside ``db`` or ``valkey``.
Every environment variable is read in ``config/env.py``, and
``docs/configuration.md`` documents each one.
"""
import importlib
import logging
import re
from pathlib import Path

import pytest

from backend import config
from backend.config import env, valkey

_DOCS = Path(__file__).resolve().parents[2] / "docs" / "configuration.md"


class TestFacade:
    def test_reads_come_from_the_owning_module(self):
        assert config.OCR_DPI is env.OCR_DPI
        assert config.purge_valkey_keys is valkey.purge_valkey_keys
        assert config.logger is config.logs.logger

    def test_from_import_works(self):
        from backend.config import THUMB_DIR, get_db

        assert THUMB_DIR == config.paths.THUMB_DIR
        assert get_db is config.db.get_db

    def test_a_patch_reaches_the_code_reading_it(self, monkeypatch):
        """valkey_cache_set reads the TTL and the client inside valkey.py."""

        class _Client:
            def set(self, key, value, ex=None):
                self.call = (key, value, ex)

        client = _Client()
        monkeypatch.setattr(config, "_valkey", client)
        monkeypatch.setattr(config, "PAGE_CACHE_TTL", 42)
        assert valkey._valkey is client
        assert config.valkey_cache_set("page:1", b"x") is True
        assert client.call == ("page:1", b"x", 42)

    def test_patches_are_undone(self, monkeypatch):
        before = env.RENDER_WORKERS
        with monkeypatch.context() as m:
            m.setattr(config, "RENDER_WORKERS", before + 5)
            assert env.RENDER_WORKERS == before + 5
        assert env.RENDER_WORKERS == before
        assert config.RENDER_WORKERS == before

    def test_deleting_a_lazy_setting_resolves_it_again(self, monkeypatch):
        config.VERSION  # resolved and cached in env
        monkeypatch.setenv("APP_VERSION", "4.5.6")
        monkeypatch.delattr(config, "VERSION")
        assert config.VERSION == "4.5.6"

    def test_a_name_no_module_defines_lives_on_the_package(self):
        config.NOT_A_SETTING = 1
        try:
            assert config.__dict__["NOT_A_SETTING"] == 1
            assert not hasattr(env, "NOT_A_SETTING")
        finally:
            del config.NOT_A_SETTING
        assert not hasattr(config, "NOT_A_SETTING")

    def test_unknown_names_raise(self):
        with pytest.raises(AttributeError):
            config.NO_SUCH_SETTING

    def test_imported_helpers_are_not_settings(self):
        """logs imports display_name; it is not one of config's names."""
        assert "display_name" not in config._OWNERS
        assert config._OWNERS["logger"] is config.logs

    def test_dir_lists_every_setting(self):
        names = dir(config)
        assert {"OCR_DPI", "SessionLocal", "startup", "env"} <= set(names)

    def test_reload_re_reads_the_environment(self, monkeypatch):
        try:
            monkeypatch.setenv("OCR_LANGUAGES", "deu+fra")
            importlib.reload(config)
            assert config.OCR_LANGUAGES == "deu+fra"
            assert env.OCR_LANGUAGES == "deu+fra"
        finally:
            monkeypatch.undo()
            importlib.reload(config)
            config.init_database()
        assert config.OCR_LANGUAGES != "deu+fra"


class TestEnvironment:
    def test_every_variable_read_is_documented(self):
        """docs/configuration.md is checked against what env.py reads."""
        text = _DOCS.read_text(encoding="utf-8")
        section = text.split("## Environment variables", 1)[1].split("\n## ", 1)[0]
        mentioned = set(re.findall(r"`([A-Z][A-Z0-9_]+)`", section))
        # Read at call time by the test run itself; not a setting.
        assert env.NAMES - mentioned - {"PYTEST_CURRENT_TEST"} == set()

    def test_every_documented_variable_is_read(self):
        text = _DOCS.read_text(encoding="utf-8")
        section = text.split("## Environment variables", 1)[1].split("\n## ", 1)[0]
        documented = set()
        for line in section.splitlines():
            if line.startswith("| `"):
                documented |= set(re.findall(r"`([A-Z][A-Z0-9_]+)`", line.split("|")[1]))
        # Read by the container entrypoint and the image's uvicorn command, which
        # run before (or outside) the app.
        assert documented - env.NAMES == {"PUID", "PGID", "WORKERS"}

    @pytest.mark.parametrize(
        "raw, expected, warns",
        [(None, 30, False), ("45", 45, False), ("junk", 30, True), ("0", 1, True)],
    )
    def test_positive_int_settings(self, monkeypatch, raw, expected, warns):
        monkeypatch.setattr(env, "_deferred_warnings", [])
        if raw is None:
            monkeypatch.delenv("ACCESS_TOKEN_EXPIRE_MINUTES", raising=False)
        else:
            monkeypatch.setenv("ACCESS_TOKEN_EXPIRE_MINUTES", raw)
        assert env._positive_int_env("ACCESS_TOKEN_EXPIRE_MINUTES", 30) == expected
        assert bool(env._deferred_warnings) is warns

    @pytest.mark.parametrize(
        "raw, expected, warns",
        [(None, 12, False), (" ", 12, False), ("6", 6, False), ("-3", 1, False), ("x", 12, True)],
    )
    def test_password_min_length(self, monkeypatch, raw, expected, warns):
        monkeypatch.setattr(env, "_deferred_warnings", [])
        if raw is None:
            monkeypatch.delenv("PASSWORD_MIN_LENGTH", raising=False)
        else:
            monkeypatch.setenv("PASSWORD_MIN_LENGTH", raw)
        assert env._min_length_env("PASSWORD_MIN_LENGTH", 12) == expected
        assert bool(env._deferred_warnings) is warns

    def test_bad_values_warn_at_startup_not_import(self, monkeypatch, caplog):
        monkeypatch.setattr(env, "_deferred_warnings", [])
        monkeypatch.setenv("REFRESH_TOKEN_EXPIRE_DAYS", "soon")
        assert env._positive_int_env("REFRESH_TOKEN_EXPIRE_DAYS", 30) == 30
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            config.startup()
        assert "REFRESH_TOKEN_EXPIRE_DAYS='soon' is not an integer" in caplog.text

    def test_codex_token_is_stripped(self, monkeypatch):
        monkeypatch.setenv("GRIMOIRE_CODEX_DB_API_TOKEN", "  cdx_x  ")
        assert env._read_codex_db_api_token() == "cdx_x"
        monkeypatch.delenv("GRIMOIRE_CODEX_DB_API_TOKEN")
        assert env._read_codex_db_api_token() == ""

    def test_under_test_run_follows_pytest(self, monkeypatch):
        assert env.under_test_run() is True
        monkeypatch.delenv("PYTEST_CURRENT_TEST")
        assert env.under_test_run() is False

    def test_the_default_trusts_loopback_and_docker_only(self):
        assert env.DEFAULT_TRUSTED_PROXIES == "127.0.0.0/8,::1,172.16.0.0/12"


def test_a_patched_session_factory_is_put_back_working():
    """mock.patch deletes what it found through the facade; the next factory still binds."""
    from unittest.mock import patch

    from backend.models import User

    config.init_database()
    with patch("backend.config.SessionLocal"):
        pass
    db = config.SessionLocal()
    try:
        assert db.bind is config.engine
        db.query(User).first()
    finally:
        db.close()
