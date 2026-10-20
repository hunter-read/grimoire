"""Add-on index URLs need https off the local network, and add-on scripts don't
inherit Grimoire's credentials."""
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
    addon_worker.main(str(script), "{}", str(result))
    assert json.loads(result.read_text()) == {"seen": []}
