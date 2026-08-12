"""Tests for per-user colour themes: validation, install, selection, isolation.

The validation tests carry the most weight here. A theme is untrusted input
whose values end up in a stylesheet, so the token allowlist and the colour
grammar are the security boundary, not a convenience.
"""
import hashlib
import json

import pytest

from backend import config
from backend.config import SessionLocal
from backend.models import AppSetting
from backend.services import themes as svc

VALID_TOKENS = {"text": "#ffffff", "bg-card": "#101010", "accent": "#c9a84c"}


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.query(AppSetting).filter_by(key=svc.SETTING_INDEX_URL).delete()
        session.commit()
        session.close()


def _theme_doc(**over):
    doc = {
        "id": "midnight",
        "name": "Midnight",
        "mode": "dark",
        "version": "1.0.0",
        "tokens": dict(VALID_TOKENS),
    }
    doc.update(over)
    return doc


class TestColourValidation:
    @pytest.mark.parametrize(
        "value",
        [
            "#fff",
            "#FFFFFF",
            "#c9a84cff",
            "rgb(1, 2, 3)",
            "rgba(1,2,3,0.5)",
            "hsl(30, 40%, 50%)",
            "hsla(30, 40%, 50%, 0.5)",
            "transparent",
            "currentcolor",
        ],
    )
    def test_accepts_plain_colours(self, value):
        assert svc.is_safe_color(value) is True

    @pytest.mark.parametrize(
        "value",
        [
            # The whole point: a value must not be able to end its declaration
            # and start another one.
            "red; background: url(https://evil.example/pixel.png)",
            "#fff; position: fixed",
            "url(https://evil.example/x.png)",
            "expression(alert(1))",
            "#fff /* } body { display:none */",
            "var(--something)",
            "javascript:alert(1)",
            "",
            "   ",
            None,
            42,
            ["#fff"],
        ],
    )
    def test_rejects_anything_else(self, value):
        assert svc.is_safe_color(value) is False

    def test_rejects_an_overlong_value(self):
        assert svc.is_safe_color("#" + "a" * 200) is False


class TestTokenAllowlist:
    def test_keeps_known_tokens(self):
        assert svc.sanitize_tokens(VALID_TOKENS) == VALID_TOKENS

    def test_drops_unknown_token_names(self):
        dirty = {"background-image": "url(x)", "font-family": "evil", "text": "#fff"}
        assert svc.sanitize_tokens(dirty) == {"text": "#fff"}

    def test_drops_known_tokens_with_unsafe_values(self):
        dirty = {"text": "red; background: url(https://evil.example/)", "accent": "#fff"}
        assert svc.sanitize_tokens(dirty) == {"accent": "#fff"}

    def test_tolerates_junk(self):
        assert svc.sanitize_tokens(None) == {}
        assert svc.sanitize_tokens("nope") == {}
        assert svc.sanitize_tokens([1, 2]) == {}

    def test_the_allowlist_matches_the_frontend(self):
        """The two lists are the same contract; drift would silently drop tokens."""
        import pathlib
        import re

        src = pathlib.Path(__file__).resolve().parents[2] / "frontend/src/utils/theme.js"
        body = src.read_text()
        block = body[body.index("THEME_TOKENS = ["): body.index("]", body.index("THEME_TOKENS = ["))]
        frontend = set(re.findall(r"'([a-z-]+)'", block))
        assert frontend == set(svc.THEME_TOKENS)


class TestParseTheme:
    def test_parses_a_well_formed_theme(self):
        theme = svc.parse_theme(_theme_doc())
        assert theme["id"] == "midnight"
        assert theme["name"] == "Midnight"
        assert theme["mode"] == "dark"
        assert theme["tokens"] == VALID_TOKENS

    def test_rejects_a_theme_with_no_recognised_tokens(self):
        with pytest.raises(svc.ThemeError, match="does not set any colours"):
            svc.parse_theme(_theme_doc(tokens={"nonsense": "#fff"}))

    def test_rejects_a_non_object(self):
        with pytest.raises(svc.ThemeError, match="JSON object"):
            svc.parse_theme(["not", "a", "theme"])

    def test_falls_back_to_a_slug_when_the_id_is_unusable(self):
        theme = svc.parse_theme(_theme_doc(id="Not A Valid Id!", name="Pale Ink"))
        assert theme["id"] == "pale-ink"

    def test_defaults_an_unknown_mode_to_dark(self):
        assert svc.parse_theme(_theme_doc(mode="chartreuse"))["mode"] == "dark"

    def test_keeps_a_light_mode(self):
        assert svc.parse_theme(_theme_doc(mode="light"))["mode"] == "light"

    def test_derives_a_name_when_one_is_missing(self):
        assert svc.parse_theme(_theme_doc(name=""))["name"] == "Midnight"

    @pytest.mark.parametrize(
        "name,expected",
        [("Pale Ink", "pale-ink"), ("  ", "custom"), ("!!!", "custom"), ("A/B", "a-b")],
    )
    def test_slugify(self, name, expected):
        assert svc.slugify_id(name) == expected


class TestDigestVerification:
    def test_a_matching_digest_passes(self):
        body = b'{"id":"x"}'
        svc.verify_digest(body, hashlib.sha256(body).hexdigest())

    def test_a_mismatched_digest_is_refused(self):
        with pytest.raises(svc.ThemeError, match="integrity check"):
            svc.verify_digest(b"tampered", hashlib.sha256(b"original").hexdigest())

    def test_an_absent_digest_is_not_an_error(self):
        svc.verify_digest(b"anything", "")


class TestUrlResolution:
    def test_resolves_a_repo_relative_path_without_doubling(self):
        index = "https://raw.example.com/repo/main/themes/index.json"
        url = svc._resolve_theme_url(index, "themes/midnight/midnight.json")
        assert url == "https://raw.example.com/repo/main/themes/midnight/midnight.json"

    @pytest.mark.parametrize(
        "path",
        [
            "https://evil.example/steal.json",
            "http://evil.example/steal.json",
            "//evil.example/steal.json",
            "/etc/passwd",
        ],
    )
    def test_refuses_a_theme_hosted_elsewhere(self, path):
        """An absolute or root-relative path must be refused, not resolved.

        Splitting one on "/" would fold the foreign host into a path segment and
        silently fetch the wrong file from our own host.
        """
        index = "https://raw.example.com/repo/main/themes/index.json"
        with pytest.raises(svc.ThemeError, match="unexpected host"):
            svc._resolve_theme_url(index, path)

    def test_refuses_a_traversing_path(self):
        index = "https://raw.example.com/repo/main/themes/index.json"
        with pytest.raises(svc.ThemeError, match="not valid"):
            svc._resolve_theme_url(index, "themes/../../../etc/passwd")

    def test_refuses_an_empty_path(self):
        with pytest.raises(svc.ThemeError, match="no file"):
            svc._resolve_theme_url("https://raw.example.com/t/index.json", "")


class TestImportAndSelect:
    def test_import_install_and_list(self, client, admin_headers):
        r = client.post("/api/themes", json=_theme_doc(id="mine"), headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["id"] == "mine"
        assert r.json()["is_community"] is False

        listed = client.get("/api/themes", headers=admin_headers).json()
        assert any(t["id"] == "mine" for t in listed["installed"])

    def test_import_drops_unsafe_tokens(self, client, admin_headers):
        doc = _theme_doc(
            id="hostile",
            tokens={"text": "#fff", "evil": "url(x)", "accent": "red; background: url(x)"},
        )
        r = client.post("/api/themes", json=doc, headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["tokens"] == {"text": "#fff"}

    def test_import_rejects_a_theme_with_nothing_usable(self, client, admin_headers):
        r = client.post(
            "/api/themes", json=_theme_doc(id="empty", tokens={"x": "y"}), headers=admin_headers
        )
        assert r.status_code == 400

    def test_reimporting_updates_rather_than_duplicates(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="dupe"), headers=admin_headers)
        client.post(
            "/api/themes",
            json=_theme_doc(id="dupe", name="Renamed", tokens={"text": "#000"}),
            headers=admin_headers,
        )
        installed = client.get("/api/themes", headers=admin_headers).json()["installed"]
        rows = [t for t in installed if t["id"] == "dupe"]
        assert len(rows) == 1
        assert rows[0]["name"] == "Renamed"

    def test_select_a_mode_and_theme(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="pick"), headers=admin_headers)
        r = client.put(
            "/api/themes/selection",
            json={"mode": "light", "theme_id": "pick"},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json() == {"app_mode": "grimoire", "mode": "light", "theme_id": "pick"}

        assert client.get("/api/themes", headers=admin_headers).json()["mode"] == "light"

    def test_cannot_select_a_theme_that_is_not_installed(self, client, admin_headers):
        r = client.put(
            "/api/themes/selection", json={"theme_id": "ghost"}, headers=admin_headers
        )
        assert r.status_code == 404

    def test_clearing_the_selection_returns_to_the_builtin(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="clearme"), headers=admin_headers)
        client.put(
            "/api/themes/selection", json={"theme_id": "clearme"}, headers=admin_headers
        )
        r = client.put("/api/themes/selection", json={"theme_id": ""}, headers=admin_headers)
        assert r.json()["theme_id"] == ""

    def test_an_unknown_mode_is_rejected(self, client, admin_headers):
        r = client.put(
            "/api/themes/selection", json={"mode": "chartreuse"}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_deleting_a_theme_also_deselects_it(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="gone"), headers=admin_headers)
        client.put("/api/themes/selection", json={"theme_id": "gone"}, headers=admin_headers)

        assert client.delete("/api/themes/gone", headers=admin_headers).status_code == 200

        state = client.get("/api/themes", headers=admin_headers).json()
        assert state["theme_id"] == ""
        assert not any(t["id"] == "gone" for t in state["installed"])

    def test_deleting_an_unknown_theme_is_404(self, client, admin_headers):
        assert client.delete("/api/themes/nope", headers=admin_headers).status_code == 404

    def test_themes_require_authentication(self, client):
        assert client.get("/api/themes").status_code in (401, 403)


class TestPerUserIsolation:
    """The whole point of the feature: one person's colours are their own."""

    def test_a_theme_installed_by_one_user_is_invisible_to_another(
        self, client, admin_headers, player_headers
    ):
        client.post("/api/themes", json=_theme_doc(id="private"), headers=admin_headers)

        theirs = client.get("/api/themes", headers=player_headers).json()["installed"]
        assert not any(t["id"] == "private" for t in theirs)

    def test_one_user_cannot_delete_anothers_theme(
        self, client, admin_headers, player_headers
    ):
        client.post("/api/themes", json=_theme_doc(id="notyours"), headers=admin_headers)

        assert client.delete("/api/themes/notyours", headers=player_headers).status_code == 404

        mine = client.get("/api/themes", headers=admin_headers).json()["installed"]
        assert any(t["id"] == "notyours" for t in mine)

    def test_selections_are_independent(self, client, admin_headers, player_headers):
        client.put("/api/themes/selection", json={"mode": "light"}, headers=admin_headers)
        client.put("/api/themes/selection", json={"mode": "dark"}, headers=player_headers)

        assert client.get("/api/themes", headers=admin_headers).json()["mode"] == "light"
        assert client.get("/api/themes", headers=player_headers).json()["mode"] == "dark"

    def test_a_non_admin_may_install_their_own_theme(self, client, player_headers):
        r = client.post("/api/themes", json=_theme_doc(id="playerpick"), headers=player_headers)
        assert r.status_code == 200


class TestPairedVariants:
    """A theme may ship a light and a dark palette so one entry covers System."""

    PAIRED = {
        "id": "duo",
        "name": "Duo",
        "variants": {"light": {"text": "#000000"}, "dark": {"text": "#ffffff"}},
    }

    def test_parses_both_palettes(self):
        theme = svc.parse_theme(self.PAIRED)
        assert sorted(theme["variants"]) == ["dark", "light"]

    def test_the_primary_mode_is_the_declared_one(self):
        theme = svc.parse_theme({**self.PAIRED, "mode": "light"})
        assert theme["mode"] == "light"
        assert theme["tokens"] == {"text": "#000000"}

    def test_defaults_to_dark_when_both_are_present(self):
        assert svc.parse_theme(self.PAIRED)["mode"] == "dark"

    def test_a_single_mode_theme_becomes_a_one_variant_map(self):
        theme = svc.parse_theme(_theme_doc(mode="light"))
        assert theme["variants"] == {"light": VALID_TOKENS}

    def test_the_primary_mode_falls_back_to_what_it_actually_ships(self):
        """Declaring dark but shipping only a light variant must not mislead."""
        theme = svc.parse_theme({**self.PAIRED, "mode": "dark", "variants": {"light": {"text": "#000"}}})
        assert theme["mode"] == "light"

    def test_variants_are_sanitized_individually(self):
        theme = svc.parse_theme(
            {
                "id": "hostile",
                "name": "H",
                "variants": {
                    "dark": {"text": "red; background: url(https://evil/)", "accent": "#fff"},
                    "light": {"nope": "#fff"},
                },
            }
        )
        assert theme["variants"] == {"dark": {"accent": "#fff"}}

    def test_a_theme_whose_variants_are_all_empty_is_rejected(self):
        with pytest.raises(svc.ThemeError, match="does not set any colours"):
            svc.parse_theme({"id": "x", "name": "X", "variants": {"dark": {"nope": "y"}}})

    def test_variant_for_picks_the_matching_mode(self):
        variants = {"light": {"text": "#000"}, "dark": {"text": "#fff"}}
        assert svc.variant_for(variants, "light") == {"text": "#000"}
        assert svc.variant_for(variants, "dark") == {"text": "#fff"}

    def test_variant_for_falls_back_to_the_only_one_shipped(self):
        assert svc.variant_for({"dark": {"text": "#fff"}}, "light") == {"text": "#fff"}

    def test_variant_for_uses_the_fallback_when_there_are_none(self):
        assert svc.variant_for({}, "dark", {"text": "#abc"}) == {"text": "#abc"}

    def test_a_paired_theme_installs_as_one_entry(self, client, admin_headers):
        r = client.post("/api/themes", json=self.PAIRED, headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["modes"] == ["light", "dark"]
        assert sorted(body["variants"]) == ["dark", "light"]

        installed = client.get("/api/themes", headers=admin_headers).json()["installed"]
        assert len([t for t in installed if t["id"] == "duo"]) == 1

    def test_a_single_mode_theme_reports_one_mode(self, client, admin_headers):
        r = client.post(
            "/api/themes", json=_theme_doc(id="solo", mode="dark"), headers=admin_headers
        )
        assert r.json()["modes"] == ["dark"]

    def test_the_catalogue_reports_the_modes_a_theme_covers(self):
        doc = {"themes": [{"id": "duo", "name": "Duo", "mode": "dark", "modes": ["light", "dark"]}]}
        assert svc.list_entries(doc)[0]["modes"] == ["light", "dark"]

    def test_a_catalogue_entry_without_modes_falls_back_to_its_mode(self):
        doc = {"themes": [{"id": "solo", "name": "Solo", "mode": "light"}]}
        assert svc.list_entries(doc)[0]["modes"] == ["light"]


class TestAppModes:
    """Product mode (grimoire/codex) is a second axis alongside light/dark."""

    def test_a_theme_defaults_to_the_grimoire_product(self):
        assert svc.parse_theme(_theme_doc())["app_mode"] == "grimoire"

    def test_a_theme_can_declare_codex(self):
        assert svc.parse_theme(_theme_doc(app_mode="codex"))["app_mode"] == "codex"

    def test_an_unknown_product_falls_back_to_the_default(self):
        assert svc.parse_theme(_theme_doc(app_mode="spaceships"))["app_mode"] == "grimoire"

    def test_codex_is_a_built_in_theme_of_the_grimoire_picker(self):
        ids = {t["id"] for t in svc.built_in_themes("grimoire")}
        assert "codex" in ids
        assert svc.is_built_in("codex", "grimoire") is True

    def test_the_empty_id_is_always_built_in(self):
        assert svc.is_built_in("", "grimoire") is True
        assert svc.is_built_in("", "codex") is True

    def test_the_listing_reports_the_active_app_mode(self, client, admin_headers):
        body = client.get("/api/themes", headers=admin_headers).json()
        assert body["app_mode"] == "grimoire"
        assert "codex" in body["app_modes"]

    def test_an_unknown_product_query_falls_back(self, client, admin_headers):
        body = client.get("/api/themes?app_mode=nope", headers=admin_headers).json()
        assert body["app_mode"] == "grimoire"

    def test_selection_is_remembered_per_product(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="perprod"), headers=admin_headers)
        client.put(
            "/api/themes/selection",
            json={"mode": "light", "theme_id": "perprod"},
            headers=admin_headers,
        )
        client.put(
            "/api/themes/selection",
            json={"app_mode": "codex", "mode": "dark", "theme_id": ""},
            headers=admin_headers,
        )

        grim = client.get("/api/themes", headers=admin_headers).json()
        codex = client.get("/api/themes?app_mode=codex", headers=admin_headers).json()

        assert (grim["mode"], grim["theme_id"]) == ("light", "perprod")
        assert (codex["mode"], codex["theme_id"]) == ("dark", "")

    def test_a_built_in_theme_can_be_selected_without_installing_it(
        self, client, admin_headers
    ):
        r = client.put(
            "/api/themes/selection", json={"theme_id": "codex"}, headers=admin_headers
        )
        assert r.status_code == 200
        assert r.json()["theme_id"] == "codex"

    def test_the_same_theme_may_be_used_in_either_product(self, client, admin_headers):
        """Product is a preference, not a restriction."""
        client.post(
            "/api/themes", json=_theme_doc(id="shared", app_mode="grimoire"), headers=admin_headers
        )
        r = client.put(
            "/api/themes/selection",
            json={"app_mode": "codex", "theme_id": "shared"},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["theme_id"] == "shared"

    def test_an_unknown_product_in_a_selection_is_rejected(self, client, admin_headers):
        r = client.put(
            "/api/themes/selection", json={"app_mode": "spaceships"}, headers=admin_headers
        )
        assert r.status_code == 422

    def test_deleting_a_theme_deselects_it_in_every_product(self, client, admin_headers):
        client.post("/api/themes", json=_theme_doc(id="everywhere"), headers=admin_headers)
        for app_mode in ("grimoire", "codex"):
            client.put(
                "/api/themes/selection",
                json={"app_mode": app_mode, "theme_id": "everywhere"},
                headers=admin_headers,
            )

        client.delete("/api/themes/everywhere", headers=admin_headers)

        for app_mode in ("grimoire", "codex"):
            body = client.get(f"/api/themes?app_mode={app_mode}", headers=admin_headers).json()
            assert body["theme_id"] == "", f"still selected in {app_mode}"

    def test_the_installed_theme_reports_its_product(self, client, admin_headers):
        r = client.post(
            "/api/themes", json=_theme_doc(id="warthing", app_mode="codex"), headers=admin_headers
        )
        assert r.json()["app_mode"] == "codex"


class TestCatalogueGating:
    def test_browse_is_refused_when_installs_are_disabled(
        self, client, admin_headers, monkeypatch
    ):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        assert client.get("/api/themes/browse", headers=admin_headers).status_code == 403

    def test_install_is_refused_when_installs_are_disabled(
        self, client, admin_headers, monkeypatch
    ):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        r = client.post("/api/themes/install/anything", headers=admin_headers)
        assert r.status_code == 403

    def test_import_still_works_when_installs_are_disabled(
        self, client, admin_headers, monkeypatch
    ):
        """The air-gapped escape hatch: pasting a theme touches no network."""
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        r = client.post("/api/themes", json=_theme_doc(id="offline"), headers=admin_headers)
        assert r.status_code == 200

    def test_the_listing_reports_the_switch(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        assert client.get("/api/themes", headers=admin_headers).json()["downloads_enabled"] is False


class TestCatalogueParsing:
    def test_lists_entries_and_bounds_their_strings(self):
        doc = {
            "themes": [
                {"id": "ok", "name": "N" * 500, "description": "D" * 900, "mode": "light"},
                {"id": "Bad Id", "name": "skipped"},
                "not a dict",
            ]
        }
        entries = svc.list_entries(doc)
        assert [e["id"] for e in entries] == ["ok"]
        assert len(entries[0]["name"]) == 120
        assert len(entries[0]["description"]) == 500
        assert entries[0]["mode"] == "light"

    def test_an_absent_theme_list_is_empty_not_an_error(self):
        assert svc.list_entries({}) == []
        assert svc.list_entries({"themes": "nope"}) == []

    def test_find_entry(self):
        doc = {"themes": [{"id": "a"}, {"id": "b"}]}
        assert svc.find_entry(doc, "b")["id"] == "b"
        assert svc.find_entry(doc, "zzz") is None


class TestCatalogueSource:
    def test_an_admin_can_point_at_a_mirror(self, client, admin_headers):
        r = client.put(
            "/api/themes/source",
            json={"index_url": "https://mirror.example/themes/index.json"},
            headers=admin_headers,
        )
        assert r.status_code == 200
        assert r.json()["is_custom_url"] is True

        client.put("/api/themes/source", json={"index_url": ""}, headers=admin_headers)

    def test_a_non_admin_cannot(self, client, player_headers):
        r = client.put(
            "/api/themes/source",
            json={"index_url": "https://mirror.example/themes/index.json"},
            headers=player_headers,
        )
        assert r.status_code in (401, 403)

    def test_a_non_http_url_is_rejected(self, client, admin_headers):
        r = client.put(
            "/api/themes/source",
            json={"index_url": "file:///etc/passwd"},
            headers=admin_headers,
        )
        assert r.status_code == 422


class TestFetchTheme:
    def _entry(self, body: bytes, **over):
        entry = {
            "id": "midnight",
            "name": "Midnight",
            "path": "themes/midnight/midnight.json",
            "sha256": hashlib.sha256(body).hexdigest(),
            "version": "1.0.0",
        }
        entry.update(over)
        return entry

    def test_downloads_verifies_and_parses(self, db, monkeypatch):
        body = json.dumps(_theme_doc()).encode()
        self._stub_get(monkeypatch, body)

        theme = svc.fetch_theme(db, self._entry(body))
        assert theme["id"] == "midnight"
        assert theme["tokens"] == VALID_TOKENS

    def test_a_tampered_file_is_refused(self, db, monkeypatch):
        self._stub_get(monkeypatch, json.dumps(_theme_doc()).encode())
        entry = self._entry(b"something else")

        with pytest.raises(svc.ThemeError, match="integrity check"):
            svc.fetch_theme(db, entry)

    def test_a_non_json_file_is_refused(self, db, monkeypatch):
        body = b"<html>not a theme</html>"
        self._stub_get(monkeypatch, body)

        with pytest.raises(svc.ThemeError, match="not valid JSON"):
            svc.fetch_theme(db, self._entry(body))

    def test_an_oversized_file_is_refused(self, db, monkeypatch):
        body = b"x" * (svc.MAX_THEME_BYTES + 1)
        self._stub_get(monkeypatch, body)

        with pytest.raises(svc.ThemeError, match="too large"):
            svc.fetch_theme(db, self._entry(body))

    def test_a_bad_status_is_surfaced(self, db, monkeypatch):
        self._stub_get(monkeypatch, b"", status=404)

        with pytest.raises(svc.ThemeError, match="HTTP 404"):
            svc.fetch_theme(db, self._entry(b""))

    @staticmethod
    def _stub_get(monkeypatch, body: bytes, status: int = 200):
        import httpx

        class _Response:
            status_code = status
            content = body

        class _Client:
            def __init__(self, **kwargs):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url):
                return _Response()

        monkeypatch.setattr(httpx, "Client", _Client)
