"""Access tokens for private add-on index sources (issue #642)."""
import hashlib
import json

import httpx
import pytest
import yaml

from backend import auth, config
from backend.addons import credentials, fetch, install, registry
from backend.addons.constants import (
    SETTING_INDEX_CACHE,
    SETTING_INDEX_CREDENTIALS,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.addons.credentials import SourceCredential, SourceCredentials
from backend.addons.registry import AddonError
from backend.config import SessionLocal
from backend.models import AppSetting

PRIVATE = "https://raw.githubusercontent.com/our-table/private-packs/main/index.json"
PUBLIC = "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json"
GITEA = "https://git.example.org/table/packs/raw/branch/main/index.json"

MANIFEST = {
    "id": "secret-scraper",
    "name": "Secret Scraper",
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
        for key in (SETTING_INDEX_URL, SETTING_INDEX_CREDENTIALS, SETTING_INDEX_CACHE, SETTING_INSTALLED):
            row = session.query(AppSetting).filter_by(key=key).first()
            if row:
                session.delete(row)
        session.commit()
        session.close()


@pytest.fixture(autouse=True)
def no_env_pins(monkeypatch, tmp_path):
    monkeypatch.setattr(config, "ADDON_INDEX_CREDENTIALS", "")
    # The response cache is cleared on every change; keep it out of DATA_PATH.
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(tmp_path / "cache"))


@pytest.fixture
def serve(monkeypatch):
    """Route every httpx.Client through a handler and record what it was sent."""
    seen: list[httpx.Request] = []
    routes: dict[str, httpx.Response] = {}
    real_client = httpx.Client

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        response = routes.get(str(request.url))
        if response is None:
            return httpx.Response(404)
        return response

    def _client(**kwargs):
        kwargs.pop("transport", None)
        return real_client(transport=httpx.MockTransport(handler), **kwargs)

    monkeypatch.setattr(httpx, "Client", _client)
    return routes, seen


def _configure(db, *urls):
    registry.set_index_url(db, ",".join(urls))
    db.commit()


def _headers_sent(seen, url):
    return [r.headers for r in seen if str(r.url) == url]


class TestScope:
    def test_an_index_file_scopes_to_its_directory(self):
        assert credentials.source_root(PRIVATE) == "/our-table/private-packs/main/"

    def test_an_index_in_a_sibling_catalogue_scopes_to_the_repo_root(self):
        url = "https://raw.githubusercontent.com/o/r/main/themes/index.json"
        assert credentials.source_root(url) == "/o/r/main/"

    def test_a_directory_url_is_its_own_root(self):
        assert credentials.source_root("https://h.example/o/r/main") == "/o/r/main/"

    def test_covers_files_inside_the_source(self):
        cred = SourceCredential(PRIVATE, "Authorization", "t")
        assert cred.covers("https://raw.githubusercontent.com/our-table/private-packs/main/a/b.yml")
        assert cred.covers(
            "https://raw.githubusercontent.com/our-table/private-packs/main/character-sheets/index.json"
        )

    def test_does_not_cover_another_repo_on_the_same_host(self):
        assert not SourceCredential(PRIVATE, "Authorization", "t").covers(PUBLIC)

    def test_does_not_cover_another_host_scheme_or_port(self):
        cred = SourceCredential(GITEA, "Authorization", "t")
        assert not cred.covers("https://evil.example/table/packs/raw/branch/main/x.json")
        assert not cred.covers("http://git.example.org/table/packs/raw/branch/main/x.json")
        assert not cred.covers("https://git.example.org:8443/table/packs/raw/branch/main/x.json")
        assert cred.covers("https://git.example.org:443/table/packs/raw/branch/main/x.json")

    def test_the_deepest_covering_source_wins(self):
        outer = SourceCredential("https://h.example/o/index.json", "Authorization", "outer")
        inner = SourceCredential("https://h.example/o/r/index.json", "Authorization", "inner")
        creds = SourceCredentials([outer, inner])
        assert creds.for_url("https://h.example/o/r/x.json") is inner
        assert creds.for_url("https://h.example/o/x.json") is outer
        assert creds.for_url("https://other.example/o/x.json") is None


class TestHeaders:
    def test_authorization_is_sent_as_bearer(self):
        creds = SourceCredentials([SourceCredential(PRIVATE, "Authorization", "abc")])
        assert creds.headers_for(PRIVATE) == {"Authorization": "Bearer abc"}

    def test_a_token_naming_its_own_scheme_is_sent_as_is(self):
        creds = SourceCredentials([SourceCredential(GITEA, "Authorization", "token abc")])
        assert creds.headers_for(GITEA) == {"Authorization": "token abc"}

    def test_a_custom_header_carries_the_bare_token(self):
        creds = SourceCredentials([SourceCredential(GITEA, "PRIVATE-TOKEN", "abc")])
        assert creds.headers_for(GITEA) == {"PRIVATE-TOKEN": "abc"}

    def test_nothing_for_a_url_outside_every_source(self):
        creds = SourceCredentials([SourceCredential(PRIVATE, "Authorization", "abc")])
        assert creds.headers_for(PUBLIC) == {}
        assert not SourceCredentials()

    def test_a_redirect_out_of_the_source_drops_a_custom_header(self, serve):
        routes, seen = serve
        elsewhere = "https://cdn.example.net/blob.json"
        routes[GITEA] = httpx.Response(302, headers={"Location": elsewhere})
        routes[elsewhere] = httpx.Response(200, json={"addons": []})
        creds = SourceCredentials([SourceCredential(GITEA, "PRIVATE-TOKEN", "secret")])

        assert fetch.fetch_json(GITEA, credentials=creds) == {"addons": []}

        assert _headers_sent(seen, GITEA)[0]["PRIVATE-TOKEN"] == "secret"
        assert "PRIVATE-TOKEN" not in _headers_sent(seen, elsewhere)[0]

    def test_a_redirect_within_the_source_keeps_the_token(self, serve):
        routes, seen = serve
        moved = GITEA.replace("index.json", "v2/index.json")
        routes[GITEA] = httpx.Response(301, headers={"Location": moved})
        routes[moved] = httpx.Response(200, json={"addons": []})
        creds = SourceCredentials([SourceCredential(GITEA, "Authorization", "secret")])

        fetch.fetch_json(GITEA, credentials=creds)

        assert _headers_sent(seen, moved)[0]["Authorization"] == "Bearer secret"

    def test_no_credentials_sends_no_auth_header(self, serve):
        routes, seen = serve
        routes[PRIVATE] = httpx.Response(200, json={})
        fetch.fetch_json(PRIVATE)
        assert "Authorization" not in seen[0].headers


class TestStorage:
    def test_a_stored_token_is_sealed(self, db):
        _configure(db, PRIVATE)
        credentials.set_credential(db, PRIVATE, "github_pat_plaintext", None, [PRIVATE])
        db.commit()

        raw = db.query(AppSetting).filter_by(key=SETTING_INDEX_CREDENTIALS).one().value
        assert "github_pat_plaintext" not in raw
        assert credentials.load(db).headers_for(PRIVATE) == {
            "Authorization": "Bearer github_pat_plaintext"
        }

    def test_describe_never_includes_the_token(self, db):
        credentials.set_credential(db, PRIVATE, "github_pat_plaintext", "X-Token", [PRIVATE])
        described = credentials.describe(db, [PRIVATE, PUBLIC])
        assert described == {PRIVATE: {"header": "X-Token", "env_locked": False, "unreadable": False}}
        assert "github_pat_plaintext" not in json.dumps(described)

    def test_a_token_is_unreadable_after_secret_key_changes(self, db, monkeypatch):
        credentials.set_credential(db, PRIVATE, "tok", None, [PRIVATE])
        monkeypatch.setattr(auth, "SECRET_KEY", "a-different-secret-key-entirely")
        assert not credentials.load(db)
        assert credentials.describe(db, [PRIVATE])[PRIVATE]["unreadable"] is True

    def test_only_a_configured_source_takes_a_token(self, db):
        with pytest.raises(AddonError, match="Add this index URL"):
            credentials.set_credential(db, PRIVATE, "tok", None, [PUBLIC])

    def test_a_trailing_slash_still_matches_the_source(self, db):
        credentials.set_credential(db, PRIVATE + "/", "tok", None, [PRIVATE])
        assert PRIVATE in credentials.describe(db, [PRIVATE])

    @pytest.mark.parametrize(
        "token, header, message",
        [
            ("", None, "Enter the access token"),
            ("a\nb", None, "line break"),
            ("x" * 5000, None, "too long"),
            ("tok", "Host", "cannot be used"),
            ("tok", "Cookie", "cannot be used"),
            ("tok", "Bad Header", "cannot be used"),
        ],
    )
    def test_refuses_unusable_values(self, db, token, header, message):
        with pytest.raises(AddonError, match=message):
            credentials.set_credential(db, PRIVATE, token, header, [PRIVATE])

    def test_clear_forgets_the_token(self, db):
        credentials.set_credential(db, PRIVATE, "tok", None, [PRIVATE])
        credentials.clear_credential(db, PRIVATE, [PRIVATE])
        assert not credentials.load(db)
        assert credentials.describe(db, [PRIVATE]) == {}

    def test_prune_drops_tokens_for_removed_sources(self, db):
        credentials.set_credential(db, PRIVATE, "a", None, [PRIVATE, GITEA])
        credentials.set_credential(db, GITEA, "b", None, [PRIVATE, GITEA])
        credentials.prune(db, [GITEA])
        assert list(credentials.describe(db, [PRIVATE, GITEA])) == [GITEA]

    def test_changing_a_token_clears_the_response_cache(self, db):
        fetch.write_cache(PRIVATE, {"addons": []})
        assert fetch.read_cache(PRIVATE, 3600) is not None
        credentials.set_credential(db, PRIVATE, "tok", None, [PRIVATE])
        assert fetch.read_cache(PRIVATE, 3600) is None

        fetch.write_cache(PRIVATE, {"addons": []})
        credentials.clear_credential(db, PRIVATE, [PRIVATE])
        assert fetch.read_cache(PRIVATE, 3600) is None

    def test_a_corrupt_setting_reads_as_none(self, db):
        db.add(AppSetting(key=SETTING_INDEX_CREDENTIALS, value="{not json"))
        db.commit()
        assert not credentials.load(db)
        assert credentials.describe(db, [PRIVATE]) == {}


class TestEnvironmentPins:
    def test_a_bare_token_or_an_object(self, db, monkeypatch):
        monkeypatch.setattr(
            config,
            "ADDON_INDEX_CREDENTIALS",
            json.dumps({PRIVATE: "abc", GITEA: {"token": "def", "header": "PRIVATE-TOKEN"}}),
        )
        creds = credentials.load(db)
        assert creds.headers_for(PRIVATE) == {"Authorization": "Bearer abc"}
        assert creds.headers_for(GITEA) == {"PRIVATE-TOKEN": "def"}

    def test_a_pin_wins_over_the_stored_token_and_is_locked(self, db, monkeypatch):
        credentials.set_credential(db, PRIVATE, "stored", None, [PRIVATE])
        monkeypatch.setattr(config, "ADDON_INDEX_CREDENTIALS", json.dumps({PRIVATE: "pinned"}))

        assert credentials.load(db).headers_for(PRIVATE) == {"Authorization": "Bearer pinned"}
        assert credentials.describe(db, [PRIVATE])[PRIVATE]["env_locked"] is True
        with pytest.raises(AddonError, match="ADDON_INDEX_CREDENTIALS"):
            credentials.set_credential(db, PRIVATE, "new", None, [PRIVATE])
        with pytest.raises(AddonError, match="ADDON_INDEX_CREDENTIALS"):
            credentials.clear_credential(db, PRIVATE, [PRIVATE])

    @pytest.mark.parametrize(
        "value",
        ["{not json", json.dumps(["a"]), json.dumps({PRIVATE: {"token": ""}}), json.dumps({PRIVATE: 3})],
    )
    def test_a_bad_pin_is_ignored(self, db, monkeypatch, value):
        monkeypatch.setattr(config, "ADDON_INDEX_CREDENTIALS", value)
        assert not credentials.load(db)


class TestFetchesUseTheToken:
    def test_refresh_sends_the_token_to_the_private_index_only(self, db, serve, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        routes, seen = serve
        routes[PRIVATE] = httpx.Response(200, json={"version": 1, "addons": []})
        routes[PUBLIC] = httpx.Response(200, json={"version": 1, "addons": []})
        _configure(db, PUBLIC, PRIVATE)
        credentials.set_credential(db, PRIVATE, "secret", None, [PUBLIC, PRIVATE])

        install.refresh_index(db)

        assert _headers_sent(seen, PRIVATE)[0]["Authorization"] == "Bearer secret"
        assert "Authorization" not in _headers_sent(seen, PUBLIC)[0]

    def test_install_downloads_the_manifest_with_the_token(self, db, serve, monkeypatch, tmp_path):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        monkeypatch.setattr(registry, "ADDONS_DIR", str(tmp_path / "add-ons"))
        routes, seen = serve
        body = yaml.safe_dump(MANIFEST).encode()
        manifest_url = PRIVATE.replace("index.json", "add-ons/secret-scraper.yml")
        routes[manifest_url] = httpx.Response(200, content=body)
        routes[PRIVATE] = httpx.Response(
            200,
            json={
                "version": 1,
                "addons": [
                    {
                        "id": "secret-scraper",
                        "name": "Secret Scraper",
                        "version": "1.0.0",
                        "kind": "scraper",
                        "path": "add-ons/secret-scraper.yml",
                        "sha256": hashlib.sha256(body).hexdigest(),
                    }
                ],
            },
        )
        _configure(db, PRIVATE)
        credentials.set_credential(db, PRIVATE, "secret", None, [PRIVATE])

        install.refresh_index(db)
        record = install.install(db, "secret-scraper")

        assert record["version"] == "1.0.0"
        assert _headers_sent(seen, manifest_url)[0]["Authorization"] == "Bearer secret"


class TestApi:
    @pytest.fixture
    def private_source(self, client, admin_headers):
        resp = client.patch(
            "/api/addons/settings", json={"index_urls": [PUBLIC, PRIVATE]}, headers=admin_headers
        )
        assert resp.status_code == 200
        yield
        client.patch("/api/addons/settings", json={"index_urls": [PUBLIC]}, headers=admin_headers)

    def test_set_list_and_clear(self, client, admin_headers, private_source):
        resp = client.put(
            "/api/addons/sources/credential",
            json={"url": PRIVATE, "token": "github_pat_secret"},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert resp.json()["source_credentials"][PRIVATE]["header"] == "Authorization"
        assert "github_pat_secret" not in resp.text

        listed = client.get("/api/addons", headers=admin_headers)
        assert PRIVATE in listed.json()["source_credentials"]
        assert "github_pat_secret" not in listed.text

        resp = client.delete(
            "/api/addons/sources/credential", params={"url": PRIVATE}, headers=admin_headers
        )
        assert resp.status_code == 200
        assert resp.json()["source_credentials"] == {}

    def test_refuses_an_unconfigured_source(self, client, admin_headers):
        resp = client.put(
            "/api/addons/sources/credential",
            json={"url": "https://elsewhere.example/index.json", "token": "x"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_clearing_an_unconfigured_source_is_refused(self, client, admin_headers):
        resp = client.delete(
            "/api/addons/sources/credential",
            params={"url": "https://elsewhere.example/index.json"},
            headers=admin_headers,
        )
        assert resp.status_code == 400

    def test_removing_the_source_drops_its_token(self, client, admin_headers, private_source):
        client.put(
            "/api/addons/sources/credential",
            json={"url": PRIVATE, "token": "x"},
            headers=admin_headers,
        )
        client.patch("/api/addons/settings", json={"index_urls": [PUBLIC]}, headers=admin_headers)
        client.patch(
            "/api/addons/settings", json={"index_urls": [PUBLIC, PRIVATE]}, headers=admin_headers
        )
        assert client.get("/api/addons", headers=admin_headers).json()["source_credentials"] == {}

    def test_requires_admin(self, client, gm_headers):
        resp = client.put(
            "/api/addons/sources/credential", json={"url": PRIVATE, "token": "x"}, headers=gm_headers
        )
        assert resp.status_code == 403
        resp = client.delete(
            "/api/addons/sources/credential", params={"url": PRIVATE}, headers=gm_headers
        )
        assert resp.status_code == 403


class TestCatalogueDownloadsUseTheToken:
    """Sheets, packs, themes and note templates come from the same sources."""

    BASE = PRIVATE.rsplit("/", 1)[0]

    @pytest.fixture(autouse=True)
    def private(self, db, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        _configure(db, PRIVATE)
        credentials.set_credential(db, PRIVATE, "secret", None, [PRIVATE])
        db.commit()

    def _sent_token(self, seen, url):
        sent = _headers_sent(seen, url)
        assert sent, f"{url} was never requested"
        return sent[0].get("Authorization")

    def test_sheet_catalogue_and_download(self, db, serve):
        from backend.services.characters import catalogue

        _, seen = serve
        catalogue.fetch_catalogue(db)
        assert self._sent_token(seen, PRIVATE) == "Bearer secret"

        entry = {"id": "s", "path": "character-sheets/s/s.json", "index_url": f"{self.BASE}/character-sheets/index.json"}
        with pytest.raises(catalogue.CatalogueError):
            catalogue.fetch_sheet(db, entry)
        assert self._sent_token(seen, f"{self.BASE}/character-sheets/s/s.json") == "Bearer secret"

    def test_pack_catalogue_and_download(self, db, serve):
        from backend.services.characters import pack_catalogue

        _, seen = serve
        pack_catalogue.fetch_pack_catalogue(db)
        assert self._sent_token(seen, f"{self.BASE}/content-packs/index.json") == "Bearer secret"

        entry = {
            "pack_id": "p",
            "index_url": f"{self.BASE}/content-packs/index.json",
            "files": [{"name": "_meta.json", "path": "content-packs/p/_meta.json"}],
        }
        with pytest.raises(pack_catalogue.PackCatalogueError):
            pack_catalogue.install_pack(db, entry)
        assert self._sent_token(seen, f"{self.BASE}/content-packs/p/_meta.json") == "Bearer secret"

    def test_theme_catalogue_and_download(self, db, serve):
        from backend.services import themes

        _, seen = serve
        themes.fetch_catalogue(db)
        assert self._sent_token(seen, PRIVATE) == "Bearer secret"

        entry = {"id": "t", "path": "themes/t.json", "index_url": f"{self.BASE}/themes/index.json"}
        with pytest.raises(themes.ThemeError):
            themes.fetch_theme(db, entry)
        assert self._sent_token(seen, f"{self.BASE}/themes/t.json") == "Bearer secret"

    def test_template_catalogue_and_download(self, db, serve):
        from backend.services import wiki_template_catalogue as templates

        _, seen = serve
        with pytest.raises(templates.TemplateCatalogueError):
            templates.fetch_catalogue(db)
        assert self._sent_token(seen, PRIVATE) == "Bearer secret"

        entry = {"id": "n", "body_path": "templates/n.md", "index_url": f"{self.BASE}/templates/index.json"}
        with pytest.raises(templates.TemplateCatalogueError):
            templates.fetch_body(db, entry)
        assert self._sent_token(seen, f"{self.BASE}/templates/n.md") == "Bearer secret"
