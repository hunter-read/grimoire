"""The community catalogues name their sources to an admin only.

The sources are the admin's configuration. Anyone else browsing the sheet,
pack, theme or note-template catalogue sees the entries, and that a source
failed, but not the configured URL or the reason it could not be read.
"""
import uuid

import pytest

from backend import config
from backend.addons import credentials
from backend.services import catalogue_sources
from backend.services import themes as theme_svc
from backend.services import wiki_template_catalogue as wiki_svc
from backend.services.characters import catalogue as sheet_svc
from backend.services.characters import pack_catalogue as pack_svc

SECRET = "https://internal-mirror.example.test/private-branch/index.json"
REASON = "connection refused by internal-mirror.example.test"


@pytest.fixture(autouse=True)
def unreachable(monkeypatch):
    """One custom source, configured by the admin, that cannot be reached."""
    monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
    monkeypatch.setattr(credentials, "load", lambda db: credentials.SourceCredentials())

    def _raise(url, **kwargs):
        raise sheet_svc.AddonFetchError(REASON)

    for module in (sheet_svc, pack_svc, theme_svc, wiki_svc):
        monkeypatch.setattr(module, "fetch_document", _raise)
        monkeypatch.setattr(module, "get_index_urls", lambda db: [SECRET])


def _hides(body) -> None:
    text = str(body)
    assert "internal-mirror" not in text
    assert REASON not in text


@pytest.mark.parametrize(
    "path,kind",
    [("/api/characters/schemas/browse", "sheets"), ("/api/rulesets/packs/browse", "packs")],
)
def test_sheet_and_pack_catalogues(client, player_headers, admin_headers, path, kind):
    body = client.get(path, headers=player_headers).json()
    assert body[kind] == []
    # The failure still counts, so the browser can say something is missing.
    assert body["errors"] == [{"url": "", "error": ""}]
    assert body["sources"] == []
    _hides(body)

    shown = client.get(path, headers=admin_headers).json()
    assert shown["errors"][0]["url"].startswith("https://internal-mirror.example.test/")
    assert REASON in shown["errors"][0]["error"]
    assert any("internal-mirror" in source for source in shown["sources"])


def test_sheet_catalogue_index_url(client, player_headers, admin_headers):
    path = "/api/characters/schemas/browse"
    assert client.get(path, headers=player_headers).json()["index_url"] == ""
    assert "internal-mirror" in client.get(path, headers=admin_headers).json()["index_url"]


@pytest.mark.parametrize("path", ["/api/themes/browse", "/api/themes"])
def test_theme_routes(client, player_headers, admin_headers, path):
    body = client.get(path, headers=player_headers).json()
    assert body["index_url"] == ""
    _hides(body)
    assert client.get(path, headers=admin_headers).json()["index_url"] == SECRET


def _campaign(client, headers):
    r = client.post(
        "/api/campaigns",
        json={"name": f"Sources {uuid.uuid4().hex[:6]}", "is_gm_campaign": True},
        headers=headers,
    )
    assert r.status_code == 201, r.text
    return r.json()["id"]


def test_note_template_catalogue(client, gm_headers, admin_headers):
    gm_campaign = _campaign(client, gm_headers)
    r = client.get(f"/api/campaigns/{gm_campaign}/wiki/templates/browse", headers=gm_headers)
    assert r.status_code == 502
    assert r.json()["detail"] == catalogue_sources.UNREADABLE
    _hides(r.json())

    admin_campaign = _campaign(client, admin_headers)
    r = client.get(
        f"/api/campaigns/{admin_campaign}/wiki/templates/browse", headers=admin_headers
    )
    assert r.status_code == 502
    assert REASON in r.json()["detail"]


def test_note_template_index_url(client, gm_headers, admin_headers, monkeypatch):
    doc = {"version": 1, "folders": [], "templates": [{"id": "t", "name": "T"}]}
    monkeypatch.setattr(wiki_svc, "fetch_catalogue", lambda db, force=False: doc)
    monkeypatch.setattr(wiki_svc, "get_index_url", lambda db: SECRET)
    gm_campaign = _campaign(client, gm_headers)
    body = client.get(
        f"/api/campaigns/{gm_campaign}/wiki/templates/browse", headers=gm_headers
    ).json()
    assert body["index_url"] == ""
    assert body["default_index_url"] == config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
    admin_campaign = _campaign(client, admin_headers)
    body = client.get(
        f"/api/campaigns/{admin_campaign}/wiki/templates/browse", headers=admin_headers
    ).json()
    assert body["index_url"] == SECRET


def test_source_failures_helper():
    errors = [{"url": SECRET, "error": REASON}, {"url": "b", "error": "c"}]
    assert catalogue_sources.source_failures(errors, True) is errors
    assert catalogue_sources.source_failures(errors, False) == [{"url": "", "error": ""}] * 2
    assert catalogue_sources.shows_sources(type("U", (), {"role": "admin"})())
    assert not catalogue_sources.shows_sources(type("U", (), {"role": "gm"})())
    assert not catalogue_sources.shows_sources(None)
