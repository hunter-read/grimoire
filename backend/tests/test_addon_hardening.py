"""Add-on index URLs need https off the local network, and add-on scripts don't
inherit Grimoire's credentials."""
import os
from unittest.mock import patch

import pytest

from backend.addon_worker import scrub_environment
from backend.addons.urls import index_url_problem


@pytest.mark.parametrize(
    "url",
    [
        "https://raw.githubusercontent.com/org/repo/main/index.json",
        "http://localhost:8000/index.json",
        "http://127.0.0.1/index.json",
        "http://[::1]:8080/index.json",
        "http://192.168.1.20/index.json",
        "http://10.0.0.5:9000/index.json",
        "http://mirror.localhost/index.json",
    ],
)
def test_allowed_index_urls(url):
    assert index_url_problem(url) is None


@pytest.mark.parametrize(
    "url",
    ["http://example.com/index.json", "http://8.8.8.8/index.json", "ftp://x/index.json",
     "file:///etc/passwd", "https://", "nonsense"],
)
def test_refused_index_urls(url):
    assert index_url_problem(url)


def test_settings_refuse_plain_http_index(client, admin_headers):
    resp = client.patch(
        "/api/addons/settings",
        json={"index_urls": ["http://example.com/index.json"]},
        headers=admin_headers,
    )
    assert resp.status_code == 422
    assert "https" in resp.text


def test_refresh_refuses_a_plain_http_index_without_fetching(monkeypatch):
    from backend.addons import install
    from backend.addons.install import AddonError

    monkeypatch.setattr(install, "_assert_external_installs_enabled", lambda: None)

    def no_fetch(url, credentials=None):
        raise AssertionError(f"fetched {url}")

    monkeypatch.setattr(install, "_fetch_text", no_fetch)
    with pytest.raises(AddonError, match="https"):
        install.refresh_index(None, url="http://example.com/index.json")


def test_worker_environment_is_scrubbed():
    env = {
        "SECRET_KEY": "s", "OIDC_CLIENT_SECRET": "o", "GRIMOIRE_CODEX_DB_API_TOKEN": "t",
        "VALKEY_URL": "redis://:pw@valkey:6379/0", "SOME_PASSWORD": "p",
        "PATH": "/usr/bin", "HOME": "/data", "LANG": "C.UTF-8", "TZ": "UTC",
    }
    removed = scrub_environment(env)
    assert set(env) == {"PATH", "HOME", "LANG", "TZ"}
    assert "SECRET_KEY" in removed and "VALKEY_URL" in removed


def test_worker_environment_scrub_covers_other_credentials():
    env = {
        "ADDON_INDEX_CREDENTIALS": '{"https://example.com/index.json": "tok"}',
        "AWS_ACCESS_KEY_ID": "a",
        "ENCRYPTION_KEY": "e",
        "SENTRY_DSN": "https://x@sentry.example/1",
        "HTTPS_PROXY": "http://user:pw@proxy:3128",
        "REDIS_URL": "redis://:pw@redis:6379/0",
        "GOOGLE_APPLICATION_CREDENTIALS": "/data/sa.json",
        # Kept: no credential in the name or the value.
        "BASE_URL": "https://grimoire.example",
        "HTTP_PROXY": "http://proxy:3128",
        "KEYBOARD": "us",
        "DATA_PATH": "/data",
    }
    removed = scrub_environment(env)
    assert set(env) == {"BASE_URL", "HTTP_PROXY", "KEYBOARD", "DATA_PATH"}
    assert "ADDON_INDEX_CREDENTIALS" in removed


def test_worker_scrubs_before_running_the_script(tmp_path, monkeypatch):
    import json

    from backend import addon_worker

    script = tmp_path / "s.py"
    script.write_text(
        "import json, os, sys\n"
        "def main():\n"
        "    json.load(sys.stdin)\n"
        "    print(json.dumps({'seen': sorted(k for k in os.environ if 'SECRET' in k)}))\n"
    )
    result = tmp_path / "r.json"
    monkeypatch.setenv("SECRET_KEY", "should-not-reach-the-script")
    # main() is the child's entry point and scrubs the real environment; keep
    # it off this process's, or DATABASE_URL goes for every later test.
    with patch.dict(os.environ):
        addon_worker.main(str(script), "{}", str(result))
    assert json.loads(result.read_text()) == {"seen": []}


def test_worker_keeps_the_variables_an_add_on_declared():
    env = {"BGG_API_TOKEN": "bgg", "OTHER_API_TOKEN": "o", "PATH": "/usr/bin"}
    removed = scrub_environment(env, keep=["BGG_API_TOKEN"])
    assert env == {"BGG_API_TOKEN": "bgg", "PATH": "/usr/bin"}
    assert removed == ["OTHER_API_TOKEN"]


def test_worker_never_keeps_grimoires_own_credentials():
    env = {
        "SECRET_KEY": "s", "GRIMOIRE_CODEX_DB_API_TOKEN": "t", "OIDC_CLIENT_SECRET": "o",
        "ADDON_INDEX_CREDENTIALS": "{}", "VALKEY_URL": "redis://:pw@valkey:6379/0",
    }
    scrub_environment(env, keep=list(env))
    assert env == {}


def test_worker_hands_declared_variables_to_the_script(tmp_path, monkeypatch):
    import json

    from backend import addon_worker

    script = tmp_path / "s.py"
    script.write_text(
        "import json, os, sys\n"
        "def main():\n"
        "    json.load(sys.stdin)\n"
        "    print(json.dumps({'token': os.environ.get('BGG_API_TOKEN')}))\n"
    )
    result = tmp_path / "r.json"
    monkeypatch.setenv("BGG_API_TOKEN", "bgg")
    with patch.dict(os.environ):
        addon_worker.main(str(script), "{}", str(result), ["BGG_API_TOKEN"])
    assert json.loads(result.read_text()) == {"token": "bgg"}


@pytest.mark.parametrize(
    "name", ["SECRET_KEY", "GRIMOIRE_CODEX_DB_API_TOKEN", "OIDC_CLIENT_SECRET", "bgg_token", "A-B"]
)
def test_manifest_refuses_reserved_or_malformed_env_names(name):
    from pydantic import ValidationError

    from backend.addons.manifest import ScriptSpec

    with pytest.raises(ValidationError):
        ScriptSpec(entry="run.py", env=[name])


def test_manifest_accepts_declared_env_names():
    from backend.addons.manifest import ScriptSpec

    assert ScriptSpec(entry="run.py", env=["BGG_API_TOKEN"]).env == ["BGG_API_TOKEN"]
    assert ScriptSpec(entry="run.py").env == []
