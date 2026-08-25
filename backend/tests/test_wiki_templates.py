"""Tests for campaign wiki note templates.

Covers the per-campaign template CRUD, using one to create a page, uploading and
exporting, and the community catalogue (browse / download), whose network calls
are mocked throughout.
"""
import hashlib
import io
import uuid
import zipfile

import pytest

from backend import config
from backend.models import AppSetting, WikiTemplate
from backend.routers.campaigns._frontmatter import compose, split_frontmatter
from backend.routers.campaigns.wiki_templates import AUTHORED_SYSTEM
from backend.config import SessionLocal
from backend.services import wiki_template_catalogue as catalogue

BODY = """---
title: Spell
icon: sparkles
visibility: group
---

*2nd-level transmutation*

**Casting Time:** 1 action
"""


def uid():
    return uuid.uuid4().hex[:8]


def _digest(text: str) -> str:
    return hashlib.sha256(text.encode()).hexdigest()


def _campaign(client, headers, **kwargs):
    payload = {"name": f"Tmpl {uid()}", "is_gm_campaign": True}
    payload.update(kwargs)
    resp = client.post("/api/campaigns", json=payload, headers=headers)
    assert resp.status_code == 201
    return resp.json()


def _create(client, headers, cid, **kwargs):
    payload = {"name": "Spell", "body": BODY}
    payload.update(kwargs)
    return client.post(f"/api/campaigns/{cid}/wiki/templates", json=payload, headers=headers)


@pytest.fixture(autouse=True)
def _clear_template_setting():
    """Leave no custom catalogue URL behind for the next test."""
    yield
    session = SessionLocal()
    row = session.query(AppSetting).filter_by(key=catalogue.SETTING_INDEX_URL).first()
    if row:
        session.delete(row)
        session.commit()
    session.close()


@pytest.fixture
def downloads_enabled(monkeypatch):
    monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)


CATALOGUE = {
    "version": 1,
    "generated": "2026-08-07T00:00:00Z",
    "folders": [
        {"path": "dnd-5e", "name": "Dungeons & Dragons 5e"},
        {"path": "draw-steel", "name": "Draw Steel"},
        {"path": "generic", "name": "Generic"},
    ],
    "templates": [
        {
            "id": "5e-spell",
            "name": "Spell",
            "version": "1.0.0",
            "folder": "dnd-5e",
            "system": "D&D 5e",
            "category": "Spells",
            "description": "A spell.",
            "path": "templates/dnd-5e/5e-spell/5e-spell.yml",
            "body_path": "templates/dnd-5e/5e-spell/5e-spell.md",
            "sha256": "a" * 64,
            "body_sha256": _digest(BODY),
        },
        {
            "id": "ds-encounter",
            "name": "Encounter",
            "version": "1.0.0",
            "folder": "draw-steel",
            "system": "Draw Steel",
            "category": "Encounters",
            "path": "templates/draw-steel/ds-encounter/ds-encounter.yml",
            "body_path": "templates/draw-steel/ds-encounter/ds-encounter.md",
            "sha256": "b" * 64,
            "body_sha256": _digest("# Encounter\n"),
        },
        {
            "id": "session-recap",
            "name": "Session Recap",
            "version": "1.0.0",
            "folder": "generic",
            "category": "Sessions",
            "author": "octocat",
            "path": "templates/generic/session-recap/session-recap.yml",
            "body_path": "templates/generic/session-recap/session-recap.md",
            "sha256": "c" * 64,
            "body_sha256": _digest("# Recap\n"),
        },
    ],
}


@pytest.fixture
def remote(monkeypatch, downloads_enabled):
    """Stub the catalogue fetch and the per-template body download."""
    state = {"catalogue": CATALOGUE, "bodies": {"5e-spell": BODY}}

    def fake_fetch_catalogue(db, force=False):
        doc = state["catalogue"]
        if isinstance(doc, Exception):
            raise doc
        return doc

    def fake_fetch_body(db, entry):
        body = state["bodies"].get(entry.get("id"))
        if body is None:
            raise catalogue.TemplateCatalogueError("could not download the template")
        return body

    monkeypatch.setattr(catalogue, "fetch_catalogue", fake_fetch_catalogue)
    monkeypatch.setattr(catalogue, "fetch_body", fake_fetch_body)
    return state


# --------------------------------------------------------------------------- #
# The campaign's own templates
# --------------------------------------------------------------------------- #


class TestCrud:
    def test_a_new_campaign_has_no_templates(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.get(f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers)
        assert resp.status_code == 200
        assert resp.json()["templates"] == []

    def test_creates_a_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = _create(client, gm_headers, c["id"], category="Spells")
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Spell"
        # A hand-written template is marked as the GM's own — a game system is
        # meaningless for one, so the client cannot set it.
        assert body["system"] == AUTHORED_SYSTEM
        # Authored templates carry no provenance.
        assert body["source_id"] is None

    def test_an_empty_name_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        assert _create(client, gm_headers, c["id"], name="  ").status_code == 422

    def test_an_uncategorised_template_reads_as_general(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        tpl = _create(client, gm_headers, c["id"]).json()
        assert tpl["category"] == "General"

    def test_lists_and_fetches_a_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()

        listed = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers
        ).json()["templates"]
        assert [t["id"] for t in listed] == [created["id"]]
        # The list is a summary; the body comes from the detail read.
        assert "body" not in listed[0]

        detail = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}", headers=gm_headers
        ).json()
        # The frontmatter is split out into `defaults`; `body` is the markdown.
        assert "---" not in detail["body"]
        assert "2nd-level transmutation" in detail["body"]
        assert detail["defaults"]["title"] == "Spell"
        assert detail["defaults"]["icon"] == "sparkles"
        assert detail["defaults"]["visibility"] == "group"

    def test_updates_a_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        resp = client.patch(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
            json={"name": "Cantrip", "body": "# New"},
            headers=gm_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["name"] == "Cantrip"
        assert body["body"] == "# New"
        # A body-only edit leaves the page defaults alone.
        assert body["defaults"]["icon"] == "sparkles"
        assert body["defaults"]["visibility"] == "group"

    def test_an_update_cannot_blank_the_name(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        resp = client.patch(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
            json={"name": "   "},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_deletes_a_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        assert (
            client.delete(
                f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
                headers=gm_headers,
            ).status_code
            == 204
        )
        assert (
            client.get(
                f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
                headers=gm_headers,
            ).status_code
            == 404
        )

    def test_templates_are_scoped_to_their_campaign(self, client, gm_headers):
        """A template id from another campaign must not be readable here."""
        a = _campaign(client, gm_headers)
        b = _campaign(client, gm_headers)
        created = _create(client, gm_headers, a["id"]).json()
        resp = client.get(
            f"/api/campaigns/{b['id']}/wiki/templates/{created['id']}", headers=gm_headers
        )
        assert resp.status_code == 404

    def test_a_non_owner_is_refused(self, client, gm_headers, player_headers):
        c = _campaign(client, gm_headers)
        assert (
            client.get(
                f"/api/campaigns/{c['id']}/wiki/templates", headers=player_headers
            ).status_code
            == 403
        )
        assert _create(client, player_headers, c["id"]).status_code == 403

    def test_deleting_the_campaign_takes_its_templates(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        assert (
            client.delete(f"/api/campaigns/{c['id']}", headers=gm_headers).status_code
            in (200, 204)
        )
        session = SessionLocal()
        assert session.query(WikiTemplate).filter_by(id=created["id"]).first() is None
        session.close()

    def test_reports_the_campaign_system(self, client, gm_headers):
        c = _campaign(client, gm_headers, system_name="D&D 5e")
        resp = client.get(f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers)
        assert resp.json()["campaign_system"] == "D&D 5e"

    def test_a_linked_game_system_wins_over_the_free_text_name(self, client, gm_headers):
        from backend.tests.conftest import make_game_system

        system = make_game_system(name=f"Draw Steel {uid()}")
        c = _campaign(client, gm_headers, system_id=system.id)
        resp = client.get(f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers)
        assert resp.json()["campaign_system"] == system.name


# --------------------------------------------------------------------------- #
# Using a template
# --------------------------------------------------------------------------- #


class TestUse:
    def test_creates_a_page_from_a_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        tpl = _create(client, gm_headers, c["id"]).json()
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/use", headers=gm_headers
        )
        assert resp.status_code == 201
        page = resp.json()["pages"][0]
        assert page["title"] == "Spell"

        full = client.get(
            f"/api/campaigns/{c['id']}/wiki/{page['id']}", headers=gm_headers
        ).json()
        assert full["visibility"] == "group"
        assert full["icon"] == "sparkles"
        assert "2nd-level transmutation" in full["body"]

    def test_using_twice_creates_two_pages(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        tpl = _create(client, gm_headers, c["id"]).json()
        url = f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/use"
        first = client.post(url, headers=gm_headers).json()["pages"][0]
        second = client.post(url, headers=gm_headers).json()["pages"][0]
        assert first["id"] != second["id"]
        assert first["slug"] != second["slug"]

    def test_a_body_without_frontmatter_falls_back_to_the_template_name(
        self, client, gm_headers
    ):
        c = _campaign(client, gm_headers)
        tpl = _create(client, gm_headers, c["id"], name="Bare", body="Just text.\n").json()
        page = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/use", headers=gm_headers
        ).json()["pages"][0]
        assert page["title"] == "Bare"

    def test_an_id_pin_in_a_template_link_is_dropped(self, client, gm_headers):
        """A community template cannot know this campaign's page ids."""
        c = _campaign(client, gm_headers)
        tpl = _create(
            client,
            gm_headers,
            c["id"],
            body="---\ntitle: Spell\n---\n\nSee [[Other:id-abc123]].\n",
        ).json()
        page = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/use", headers=gm_headers
        ).json()["pages"][0]
        full = client.get(
            f"/api/campaigns/{c['id']}/wiki/{page['id']}", headers=gm_headers
        ).json()
        assert "id-abc123" not in full["body"]
        assert "[[Other]]" in full["body"]

    def test_an_unknown_template_is_404(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        assert (
            client.post(
                f"/api/campaigns/{c['id']}/wiki/templates/nope/use", headers=gm_headers
            ).status_code
            == 404
        )


# --------------------------------------------------------------------------- #
# Upload and export
# --------------------------------------------------------------------------- #


class TestUploadExport:
    def _upload(self, client, headers, cid, name, content):
        return client.post(
            f"/api/campaigns/{cid}/wiki/templates/upload",
            files={"file": (name, content.encode(), "text/markdown")},
            headers=headers,
        )

    def test_uploads_a_markdown_template(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = self._upload(client, gm_headers, c["id"], "spell.md", BODY)
        assert resp.status_code == 201
        # The frontmatter title names the template.
        assert resp.json()["name"] == "Spell"
        # Uploaded verbatim; the frontmatter is surfaced as defaults on read.
        assert resp.json()["defaults"]["icon"] == "sparkles"

    def test_an_upload_without_frontmatter_falls_back_to_the_filename(
        self, client, gm_headers
    ):
        c = _campaign(client, gm_headers)
        resp = self._upload(client, gm_headers, c["id"], "my-notes.md", "Just text.\n")
        assert resp.json()["name"] == "my-notes"

    def test_a_non_markdown_upload_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        assert self._upload(client, gm_headers, c["id"], "x.pdf", "nope").status_code == 400

    def test_an_empty_upload_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        assert self._upload(client, gm_headers, c["id"], "x.md", "").status_code == 400

    def test_an_oversized_upload_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        huge = "x" * (512 * 1024 + 10)
        assert self._upload(client, gm_headers, c["id"], "x.md", huge).status_code == 413

    def _zip(self, files: dict) -> bytes:
        buf = io.BytesIO()
        with zipfile.ZipFile(buf, "w") as zf:
            for name, content in files.items():
                zf.writestr(name, content)
        return buf.getvalue()

    def _upload_zip(self, client, headers, cid, files, name="template.zip"):
        return client.post(
            f"/api/campaigns/{cid}/wiki/templates/upload",
            files={"file": (name, self._zip(files), "application/zip")},
            headers=headers,
        )

    def test_uploads_a_zip_with_its_manifest(self, client, gm_headers):
        """The layout export produces: <id>/<id>.yml plus <id>/<id>.md."""
        c = _campaign(client, gm_headers)
        manifest = (
            "id: 5e-spell\nname: Spell\nversion: 1.0.0\nkind: note-template\n"
            "category: Spells\ndescription: A spell.\n"
        )
        resp = self._upload_zip(
            client,
            gm_headers,
            c["id"],
            {"5e-spell/5e-spell.yml": manifest, "5e-spell/5e-spell.md": BODY},
        )
        assert resp.status_code == 201
        body = resp.json()
        # The manifest supplies the metadata a bare .md cannot.
        assert body["name"] == "Spell"
        assert body["category"] == "Spells"
        assert body["description"] == "A spell."
        assert body["defaults"]["icon"] == "sparkles"

    def test_a_zip_without_a_manifest_falls_back_to_the_body(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(client, gm_headers, c["id"], {"spell.md": BODY})
        assert resp.status_code == 201
        # No manifest, so the frontmatter title names it.
        assert resp.json()["name"] == "Spell"
        assert resp.json()["category"] == "General"

    def test_an_export_round_trips_back_through_upload(self, client, gm_headers):
        """Export then re-upload must preserve the template."""
        c = _campaign(client, gm_headers)
        original = _create(
            client, gm_headers, c["id"], category="Spells", description="A spell."
        ).json()
        export = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{original['id']}/export",
            headers=gm_headers,
        )

        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/upload",
            files={"file": ("spell.zip", export.content, "application/zip")},
            headers=gm_headers,
        )
        assert resp.status_code == 201
        restored = resp.json()
        assert restored["name"] == original["name"]
        assert restored["category"] == original["category"]
        assert restored["description"] == original["description"]
        assert restored["defaults"] == original["defaults"]
        assert restored["body"] == original["body"]

    def test_a_zip_with_no_markdown_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(client, gm_headers, c["id"], {"x/x.yml": "name: X\n"})
        assert resp.status_code == 400

    def test_a_corrupt_zip_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/upload",
            files={"file": ("broken.zip", b"PK\x03\x04 not really a zip", "application/zip")},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_a_zip_renamed_to_md_is_still_read_as_a_zip(self, client, gm_headers):
        """Sniffed by magic bytes, so a mislabelled archive isn't stored as
        a body of binary noise."""
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(
            client, gm_headers, c["id"], {"spell.md": BODY}, name="spell.md"
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "Spell"

    def test_macos_resource_forks_are_ignored(self, client, gm_headers):
        """A zip made on a Mac carries __MACOSX/ copies that would otherwise
        win the "first .md" race."""
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(
            client,
            gm_headers,
            c["id"],
            {
                "__MACOSX/._spell.md": "junk",
                "spell/spell.md": BODY,
            },
        )
        assert resp.status_code == 201
        assert resp.json()["name"] == "Spell"

    def test_a_malformed_manifest_does_not_fail_the_upload(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(
            client,
            gm_headers,
            c["id"],
            {"x/x.yml": "name: [unclosed\n", "x/x.md": BODY},
        )
        assert resp.status_code == 201
        # Falls back to the body's frontmatter rather than erroring.
        assert resp.json()["name"] == "Spell"

    def test_a_zip_declaring_a_huge_member_is_refused(self, client, gm_headers):
        """The declared size is checked before decompressing, so a zip bomb
        cannot be expanded in memory first."""
        c = _campaign(client, gm_headers)
        resp = self._upload_zip(
            client, gm_headers, c["id"], {"x/x.md": "x" * (512 * 1024 + 10)}
        )
        assert resp.status_code == 413

    def test_uploading_works_with_downloads_disabled(self, client, gm_headers, monkeypatch):
        """The documented escape hatch: copy the .md across by hand."""
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        c = _campaign(client, gm_headers)
        assert self._upload(client, gm_headers, c["id"], "spell.md", BODY).status_code == 201

    def test_exports_a_template_as_a_zip_folder(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        tpl = _create(
            client,
            gm_headers,
            c["id"],
            name="Magic Item",
            system="D&D 5e",
            category="Items",
            description="An item.",
        ).json()
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/export", headers=gm_headers
        )
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"

        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert sorted(zf.namelist()) == ["magic-item/magic-item.md", "magic-item/magic-item.yml"]
        manifest = zf.read("magic-item/magic-item.yml").decode()
        assert "id: magic-item" in manifest
        assert "kind: note-template" in manifest
        assert "system: " in manifest
        assert zf.read("magic-item/magic-item.md").decode().startswith("---")

    def test_an_export_reuses_the_community_id_it_came_from(
        self, client, gm_headers, remote
    ):
        """A downloaded-then-exported template keeps its identity."""
        c = _campaign(client, gm_headers)
        tpl = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell", headers=gm_headers
        ).json()
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/export", headers=gm_headers
        )
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        assert "5e-spell/5e-spell.yml" in zf.namelist()

    def test_a_name_needing_quoting_stays_valid_yaml(self, client, gm_headers):
        import yaml

        c = _campaign(client, gm_headers)
        tpl = _create(client, gm_headers, c["id"], name="Spell: The Sequel").json()
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{tpl['id']}/export", headers=gm_headers
        )
        zf = zipfile.ZipFile(io.BytesIO(resp.content))
        name = [n for n in zf.namelist() if n.endswith(".yml")][0]
        parsed = yaml.safe_load(zf.read(name).decode())
        assert parsed["name"] == "Spell: The Sequel"


# --------------------------------------------------------------------------- #
# The community catalogue
# --------------------------------------------------------------------------- #


class TestBrowse:
    def test_returns_the_folder_tree_with_generic_first(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        )
        assert resp.status_code == 200
        folders = resp.json()["folders"]
        # Generic leads; the rest are alphabetical by display name.
        assert [f["name"] for f in folders] == [
            "Generic",
            "Draw Steel",
            "Dungeons & Dragons 5e",
        ]
        assert [t["id"] for t in folders[0]["templates"]] == ["session-recap"]

    def test_reports_the_template_author(self, client, gm_headers, remote):
        """The catalogue byline reaches the browser; templates without one get ""."""
        c = _campaign(client, gm_headers)
        folders = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        ).json()["folders"]
        generic = {t["id"]: t for t in folders[0]["templates"]}
        assert generic["session-recap"]["author"] == "octocat"
        assert generic["session-recap"]["author_url"] == "https://github.com/octocat"
        # A template that declares no author still serialises the key.
        others = [t for f in folders[1:] for t in f["templates"]]
        assert all(t["author"] == "" for t in others)
        assert all(t["author_url"] == "" for t in others)

    def test_marks_templates_already_downloaded(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell", headers=gm_headers
        )
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        )
        assert resp.json()["downloaded_ids"] == ["5e-spell"]

    def test_reports_the_default_source(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        ).json()
        assert body["is_custom_url"] is False
        assert body["index_url"] == config.DEFAULT_WIKI_TEMPLATE_INDEX_URL

    def test_an_unreachable_catalogue_is_a_502(self, client, gm_headers, remote):
        remote["catalogue"] = catalogue.TemplateCatalogueError("source timed out")
        c = _campaign(client, gm_headers)
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        )
        assert resp.status_code == 502
        assert "timed out" in resp.json()["detail"]

    def test_browsing_is_refused_when_downloads_are_disabled(
        self, client, gm_headers, monkeypatch
    ):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        c = _campaign(client, gm_headers)
        resp = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/browse", headers=gm_headers
        )
        assert resp.status_code == 403

    def test_the_list_endpoint_reports_downloads_disabled(
        self, client, gm_headers, monkeypatch
    ):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        c = _campaign(client, gm_headers)
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers
        ).json()
        assert body["downloads_enabled"] is False


class TestDownload:
    def test_downloads_a_template_into_the_campaign(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell", headers=gm_headers
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["name"] == "Spell"
        assert body["system"] == "D&D 5e"
        assert body["defaults"]["icon"] == "sparkles"
        assert "2nd-level transmutation" in body["body"]
        # Provenance is recorded so the copy can be traced back.
        assert body["source_id"] == "5e-spell"
        assert body["source_version"] == "1.0.0"

    def test_downloading_twice_makes_two_copies(self, client, gm_headers, remote):
        """Templates are per-campaign working copies; a second is legitimate."""
        c = _campaign(client, gm_headers)
        url = f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell"
        first = client.post(url, headers=gm_headers).json()
        second = client.post(url, headers=gm_headers).json()
        assert first["id"] != second["id"]

    def test_an_unknown_template_is_404(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/nope", headers=gm_headers
        )
        assert resp.status_code == 404

    def test_a_failed_body_download_is_a_502(self, client, gm_headers, remote):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/ds-encounter",
            headers=gm_headers,
        )
        assert resp.status_code == 502

    def test_downloading_is_refused_when_disabled(self, client, gm_headers, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell", headers=gm_headers
        )
        assert resp.status_code == 403

    def test_a_non_owner_cannot_download(self, client, gm_headers, player_headers, remote):
        c = _campaign(client, gm_headers)
        resp = client.post(
            f"/api/campaigns/{c['id']}/wiki/templates/download/5e-spell",
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestSource:
    def test_sets_and_resets_the_catalogue_url(self, client, gm_headers, downloads_enabled):
        c = _campaign(client, gm_headers)
        url = f"/api/campaigns/{c['id']}/wiki/templates/source"

        resp = client.put(
            url, json={"index_url": "https://example.com/t.json"}, headers=gm_headers
        )
        assert resp.status_code == 200
        assert resp.json()["is_custom_url"] is True

        resp = client.put(url, json={"index_url": ""}, headers=gm_headers)
        assert resp.json()["index_url"] == config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
        assert resp.json()["is_custom_url"] is False

    def test_a_non_http_url_is_rejected(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        resp = client.put(
            f"/api/campaigns/{c['id']}/wiki/templates/source",
            json={"index_url": "file:///etc/passwd"},
            headers=gm_headers,
        )
        assert resp.status_code == 400

    def test_a_non_owner_cannot_change_the_source(self, client, gm_headers, player_headers):
        c = _campaign(client, gm_headers)
        resp = client.put(
            f"/api/campaigns/{c['id']}/wiki/templates/source",
            json={"index_url": "https://example.com/t.json"},
            headers=player_headers,
        )
        assert resp.status_code == 403


# --------------------------------------------------------------------------- #
# The catalogue service, directly
# --------------------------------------------------------------------------- #


class TestCatalogueService:
    def test_build_tree_pins_generic_first(self):
        tree = catalogue.build_tree(CATALOGUE)
        assert [f["name"] for f in tree] == [
            "Generic",
            "Draw Steel",
            "Dungeons & Dragons 5e",
        ]

    def test_build_tree_defaults_a_missing_category(self):
        doc = {"templates": [{"id": "x", "name": "X", "folder": ""}]}
        assert catalogue.build_tree(doc)[0]["templates"][0]["category"] == "General"

    def test_build_tree_labels_the_top_level_folder_generic(self):
        doc = {"templates": [{"id": "x", "name": "X", "folder": ""}]}
        assert catalogue.build_tree(doc)[0]["name"] == "Generic"

    def test_build_tree_falls_back_to_the_folder_path(self):
        """A folder with no declared display name still gets a label."""
        doc = {"templates": [{"id": "x", "name": "X", "folder": "some/thing"}]}
        assert catalogue.build_tree(doc)[0]["name"] == "thing"

    def test_build_tree_skips_entries_without_an_id(self):
        doc = {"templates": [{"name": "No id"}, {"id": "ok", "name": "OK"}]}
        tree = catalogue.build_tree(doc)
        assert [t["id"] for t in tree[0]["templates"]] == ["ok"]

    def test_build_tree_tolerates_a_malformed_document(self):
        assert catalogue.build_tree({}) == []
        assert catalogue.build_tree({"templates": "nope"}) == []

    def test_find_entry(self):
        assert catalogue.find_entry(CATALOGUE, "5e-spell")["name"] == "Spell"
        assert catalogue.find_entry(CATALOGUE, "nope") is None

    def test_a_body_on_another_host_is_refused(self):
        """A catalogue must not be able to redirect the fetch off its own host."""
        entry = {"body_path": "https://evil.example/x.md"}
        with pytest.raises(catalogue.TemplateCatalogueError, match="unexpected host"):
            catalogue._resolve_body_url("https://good.example/templates/index.json", entry)

    def test_an_entry_without_a_body_path_is_refused(self):
        with pytest.raises(catalogue.TemplateCatalogueError, match="body file"):
            catalogue._resolve_body_url("https://good.example/index.json", {})

    def test_the_repo_relative_body_path_does_not_double_the_index_folder(self):
        """The real catalogue lives at `<repo>/templates/index.json` while
        `body_path` is repo-relative, so a naive join produces
        `…/templates/templates/…` and 404s every download."""
        url = catalogue._resolve_body_url(
            "https://raw.githubusercontent.com/o/r/main/templates/index.json",
            {"body_path": "templates/dnd-5e/5e-spell/5e-spell.md"},
        )
        assert url == (
            "https://raw.githubusercontent.com/o/r/main/"
            "templates/dnd-5e/5e-spell/5e-spell.md"
        )

    def test_a_body_path_resolves_when_the_index_sits_at_the_root(self):
        url = catalogue._resolve_body_url(
            "https://good.example/index.json",
            {"body_path": "templates/x/y/y.md"},
        )
        assert url == "https://good.example/templates/x/y/y.md"

    def test_a_body_path_resolves_under_a_nested_mirror(self):
        """A mirror may serve the repo from a subdirectory."""
        url = catalogue._resolve_body_url(
            "https://good.example/mirror/repo/templates/index.json",
            {"body_path": "templates/x/y/y.md"},
        )
        assert url == "https://good.example/mirror/repo/templates/x/y/y.md"

    def test_a_body_path_sharing_no_segment_with_the_index_is_appended(self):
        url = catalogue._resolve_body_url(
            "https://good.example/templates/index.json",
            {"body_path": "x/y.md"},
        )
        assert url == "https://good.example/templates/x/y.md"

    def test_the_catalogue_fetch_uses_the_short_timeout(self, monkeypatch, downloads_enabled):
        """A download makes two requests back to back; the add-on default (30s)
        each would let a reverse proxy time out first and return an opaque 502
        instead of our own error."""
        seen = {}

        def fake_fetch_document(url, **kwargs):
            seen.update(kwargs)
            return {"templates": []}

        monkeypatch.setattr(catalogue, "fetch_document", fake_fetch_document)
        session = SessionLocal()
        try:
            catalogue.fetch_catalogue(session)
        finally:
            session.close()
        assert seen["timeout"] == catalogue.FETCH_TIMEOUT
        assert catalogue.FETCH_TIMEOUT <= 15

    def test_fetching_is_refused_when_downloads_are_disabled(self, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="disabled"):
                catalogue.fetch_catalogue(session)
        finally:
            session.close()

    def test_get_index_url_prefers_a_custom_value(self, downloads_enabled):
        session = SessionLocal()
        try:
            assert catalogue.get_index_url(session) == config.DEFAULT_WIKI_TEMPLATE_INDEX_URL
            catalogue.set_index_url(session, "https://example.com/t.json")
            session.commit()
            assert catalogue.get_index_url(session) == "https://example.com/t.json"
            assert catalogue.is_custom_url(session) is True
        finally:
            session.close()

    def test_a_non_http_custom_url_is_rejected(self):
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="http"):
                catalogue.set_index_url(session, "ftp://example.com/t.json")
        finally:
            session.close()

    def test_a_non_dict_catalogue_is_rejected(self, monkeypatch, downloads_enabled):
        monkeypatch.setattr(catalogue, "fetch_document", lambda *a, **kw: ["nope"])
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="expected format"):
                catalogue.fetch_catalogue(session)
        finally:
            session.close()

    def test_a_fetch_failure_is_surfaced(self, monkeypatch, downloads_enabled):
        from backend.addons.fetch import AddonFetchError

        def boom(*a, **kw):
            raise AddonFetchError("source timed out")

        monkeypatch.setattr(catalogue, "fetch_document", boom)
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="timed out"):
                catalogue.fetch_catalogue(session)
        finally:
            session.close()

    def test_fetch_body_verifies_the_digest(self, monkeypatch, downloads_enabled):
        """A body that does not match the catalogue's digest is refused."""
        import httpx

        entry = {
            "body_path": "templates/x/x.md",
            "body_sha256": _digest("the real body"),
        }

        class FakeResponse:
            status_code = 200
            content = b"tampered"

        class FakeClient:
            def __init__(self, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url):
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="integrity check"):
                catalogue.fetch_body(session, entry)
        finally:
            session.close()

    def test_fetch_body_returns_a_verified_body(self, monkeypatch, downloads_enabled):
        import httpx

        entry = {"body_path": "templates/x/x.md", "body_sha256": _digest(BODY)}

        class FakeResponse:
            status_code = 200
            content = BODY.encode()

        class FakeClient:
            def __init__(self, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url):
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)
        session = SessionLocal()
        try:
            assert catalogue.fetch_body(session, entry) == BODY
        finally:
            session.close()

    def test_fetch_body_reports_a_bad_status(self, monkeypatch, downloads_enabled):
        import httpx

        class FakeResponse:
            status_code = 404
            content = b""

        class FakeClient:
            def __init__(self, **kw):
                pass

            def __enter__(self):
                return self

            def __exit__(self, *a):
                return False

            def get(self, url):
                return FakeResponse()

        monkeypatch.setattr(httpx, "Client", FakeClient)
        session = SessionLocal()
        try:
            with pytest.raises(catalogue.TemplateCatalogueError, match="HTTP 404"):
                catalogue.fetch_body(session, {"body_path": "x.md"})
        finally:
            session.close()

    def test_downloads_enabled_tracks_the_env_flag(self, monkeypatch):
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", True)
        assert catalogue.downloads_enabled() is False
        monkeypatch.setattr(config, "DISABLE_EXTERNAL_ADD_ON_INSTALL", False)
        assert catalogue.downloads_enabled() is True


# --------------------------------------------------------------------------- #
# Frontmatter round-tripping
# --------------------------------------------------------------------------- #


class TestFrontmatter:
    """The editor shows page defaults as form fields, so the frontmatter block
    is split off on read and rebuilt on write. Two things must hold: saving
    never stacks blocks up, and ordinary markdown is never mistaken for one."""

    def test_parses_a_real_block(self):
        fields, body = split_frontmatter(BODY)
        assert fields == {"title": "Spell", "icon": "sparkles", "visibility": "group"}
        assert body.startswith("*2nd-level transmutation*")

    @pytest.mark.parametrize(
        "text",
        [
            "## Goals\n\n- a\n",                      # no frontmatter at all
            "---\n\nProse after a thematic break\n",   # a horizontal rule
            "---\ntitle: X\n\nnever closes",           # unterminated
            "---\n---\n\nbody",                        # empty block
            "---\nfoo: bar\n---\n\nbody",              # no keys we know
            "---\n| a | b |\n---\n\nbody",             # a table, not key: value
        ],
    )
    def test_ordinary_markdown_is_not_treated_as_frontmatter(self, text):
        fields, body = split_frontmatter(text)
        assert fields == {}
        assert body == text

    def test_composing_is_idempotent(self):
        """Re-saving must not stack a second block on the first."""
        fields = {"title": "Spell", "icon": "sparkles", "visibility": "group"}
        once = compose(fields, "Body text")
        twice = compose(fields, once)
        assert once == twice
        assert once.count("---") == 2

    def test_a_split_compose_round_trip_is_stable(self):
        doc = compose({"title": "Spell", "visibility": "group"}, "Body")
        for _ in range(5):
            fields, body = split_frontmatter(doc)
            doc = compose(fields, body)
        assert doc == compose({"title": "Spell", "visibility": "group"}, "Body")

    def test_dropping_every_default_leaves_a_clean_body(self):
        doc = compose({"title": "Spell"}, "Body")
        assert compose({}, doc) == "Body"

    def test_a_value_needing_quoting_survives(self):
        doc = compose({"title": "Spell: The Sequel"}, "Body")
        fields, _ = split_frontmatter(doc)
        assert fields["title"] == "Spell: The Sequel"

    def test_editing_only_the_defaults_keeps_the_body(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        resp = client.patch(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
            json={"defaults": {"title": "Cantrip", "visibility": "gm"}},
            headers=gm_headers,
        )
        body = resp.json()
        assert body["defaults"]["title"] == "Cantrip"
        assert "2nd-level transmutation" in body["body"]

    def test_a_client_posting_a_full_document_does_not_double_the_block(
        self, client, gm_headers
    ):
        """A client that sends back the whole document (frontmatter included)
        alongside defaults must still end up with exactly one block."""
        c = _campaign(client, gm_headers)
        created = _create(client, gm_headers, c["id"]).json()
        resp = client.patch(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}",
            json={
                "body": BODY,  # still carries its own frontmatter
                "defaults": {"title": "Spell", "icon": "sparkles", "visibility": "group"},
            },
            headers=gm_headers,
        )
        assert resp.status_code == 200
        assert "---" not in resp.json()["body"]

        export = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates/{created['id']}/export",
            headers=gm_headers,
        )
        md = zipfile.ZipFile(io.BytesIO(export.content)).read("spell/spell.md").decode()
        assert md.count("---") == 2


class TestCategories:
    def test_offers_the_suggested_categories(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers
        ).json()
        assert "Spells" in body["categories"]
        assert "Sessions" in body["categories"]

    def test_includes_a_category_the_campaign_already_uses(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        _create(client, gm_headers, c["id"], category="Airships")
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers
        ).json()
        assert "Airships" in body["categories"]

    def test_reports_the_authored_marker(self, client, gm_headers):
        c = _campaign(client, gm_headers)
        body = client.get(
            f"/api/campaigns/{c['id']}/wiki/templates", headers=gm_headers
        ).json()
        assert body["authored_system"] == AUTHORED_SYSTEM
