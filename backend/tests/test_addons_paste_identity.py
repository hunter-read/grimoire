"""Tests for "paste a link or ID" identity resolution (issue #203).

Search is not always the fastest route: a user looking at the product page in
another tab already knows exactly which item they want. These cover the
extraction itself, the guards on a community-supplied regex, and the endpoint
path that accepts pasted text in place of a search result.
"""
import os
import uuid

import pytest
import yaml
from pydantic import ValidationError

from backend.addons import fetch, interpreter, registry
from backend.addons.constants import (
    SETTING_ALLOW_SCRIPTS,
    SETTING_INDEX_CACHE,
    SETTING_INDEX_URL,
    SETTING_INSTALLED,
)
from backend.addons.manifest import AddonManifest
from backend.config import SessionLocal
from backend.models import AppSetting
from backend.tests.conftest import make_game_system

BASE = {
    "id": "demo",
    "name": "Demo",
    "version": "1.0.0",
    "kind": "scraper",
    "source": {"url": "https://example.com/d.json", "format": "json"},
    "search": {
        "fields": [{"field": "name"}],
        "identity": {"from": "id"},
        "identity_pattern": r"/product/(\d+)",
    },
    "map": {"license": {"from": "license"}},
}


def _manifest(pattern=r"/product/(\d+)", **overrides):
    data = {**BASE}
    search = {**BASE["search"]}
    if pattern is None:
        search.pop("identity_pattern", None)
    else:
        search["identity_pattern"] = pattern
    data["search"] = search
    data.update(overrides)
    return AddonManifest(**data)


# ---------------------------------------------------------------------------
# Pattern validation
# ---------------------------------------------------------------------------


class TestPatternValidation:
    def test_a_simple_pattern_is_accepted(self):
        assert _manifest(r"/product/(\d+)").search.identity_pattern

    def test_an_uncompilable_pattern_is_rejected(self):
        with pytest.raises(ValidationError, match="not a valid regex"):
            _manifest(r"/product/([0-9")

    @pytest.mark.parametrize("pattern", [r"/product/\d+", r"/(a)/(b)"])
    def test_it_must_capture_exactly_one_group(self, pattern):
        with pytest.raises(ValidationError, match="exactly one capture group"):
            _manifest(pattern)

    @pytest.mark.parametrize("pattern", [r"(a+)+", r"([a-z]+)+", r"(\d*[a-z]+)*"])
    def test_nested_quantifiers_are_rejected(self, pattern):
        """A community regex is untrusted input; these shapes can hang a worker."""
        with pytest.raises(ValidationError, match="nested quantifier"):
            _manifest(pattern)

    @pytest.mark.parametrize(
        "pattern", [r"/systems/([a-z0-9-]+)", r"/product/(\d+)", r"id-(\w{1,20})"]
    )
    def test_ordinary_patterns_are_not_false_flagged(self, pattern):
        """The guard must not reject the perfectly safe patterns real
        definitions actually use."""
        assert _manifest(pattern).search.identity_pattern == pattern

    def test_an_over_long_pattern_is_rejected(self):
        with pytest.raises(ValidationError):
            _manifest("(" + "a" * 300 + ")")


# ---------------------------------------------------------------------------
# Extraction
# ---------------------------------------------------------------------------


class TestResolveIdentity:
    @pytest.mark.parametrize(
        "text",
        [
            "https://www.drivethrurpg.com/en/product/170689/blades-in-the-dark",
            "https://www.drivethrurpg.com/product/170689",
            "www.drivethrurpg.com/en/product/170689",
            "  https://www.drivethrurpg.com/en/product/170689  ",
        ],
    )
    def test_extracts_from_url_variants(self, text):
        assert interpreter.resolve_identity(text, _manifest()) == "170689"

    def test_ignores_a_trailing_affiliate_parameter(self):
        url = "https://www.drivethrurpg.com/en/product/170689/x?affiliate_id=715880"
        assert interpreter.resolve_identity(url, _manifest()) == "170689"

    def test_accepts_a_bare_id(self):
        assert interpreter.resolve_identity("170689", _manifest()) == "170689"

    def test_accepts_a_bare_slug(self):
        man = _manifest(r"/systems/([a-z0-9-]+)")
        assert interpreter.resolve_identity("blades-in-the-dark", man) == "blades-in-the-dark"

    def test_extracts_a_slug_from_a_url(self):
        man = _manifest(r"/systems/([a-z0-9-]+)")
        got = interpreter.resolve_identity("https://ttrpgwiki.com/systems/cairn", man)
        assert got == "cairn"

    @pytest.mark.parametrize(
        "text",
        [
            "https://example.com/nope",
            "just some words here",
            "a sentence with spaces",
            "",
            "   ",
        ],
    )
    def test_unrecognisable_text_returns_none(self, text):
        """Better a clear "that isn't a link for this source" than a doomed request."""
        assert interpreter.resolve_identity(text, _manifest()) is None

    def test_no_pattern_means_no_resolution(self):
        assert interpreter.resolve_identity("170689", _manifest(pattern=None)) is None

    def test_over_long_input_is_refused(self):
        assert interpreter.resolve_identity("x" * 5000, _manifest()) is None

    def test_a_resolved_identity_is_length_capped(self):
        man = _manifest(r"/systems/([a-z-]+)")
        assert len(interpreter.resolve_identity("/systems/" + "a" * 500, man)) == 200


# ---------------------------------------------------------------------------
# Service + endpoint
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clean_settings():
    yield
    session = SessionLocal()
    for key in (SETTING_INSTALLED, SETTING_INDEX_URL, SETTING_INDEX_CACHE, SETTING_ALLOW_SCRIPTS):
        row = session.query(AppSetting).filter_by(key=key).first()
        if row:
            session.delete(row)
    session.commit()
    session.close()


@pytest.fixture(autouse=True)
def addons_dir(tmp_path, monkeypatch):
    directory = tmp_path / "add-ons"
    directory.mkdir()
    monkeypatch.setattr(registry, "ADDONS_DIR", str(directory))
    monkeypatch.setattr(fetch, "ADDON_CACHE_DIR", str(tmp_path / "cache"))
    return directory


CATALOGUE_MANIFEST = {
    "id": "ttrpg-wiki",
    "name": "TTRPG Wiki",
    "version": "1.0.0",
    "kind": "scraper",
    "target": "game-system",
    "attribution": "TTRPG Wiki",
    "source": {"url": "https://ttrpgwiki.com/data/systems.json", "format": "json"},
    "records": {"root": "$"},
    "search": {
        "fields": [{"field": "name"}],
        "min_score": 0.4,
        "label": {"from": "name"},
        "identity": {"template": "{name}", "transform": "slugify"},
        "url": {"template": "https://ttrpgwiki.com/systems/{identity}"},
        "identity_pattern": r"/systems/([a-z0-9-]+)",
    },
    "map": {"license": {"from": "license"}, "year": {"from": "year"}},
}


@pytest.fixture
def installed(addons_dir):
    directory = addons_dir / "ttrpg-wiki"
    directory.mkdir()
    (directory / "ttrpg-wiki.yml").write_text(yaml.safe_dump(CATALOGUE_MANIFEST))
    return directory


@pytest.fixture
def no_paste_addon(addons_dir):
    """An otherwise-identical add-on that declares no pattern."""
    manifest = {**CATALOGUE_MANIFEST, "id": "plain", "name": "Plain"}
    search = {**manifest["search"]}
    search.pop("identity_pattern")
    manifest["search"] = search
    directory = addons_dir / "plain"
    directory.mkdir()
    (directory / "plain.yml").write_text(yaml.safe_dump(manifest))
    return directory


@pytest.fixture
def source_data(monkeypatch):
    document = [
        {"name": "Blades in the Dark", "license": "CC BY 3.0", "year": 2017},
        {"name": "Cairn", "license": "CC BY-SA 4.0", "year": 2021},
    ]

    def fake_fetch_document(url, **kwargs):
        return document

    monkeypatch.setattr("backend.addons.service.fetch.fetch_document", fake_fetch_document)
    return document


@pytest.fixture
def system():
    return make_game_system(name=f"System-{uuid.uuid4().hex[:6]}")


class TestSourcesAdvertisePaste:
    def test_supports_paste_is_true_when_a_pattern_exists(
        self, client, gm_headers, system, installed
    ):
        body = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).json()
        assert body["sources"][0]["supports_paste"] is True

    def test_supports_paste_is_false_without_one(
        self, client, gm_headers, system, no_paste_addon
    ):
        body = client.get(
            f"/api/systems/{system.id}/metadata-sources", headers=gm_headers
        ).json()
        assert body["sources"][0]["supports_paste"] is False


class TestFetchByPaste:
    def _paste(self, client, headers, system_id, text, source="ttrpg-wiki"):
        return client.post(
            f"/api/systems/{system_id}/metadata-fetch",
            json={"source_id": source, "paste": text},
            headers=headers,
        )

    def test_a_pasted_url_fetches_without_searching(
        self, client, gm_headers, system, installed, source_data
    ):
        response = self._paste(
            client, gm_headers, system.id, "https://ttrpgwiki.com/systems/cairn"
        )
        assert response.status_code == 200
        body = response.json()
        assert body["identity"] == "cairn"
        fields = {r["field"]: r["incoming"] for r in body["fields"]}
        assert fields["year"] == 2021

    def test_a_pasted_bare_id_works(
        self, client, gm_headers, system, installed, source_data
    ):
        body = self._paste(client, gm_headers, system.id, "cairn").json()
        assert body["identity"] == "cairn"

    def test_the_response_echoes_the_resolved_identity(
        self, client, gm_headers, system, installed, source_data
    ):
        """The client shows what was actually fetched, not what was typed."""
        body = self._paste(
            client, gm_headers, system.id, "https://ttrpgwiki.com/systems/cairn"
        ).json()
        assert body["identity"] == "cairn"

    def test_unrecognisable_text_is_a_400_with_a_useful_message(
        self, client, gm_headers, system, installed, source_data
    ):
        response = self._paste(client, gm_headers, system.id, "not a link at all")
        assert response.status_code == 400
        assert "link or ID" in response.json()["detail"]

    def test_a_valid_but_unknown_identity_is_a_400(
        self, client, gm_headers, system, installed, source_data
    ):
        response = self._paste(
            client, gm_headers, system.id, "https://ttrpgwiki.com/systems/no-such-game"
        )
        assert response.status_code == 400

    def test_a_source_without_a_pattern_says_so(
        self, client, gm_headers, system, no_paste_addon, source_data
    ):
        response = self._paste(client, gm_headers, system.id, "cairn", source="plain")
        assert response.status_code == 400
        assert "does not support" in response.json()["detail"]

    def test_identity_still_works_alongside_paste_support(
        self, client, gm_headers, system, installed, source_data
    ):
        """Adding paste must not break the ordinary search→pick flow."""
        response = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki", "identity": "cairn"},
            headers=gm_headers,
        )
        assert response.status_code == 200
        assert response.json()["identity"] == "cairn"

    def test_neither_identity_nor_paste_is_a_400(
        self, client, gm_headers, system, installed, source_data
    ):
        response = client.post(
            f"/api/systems/{system.id}/metadata-fetch",
            json={"source_id": "ttrpg-wiki"},
            headers=gm_headers,
        )
        assert response.status_code == 400

    def test_it_requires_gm_or_admin(self, client, player_headers, system, installed):
        assert self._paste(client, player_headers, system.id, "cairn").status_code == 403


class TestShippedDefinitions:
    """The real definitions must actually parse the URLs users will paste."""

    @pytest.mark.parametrize(
        "addon,url,expected",
        [
            (
                "drivethrurpg",
                "https://www.drivethrurpg.com/en/product/170689/blades-in-the-dark",
                "170689",
            ),
            (
                "ttrpg-wiki",
                "https://ttrpgwiki.com/systems/blades-in-the-dark",
                "blades-in-the-dark",
            ),
        ],
    )
    def test_real_urls_resolve(self, addon, url, expected):
        path = os.path.normpath(
            os.path.join(
                os.path.dirname(__file__),
                "..", "..", "..",
                "community-add-ons", "scrapers", addon, f"{addon}.yml",
            )
        )
        if not os.path.isfile(path):
            pytest.skip("community-add-ons checkout not present")
        with open(path, encoding="utf-8") as fh:
            manifest = AddonManifest(**yaml.safe_load(fh))
        assert interpreter.resolve_identity(url, manifest) == expected
