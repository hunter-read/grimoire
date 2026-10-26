"""Importing config reads settings; startup() starts the application (issue #585).

Anything that imports the backend - a worker process, a script, a REPL - used
to migrate the database, create directories and connect to Valkey as a side
effect. These pin the split: the import does no I/O, and the I/O happens in
startup(), or on demand the first time a session is opened.
"""
import logging
import os
import subprocess
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

from backend import auth, config
from backend.routers.oidc import _state

_REPO = str(Path(__file__).resolve().parents[2])


def _python(code: str, data: str, **env: str) -> subprocess.CompletedProcess:
    """Run ``code`` in a clean interpreter, so nothing this session imported counts."""
    return subprocess.run(
        [sys.executable, "-c", code],
        capture_output=True,
        text=True,
        cwd=_REPO,
        env={"PATH": "/usr/bin:/bin", "DATA_PATH": data, "LIBRARY_PATH": data, **env},
    )


class TestImportDoesNoIO:
    def test_importing_config_touches_nothing_and_stays_quiet(self, tmp_path):
        data = str(tmp_path / "data")
        proc = _python(
            "import sys, backend.config; "
            "assert 'sqlalchemy' not in sys.modules, 'config loaded SQLAlchemy'; "
            "assert 'redis' not in sys.modules, 'config loaded redis'; "
            "print('ok')",
            data,
            # Each of these is a configuration problem that warns - at startup.
            TZ="Not/AZone",
            UMASK="999",
            CORS_ALLOWED_ORIGINS="*",
            VALKEY_URL="redis://127.0.0.1:1/0",
        )
        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.strip() == "ok"
        assert proc.stderr == ""
        assert not os.path.exists(data)

    def test_importing_the_whole_app_touches_nothing(self, tmp_path):
        """What the Docker image's bytecode warm-up step relies on."""
        data = str(tmp_path / "data")
        proc = _python("import backend.main", data, DISABLE_VERSION_CHECKING="true")
        assert proc.returncode == 0, proc.stderr
        assert not os.path.exists(data)

    def test_a_session_opened_without_startup_initialises_the_database(self, tmp_path):
        """Scripts and tests that never call startup() still get a migrated database."""
        data = str(tmp_path / "data")
        proc = _python(
            "from sqlalchemy import text; from backend.config import SessionLocal; "
            "db = SessionLocal(); "
            "print(db.execute(text('SELECT count(*) FROM users')).scalar()); db.close()",
            data,
        )
        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.strip() == "0"
        assert os.path.isfile(os.path.join(data, "grimoire.db"))


class TestStartup:
    def test_logs_deferred_warnings_once(self, monkeypatch, caplog):
        monkeypatch.setattr(config, "_deferred_warnings", [("TZ=%r is wrong", ("Mars",))])
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            config.startup()
            config.startup()
        assert caplog.text.count("TZ='Mars' is wrong") == 1

    def test_creates_the_data_directories(self, monkeypatch, tmp_path):
        dirs = (str(tmp_path / "a"), str(tmp_path / "a" / "b"))
        monkeypatch.setattr(config, "_DATA_DIRS", dirs)
        config.ensure_data_dirs()
        assert all(os.path.isdir(d) for d in dirs)

    def test_init_database_is_idempotent(self):
        assert config.init_database() is config.init_database() is config.engine
        assert config.SessionLocal.kw["bind"] is config.engine

    def test_get_db_yields_a_session_and_closes_it(self):
        gen = config.get_db()
        db = next(gen)
        assert db.bind is config.engine
        with pytest.raises(StopIteration):
            next(gen)

    def test_version_is_resolved_on_first_use(self, monkeypatch):
        monkeypatch.delitem(config.env.__dict__, "VERSION", raising=False)
        monkeypatch.setenv("APP_VERSION", "9.8.7")
        assert config.VERSION == "9.8.7"
        assert config.env.__dict__["VERSION"] == "9.8.7"

    def test_unknown_attributes_still_raise(self):
        with pytest.raises(AttributeError):
            config.NOT_A_SETTING  # noqa: B018


class TestValkey:
    @pytest.fixture
    def redis_mod(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        monkeypatch.setattr(config, "VALKEY_URL", "redis://:hunter2@cache:6379/0")
        fake = MagicMock()
        with patch.dict(sys.modules, {"redis": fake}):
            yield fake

    def test_unset_means_no_client(self, monkeypatch):
        monkeypatch.setattr(config, "_valkey", None)
        monkeypatch.setattr(config, "VALKEY_URL", "")
        assert config.connect_valkey() is None
        assert config.valkey_client() is None

    def test_connects_with_timeouts(self, redis_mod, caplog):
        with caplog.at_level(logging.INFO, logger="grimoire"):
            client = config.connect_valkey()
        assert client is redis_mod.from_url.return_value
        assert config.valkey_client() is client
        kwargs = redis_mod.from_url.call_args.kwargs
        # Without these an unreachable host stalls start-up for minutes.
        assert kwargs["socket_connect_timeout"] == config.VALKEY_CONNECT_TIMEOUT
        assert kwargs["socket_timeout"] == config.VALKEY_SOCKET_TIMEOUT
        assert "hunter2" not in caplog.text
        # Already connected: no second connection.
        assert config.connect_valkey() is client
        assert redis_mod.from_url.call_count == 1

    def test_a_failed_connection_falls_back_to_disk(self, redis_mod, caplog):
        redis_mod.from_url.return_value.ping.side_effect = TimeoutError("timed out")
        with caplog.at_level(logging.WARNING, logger="grimoire"):
            assert config.connect_valkey() is None
        assert config.valkey_client() is None
        assert "falling back to disk cache" in caplog.text


    def test_the_rate_limiter_store_gets_the_same_timeouts(self, tmp_path):
        proc = _python(
            "import backend.security as s; o = s.limiter._storage_options; "
            "print(o['socket_connect_timeout'], o['socket_timeout'])",
            str(tmp_path / "data"),
            VALKEY_URL="redis://cache:6379/0",
        )
        assert proc.returncode == 0, proc.stderr
        assert proc.stdout.split() == [
            str(config.VALKEY_CONNECT_TIMEOUT),
            str(config.VALKEY_SOCKET_TIMEOUT),
        ]


class TestOidcStoresChooseLate:
    def test_the_backend_is_chosen_on_first_use(self, monkeypatch):
        """Valkey connects in startup(), after this module is imported."""
        store, jwks = _state._LazyStateStore(), _state._LazyJWKSCache()
        fake = MagicMock()
        fake.getdel.return_value = None
        fake.get.return_value = None
        monkeypatch.setattr(config, "_valkey", fake)
        store.put("s", {"a": 1})
        assert store.pop("s") is None  # answered by the fake Valkey
        jwks.set("https://idp/jwks", {"keys": []})
        assert jwks.get("https://idp/jwks") is None
        assert isinstance(store._backend(), _state.ValkeyStateStore)
        assert isinstance(jwks._backend(), _state.ValkeyJWKSCache)


class TestSecretKey:
    def test_importing_auth_writes_no_key(self, tmp_path):
        data = str(tmp_path / "data")
        proc = _python(
            "import os, backend.auth as a; "
            "assert not os.path.exists(os.path.join(os.environ['DATA_PATH'], 'secret_key')); "
            "assert len(a.SECRET_KEY) == 64; "
            "assert os.path.exists(os.path.join(os.environ['DATA_PATH'], 'secret_key')); "
            "print('ok')",
            data,
        )
        assert proc.returncode == 0, proc.stderr
        assert "ok" in proc.stdout

    def test_resolved_once_and_used_for_tokens(self):
        assert auth.SECRET_KEY == auth._secret_key()
        token = auth.create_token("u", "n", "player")
        assert auth.decode_token(token)["sub"] == "u"

    def test_unknown_attributes_still_raise(self):
        with pytest.raises(AttributeError):
            auth.NOT_A_SETTING  # noqa: B018
