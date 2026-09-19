"""Tests for browsing and installing sheets from the community catalogue.

The URL-derivation tests are the ones that matter most: the catalogue URL is
derived from the add-on index so an admin can point everything at a branch with
one setting, and getting that derivation wrong is how "browse from a branch"
silently reads the wrong repository.
"""
import hashlib
import json

import pytest

from backend.services.characters import catalogue as cat


REPO = "https://raw.githubusercontent.com/grimoire-codex/community-add-ons"

SHEET = {
    "id": "catalogue-demo",
    "name": "Catalogue Demo",
    "version": "1.0.0",
    "system": "Demo",
    "fields": {"level": {"type": "number", "label": "Level", "default": 1}},
    "computed": {"double": {"formula": "level * 2"}},
}


class TestUrlDerivation:
    @pytest.mark.parametrize(
        "configured,expected",
        [
            # The common case: the add-on index at a branch root.
            (f"{REPO}/main/index.json", f"{REPO}/main/character-sheets/index.json"),
            # A branch other than main — the reason this derivation exists.
            (
                f"{REPO}/feat/character-builder/index.json",
                f"{REPO}/feat/character-builder/character-sheets/index.json",
            ),
            # A sibling catalogue: rewritten to ours rather than fetched as-is.
            (f"{REPO}/main/themes/index.json", f"{REPO}/main/character-sheets/index.json"),
            (
                f"{REPO}/main/templates/index.json",
                f"{REPO}/main/character-sheets/index.json",
            ),
            # Already ours: left alone.
            (
                f"{REPO}/main/character-sheets/index.json",
                f"{REPO}/main/character-sheets/index.json",
            ),
            # A bare directory URL, with and without the trailing slash.
            (f"{REPO}/main/", f"{REPO}/main/character-sheets/index.json"),
            (f"{REPO}/main", f"{REPO}/main/character-sheets/index.json"),
            # A trailing slash on an index file would otherwise read the
            # filename as a directory and append the catalogue path to it.
            (f"{REPO}/main/index.json/", f"{REPO}/main/character-sheets/index.json"),
            (
                f"{REPO}/main/character-sheets/index.json/",
                f"{REPO}/main/character-sheets/index.json",
            ),
        ],
    )
    def test_derives_the_sheet_index(self, configured, expected):
        assert cat._derive_sheet_url(configured) == expected

    def test_a_self_hosted_catalogue_is_derived_the_same_way(self):
        assert (
            cat._derive_sheet_url("https://example.test/grimoire/index.json")
            == "https://example.test/grimoire/character-sheets/index.json"
        )


class TestDigestVerification:
    def test_accepts_a_matching_digest(self):
        body = b"{}"
        cat.verify_digest(body, hashlib.sha256(body).hexdigest())

    def test_rejects_a_mismatched_digest(self):
        with pytest.raises(cat.CatalogueError, match="integrity check"):
            cat.verify_digest(b"{}", "0" * 64)

    def test_an_absent_digest_cannot_be_checked(self):
        """Absent is not the same as failing; it simply cannot be verified."""
        cat.verify_digest(b"anything", "")


class TestFileUrlResolution:
    def test_resolves_a_repo_relative_path_against_its_catalogue(self):
        url = cat._resolve_sheet_url(
            f"{REPO}/main/character-sheets/index.json",
            "character-sheets/cairn/cairn.json",
        )
        assert url == f"{REPO}/main/character-sheets/cairn/cairn.json"

    def test_refuses_a_file_on_another_host(self):
        with pytest.raises(cat.CatalogueError, match="unexpected host"):
            cat._resolve_sheet_url(
                f"{REPO}/main/character-sheets/index.json",
                "https://evil.example/sheet.json",
            )

    def test_refuses_an_entry_with_no_path(self):
        with pytest.raises(cat.CatalogueError, match="does not say where"):
            cat._resolve_sheet_url(f"{REPO}/main/character-sheets/index.json", "")


class TestBrowsing:
    def _catalogue(self, monkeypatch, document):
        monkeypatch.setattr(cat, "fetch_document", lambda url, **kwargs: document)

    def test_lists_sheets_and_marks_what_is_installed(self, client, admin_headers, monkeypatch):
        self._catalogue(
            monkeypatch,
            {
                "version": 1,
                "sheets": [
                    {
                        "id": "cairn",
                        "name": "Cairn",
                        "version": "1.0.0",
                        "system": "Cairn",
                        "license": "CC-BY-SA-4.0",
                        "attribution": "Cairn is © Yochai Gal.",
                        "custom_layout": False,
                        "field_count": 12,
                        "path": "character-sheets/cairn/cairn.json",
                        "sha256": "a" * 64,
                        "author": "hunter-read",
                    }
                ],
            },
        )
        resp = client.get("/api/characters/schemas/browse", headers=admin_headers)
        assert resp.status_code == 200
        sheets = resp.json()["sheets"]
        assert sheets[0]["name"] == "Cairn"
        assert sheets[0]["installed"] is False
        # The credit travels with the listing, so it can be shown before install.
        assert sheets[0]["attribution"] == "Cairn is © Yochai Gal."
        # A GitHub username becomes a profile link, as add-ons and themes do.
        assert sheets[0]["author_url"].endswith("hunter-read")

    def test_marks_a_sheet_the_user_already_has(
        self, client, admin_headers, monkeypatch
    ):
        client.post(
            "/api/characters/schemas", json={"document": SHEET}, headers=admin_headers
        )
        self._catalogue(
            monkeypatch,
            {"sheets": [{"id": "catalogue-demo", "name": "Catalogue Demo",
                         "path": "x.json", "sha256": ""}]},
        )
        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        assert sheets[0]["installed"] is True
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_an_unreadable_source_yields_an_empty_catalogue_not_an_error(
        self, client, admin_headers, monkeypatch
    ):
        """One unreachable branch must not hide the sheets that are fine."""
        def _raise(url, **kwargs):
            raise cat.AddonFetchError("nope")

        monkeypatch.setattr(cat, "fetch_document", _raise)
        resp = client.get("/api/characters/schemas/browse", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["sheets"] == []

    def test_ignores_a_document_that_is_not_a_sheet_catalogue(
        self, client, admin_headers, monkeypatch
    ):
        self._catalogue(monkeypatch, {"themes": [{"id": "one-dark"}]})
        assert (
            client.get("/api/characters/schemas/browse", headers=admin_headers)
            .json()["sheets"]
            == []
        )

    def test_browsing_requires_an_account_but_not_an_admin(self, client, gm_headers, monkeypatch):
        """Sheets are per user, so installing one needs no admin step."""
        self._catalogue(monkeypatch, {"sheets": []})
        assert client.get("/api/characters/schemas/browse", headers=gm_headers).status_code == 200
        assert client.get("/api/characters/schemas/browse").status_code in (401, 403)

    def test_reports_when_downloads_are_disabled(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(cat, "downloads_enabled", lambda: False)
        resp = client.get("/api/characters/schemas/browse", headers=admin_headers)
        assert resp.status_code == 403


class TestInstalling:
    def test_installs_a_sheet_and_records_its_provenance(
        self, client, admin_headers, monkeypatch
    ):
        body = json.dumps(SHEET).encode()
        digest = hashlib.sha256(body).hexdigest()
        monkeypatch.setattr(
            cat,
            "fetch_document",
            lambda url, **kwargs: {
                "sheets": [
                    {
                        "id": "catalogue-demo",
                        "name": "Catalogue Demo",
                        "version": "1.0.0",
                        "path": "character-sheets/catalogue-demo/catalogue-demo.json",
                        "sha256": digest,
                    }
                ]
            },
        )
        monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: dict(SHEET))

        resp = client.post(
            "/api/characters/schemas/install/catalogue-demo", headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        body = resp.json()
        assert body["schema_id"] == "catalogue-demo"
        assert body["is_community"] is True
        assert body["source_version"] == "1.0.0"
        # Installed for real: it renders like any other sheet.
        assert body["document"]["computed"]["double"]["formula"] == "level * 2"
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_installing_something_not_in_the_catalogue_is_404(
        self, client, admin_headers, monkeypatch
    ):
        monkeypatch.setattr(cat, "fetch_document", lambda url, **kwargs: {"sheets": []})
        assert (
            client.post(
                "/api/characters/schemas/install/ghost", headers=admin_headers
            ).status_code
            == 404
        )

    def test_a_sheet_that_does_not_validate_is_refused(
        self, client, admin_headers, monkeypatch
    ):
        monkeypatch.setattr(
            cat,
            "fetch_document",
            lambda url, **kwargs: {
                "sheets": [{"id": "broken", "name": "Broken", "path": "x.json", "sha256": ""}]
            },
        )

        def _bad(db, entry):
            raise cat.CatalogueError("That sheet is not valid: unknown type 'wormhole'")

        monkeypatch.setattr(cat, "fetch_sheet", _bad)
        resp = client.post(
            "/api/characters/schemas/install/broken", headers=admin_headers
        )
        assert resp.status_code == 400
        assert "wormhole" in resp.json()["detail"]

    def test_a_player_may_install_for_themselves(self, client, gm_headers, monkeypatch):
        monkeypatch.setattr(
            cat,
            "fetch_document",
            lambda url, **kwargs: {
                "sheets": [{"id": "catalogue-demo", "name": "Catalogue Demo",
                            "path": "x.json", "sha256": ""}]
            },
        )
        monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: dict(SHEET))
        resp = client.post(
            "/api/characters/schemas/install/catalogue-demo", headers=gm_headers
        )
        assert resp.status_code == 200
        client.delete("/api/characters/schemas/catalogue-demo", headers=gm_headers)


class TestFetchingASheet:
    """The download path: digest, size, JSON, and schema validation.

    Exercised with a stub transport rather than a live request — the point is
    what happens to the bytes once they arrive.
    """

    def _entry(self, body: bytes, **overrides):
        entry = {
            "id": "catalogue-demo",
            "path": "character-sheets/catalogue-demo/catalogue-demo.json",
            "sha256": hashlib.sha256(body).hexdigest(),
            "index_url": f"{REPO}/main/character-sheets/index.json",
        }
        entry.update(overrides)
        return entry

    def _serve(self, monkeypatch, body: bytes, status: int = 200):
        import httpx

        def handler(request):
            return httpx.Response(status, content=body)

        transport = httpx.MockTransport(handler)
        real_client = httpx.Client

        def _client(**kwargs):
            kwargs.pop("transport", None)
            return real_client(transport=transport, **kwargs)

        monkeypatch.setattr(httpx, "Client", _client)

    def test_downloads_verifies_and_validates(self, monkeypatch):
        body = json.dumps(SHEET).encode()
        self._serve(monkeypatch, body)
        document = cat.fetch_sheet(None, self._entry(body))
        assert document["id"] == "catalogue-demo"

    def test_strips_the_editor_only_schema_marker(self, monkeypatch):
        """`$schema` is an editor affordance in the repo, not part of the sheet."""
        body = json.dumps({"$schema": "../../schema/x.json", **SHEET}).encode()
        self._serve(monkeypatch, body)
        assert "$schema" not in cat.fetch_sheet(None, self._entry(body))

    def test_refuses_a_tampered_file(self, monkeypatch):
        body = json.dumps(SHEET).encode()
        self._serve(monkeypatch, body)
        with pytest.raises(cat.CatalogueError, match="integrity check"):
            cat.fetch_sheet(None, self._entry(body, sha256="0" * 64))

    def test_refuses_a_file_that_is_not_json(self, monkeypatch):
        body = b"<!DOCTYPE html><p>not a sheet"
        self._serve(monkeypatch, body)
        with pytest.raises(cat.CatalogueError, match="not valid JSON"):
            cat.fetch_sheet(None, self._entry(body))

    def test_refuses_a_json_document_that_is_not_a_sheet(self, monkeypatch):
        body = b'["a", "list"]'
        self._serve(monkeypatch, body)
        with pytest.raises(cat.CatalogueError, match="not a sheet"):
            cat.fetch_sheet(None, self._entry(body))

    def test_refuses_a_sheet_that_does_not_validate(self, monkeypatch):
        body = json.dumps(
            {"id": "broken", "name": "Broken", "version": "1.0.0",
             "fields": {"x": {"type": "wormhole"}}}
        ).encode()
        self._serve(monkeypatch, body)
        with pytest.raises(cat.CatalogueError, match="wormhole"):
            cat.fetch_sheet(None, self._entry(body))

    def test_refuses_an_oversized_file(self, monkeypatch):
        body = b"x" * (cat.MAX_SHEET_BYTES + 1)
        self._serve(monkeypatch, body)
        with pytest.raises(cat.CatalogueError, match="too large"):
            cat.fetch_sheet(None, self._entry(body))

    def test_reports_an_http_error(self, monkeypatch):
        self._serve(monkeypatch, b"", status=404)
        with pytest.raises(cat.CatalogueError, match="HTTP 404"):
            cat.fetch_sheet(None, self._entry(b""))

    def test_refuses_when_downloads_are_disabled(self, monkeypatch):
        monkeypatch.setattr(cat, "downloads_enabled", lambda: False)
        with pytest.raises(cat.CatalogueError, match="disabled"):
            cat.fetch_sheet(None, self._entry(b"{}"))


class TestIndexUrls:
    def test_falls_back_to_the_bundled_default(self, monkeypatch):
        monkeypatch.setattr(
            "backend.addons.registry.get_index_url", lambda db: "", raising=False
        )
        urls = cat.get_index_urls(None)
        assert urls and urls[0].endswith("character-sheets/index.json")

    def test_reads_several_comma_separated_sources(self, monkeypatch):
        monkeypatch.setattr(
            "backend.addons.registry.get_index_url",
            lambda db: f"{REPO}/main/index.json, {REPO}/feat/x/index.json",
            raising=False,
        )
        assert cat.get_index_urls(None) == [
            f"{REPO}/main/index.json",
            f"{REPO}/feat/x/index.json",
        ]


class TestMultipleSources:
    """Several catalogues at once, the way add-ons and themes already allow.

    Two sources may each offer a sheet with the same id, so an id alone cannot
    identify one — which is why the listing namespaces it by source.
    """

    def _sources(self, monkeypatch, documents: dict):
        """Serve a catalogue per URL; a value of None means that source is down."""
        def _fetch(url, **kwargs):
            document = documents.get(url)
            if document is None:
                raise cat.AddonFetchError("connection refused")
            return document

        monkeypatch.setattr(cat, "fetch_document", _fetch)
        monkeypatch.setattr(cat, "get_index_urls", lambda db: list(documents))

    def _sheet(self, sheet_id: str, name: str):
        return {
            "id": sheet_id,
            "name": name,
            "version": "1.0.0",
            "path": f"character-sheets/{sheet_id}/{sheet_id}.json",
            "sha256": "",
        }

    def test_lists_sheets_from_every_configured_source(self, client, admin_headers, monkeypatch):
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("cairn", "Cairn")]
                },
                "https://b.test/character-sheets/index.json": {
                    "sheets": [self._sheet("mausritter", "Mausritter")]
                },
            },
        )
        body = client.get("/api/characters/schemas/browse", headers=admin_headers).json()
        assert sorted(sheet["name"] for sheet in body["sheets"]) == ["Cairn", "Mausritter"]
        assert len(body["sources"]) == 2

    def test_the_same_id_from_two_sources_stays_distinct(
        self, client, admin_headers, monkeypatch
    ):
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("cairn", "Cairn (A)")]
                },
                "https://b.test/character-sheets/index.json": {
                    "sheets": [self._sheet("cairn", "Cairn (B)")]
                },
            },
        )
        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        assert len(sheets) == 2
        # Namespaced ids, but both still call themselves `cairn`.
        assert len({sheet["id"] for sheet in sheets}) == 2
        assert {sheet["raw_id"] for sheet in sheets} == {"cairn"}

    def test_installs_the_copy_the_namespaced_id_names(
        self, client, admin_headers, monkeypatch
    ):
        """Picking the second source's copy must not fetch the first's."""
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From A")]
                },
                "https://b.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From B")]
                },
            },
        )
        fetched: list = []

        def _fetch_sheet(db, entry):
            fetched.append(entry["index_url"])
            return dict(SHEET)

        monkeypatch.setattr(cat, "fetch_sheet", _fetch_sheet)

        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        from_b = next(sheet for sheet in sheets if sheet["name"] == "From B")

        resp = client.post(
            f"/api/characters/schemas/install/{from_b['id']}", headers=admin_headers
        )
        assert resp.status_code == 200
        assert fetched == ["https://b.test/character-sheets/index.json"]
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_a_bare_id_still_installs(self, client, admin_headers, monkeypatch):
        """A link written before a second source was added keeps working."""
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "Only One")]
                }
            },
        )
        monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: dict(SHEET))
        resp = client.post(
            "/api/characters/schemas/install/catalogue-demo", headers=admin_headers
        )
        assert resp.status_code == 200
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_records_the_sheets_own_id_as_provenance(
        self, client, admin_headers, monkeypatch
    ):
        """`source_id` should say what the sheet is, not how the listing keyed it."""
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "Demo")]
                }
            },
        )
        monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: dict(SHEET))
        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        body = client.post(
            f"/api/characters/schemas/install/{sheets[0]['id']}", headers=admin_headers
        ).json()
        assert body["source_id"] == "catalogue-demo"
        assert body["source_url"] == "https://a.test/character-sheets/index.json"
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_one_dead_source_does_not_hide_the_others(
        self, client, admin_headers, monkeypatch
    ):
        self._sources(
            monkeypatch,
            {
                "https://up.test/character-sheets/index.json": {
                    "sheets": [self._sheet("cairn", "Cairn")]
                },
                "https://down.test/character-sheets/index.json": None,
            },
        )
        body = client.get("/api/characters/schemas/browse", headers=admin_headers).json()
        assert [sheet["name"] for sheet in body["sheets"]] == ["Cairn"]
        # Reported, not swallowed: a missing source otherwise just looks like a
        # smaller catalogue.
        assert len(body["errors"]) == 1
        assert body["errors"][0]["url"] == "https://down.test/character-sheets/index.json"

    def test_a_source_that_is_not_a_sheet_catalogue_is_not_an_error(
        self, client, admin_headers, monkeypatch
    ):
        """The configured list is shared with themes and add-ons."""
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("cairn", "Cairn")]
                },
                "https://b.test/character-sheets/index.json": {"themes": [{"id": "one-dark"}]},
            },
        )
        body = client.get("/api/characters/schemas/browse", headers=admin_headers).json()
        assert [sheet["name"] for sheet in body["sheets"]] == ["Cairn"]
        assert body["errors"] == []

    def test_only_the_installed_copy_is_marked(
        self, client, admin_headers, monkeypatch
    ):
        """Installing one catalogue's copy must not mark the other's."""
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From A")]
                },
                "https://b.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From B")]
                },
            },
        )
        monkeypatch.setattr(cat, "fetch_sheet", lambda db, entry: dict(SHEET))

        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        from_b = next(sheet for sheet in sheets if sheet["name"] == "From B")
        client.post(
            f"/api/characters/schemas/install/{from_b['id']}", headers=admin_headers
        )

        after = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        marked = {sheet["name"]: sheet["installed"] for sheet in after}
        assert marked == {"From A": False, "From B": True}
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_a_pasted_schema_marks_every_copy_of_its_id(
        self, client, admin_headers, monkeypatch
    ):
        """It has no source, and installing any copy would replace it."""
        client.post(
            "/api/characters/schemas", json={"document": SHEET}, headers=admin_headers
        )
        self._sources(
            monkeypatch,
            {
                "https://a.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From A")]
                },
                "https://b.test/character-sheets/index.json": {
                    "sheets": [self._sheet("catalogue-demo", "From B")]
                },
            },
        )
        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        assert all(sheet["installed"] for sheet in sheets)
        client.delete("/api/characters/schemas/catalogue-demo", headers=admin_headers)

    def test_a_duplicate_of_the_same_source_is_listed_once(
        self, client, admin_headers, monkeypatch
    ):
        """The same URL configured twice should not double every sheet."""
        document = {"sheets": [self._sheet("cairn", "Cairn")]}
        monkeypatch.setattr(cat, "fetch_document", lambda url, **kwargs: document)
        monkeypatch.setattr(
            cat,
            "get_index_urls",
            lambda db: [
                "https://a.test/character-sheets/index.json",
                "https://a.test/character-sheets/index.json/",
            ],
        )
        sheets = client.get(
            "/api/characters/schemas/browse", headers=admin_headers
        ).json()["sheets"]
        assert len(sheets) == 1
