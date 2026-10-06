"""Tests for browsing and installing content packs from the community catalogue.

Packs used to arrive only by copying a directory onto the server by hand, which
left the SRD published in the community repository with no way to reach anyone.
These cover the half that was missing - and, because a pack is several files
written straight to disk, the safety rules that come with that.
"""
import hashlib
import json
import os

import pytest

from backend.config import SessionLocal
from backend.services.characters import pack_catalogue as pc
from backend.services.characters import packs as ps


REPO = "https://raw.githubusercontent.com/grimoire-codex/community-add-ons"

META = {
    "pack_id": "test-srd",
    "schema_id": "pc-demo",
    "name": "Test SRD",
    "version": "1.0.0",
    "description": "A small pack.",
    "license": "CC-BY-4.0",
    "license_url": "https://creativecommons.org/licenses/by/4.0/",
    "attribution": "Test SRD, CC BY 4.0.",
    "source": "srd",
}
SPELLS = [
    {"_id": "fireball", "name": "Fireball", "level": 3},
    {"_id": "shield", "name": "Shield", "level": 1},
]


def _digest(payload) -> str:
    return hashlib.sha256(json.dumps(payload).encode()).hexdigest()


def _files():
    return [
        {
            "name": "_meta.json",
            "path": "content-packs/test-srd/_meta.json",
            "sha256": _digest(META),
            "bytes": 100,
        },
        {
            "name": "spell.json",
            "path": "content-packs/test-srd/spell.json",
            "sha256": _digest(SPELLS),
            "bytes": 200,
        },
    ]


def _index():
    return {
        "version": 1,
        "packs": [
            {
                "pack_id": "test-srd",
                "schema_id": "pc-demo",
                "name": "Test SRD",
                "version": "1.0.0",
                "description": "A small pack.",
                "license": "CC-BY-4.0",
                "attribution": "Test SRD, CC BY 4.0.",
                "entry_count": 2,
                "content_types": ["spell"],
                "files": _files(),
            }
        ],
    }


BODIES = {
    "content-packs/test-srd/_meta.json": json.dumps(META).encode(),
    "content-packs/test-srd/spell.json": json.dumps(SPELLS).encode(),
}


@pytest.fixture
def served(monkeypatch, tmp_path):
    """Serve the index and each pack file, and install into a temp directory."""
    monkeypatch.setattr(pc, "fetch_document", lambda url, **kwargs: _index())
    monkeypatch.setattr(
        pc, "get_index_urls", lambda db: [f"{REPO}/main/index.json"]
    )

    def _download(url, max_bytes, *, what):
        for suffix, body in BODIES.items():
            if url.endswith(suffix):
                return body
        raise pc.CatalogueError(f"nothing at {url}")

    monkeypatch.setattr(pc, "_download", _download)
    # The loader's path, which the installer reads too - so this also checks
    # the two cannot write and look in different places.
    monkeypatch.setattr(ps, "CONTENT_DIR", str(tmp_path / "character-content"))
    yield str(tmp_path / "character-content")

    # The catalog is shared across the session, so a pack loaded by one test
    # would otherwise still be installed for the next.
    session = SessionLocal()
    try:
        session.execute(ps.text("DELETE FROM content_search"))
        session.query(ps.ContentEntry).delete()
        session.query(ps.ContentPack).delete()
        session.commit()
    finally:
        session.close()


@pytest.fixture
def session():
    """A plain session, for the service-level tests that take one directly."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


class TestCandidateUrls:
    """The pack index is found the same three ways the sheet index is."""

    def test_tries_the_configured_url_then_the_pack_path(self):
        assert pc._pack_candidates(f"{REPO}/main/index.json") == [
            f"{REPO}/main/index.json",
            f"{REPO}/main/content-packs/index.json",
        ]

    def test_steps_out_of_a_sibling_catalogue_directory(self):
        candidates = pc._pack_candidates(f"{REPO}/main/themes/index.json")
        assert f"{REPO}/main/content-packs/index.json" in candidates

    def test_reaches_a_branch_named_after_a_catalogue_directory(self):
        """The bug that started all of this, applied to packs."""
        candidates = pc._pack_candidates(f"{REPO}/feat/character-sheets/index.json")
        assert f"{REPO}/feat/character-sheets/content-packs/index.json" in candidates

    def test_a_url_already_on_the_pack_catalogue_is_tried_first(self):
        candidates = pc._pack_candidates(f"{REPO}/main/content-packs/index.json")
        assert candidates[0] == f"{REPO}/main/content-packs/index.json"

    def test_candidates_are_never_repeated(self):
        for configured in (
            f"{REPO}/main/index.json",
            f"{REPO}/main/content-packs/index.json",
            f"{REPO}/feat/character-sheets/index.json",
            f"{REPO}/main",
        ):
            candidates = pc._pack_candidates(configured)
            assert len(candidates) == len(set(candidates)), configured


class TestBrowsing:
    def test_lists_packs_with_what_is_in_them(self, client, admin_headers, served):
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        pack = body["packs"][0]
        assert pack["name"] == "Test SRD"
        assert pack["entry_count"] == 2
        assert pack["content_types"] == ["spell"]
        # Shown before installing, because several licences require it.
        assert pack["attribution"] == "Test SRD, CC BY 4.0."

    def test_an_admin_may_install(self, client, admin_headers, served):
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["can_install"] is True

    def test_a_gm_may_browse_but_not_install(self, client, gm_headers, served):
        """So a GM can see what the SRD offers before asking for it."""
        body = client.get("/api/rulesets/packs/browse", headers=gm_headers).json()
        assert body["packs"]
        assert body["can_install"] is False

    def test_browsing_needs_an_account(self, client, served):
        assert client.get("/api/rulesets/packs/browse").status_code in (401, 403)

    def test_a_source_with_no_packs_is_reported(
        self, client, admin_headers, monkeypatch, served
    ):
        monkeypatch.setattr(pc, "fetch_document", lambda url, **kwargs: {"sheets": []})
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["packs"] == []
        assert body["errors"], "an empty catalogue should say why"

    def test_an_unreachable_source_is_reported(
        self, client, admin_headers, monkeypatch, served
    ):
        def _raise(url, **kwargs):
            raise pc.AddonFetchError("connection refused")

        monkeypatch.setattr(pc, "fetch_document", _raise)
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["packs"] == []
        assert "connection refused" in body["errors"][0]["error"]


class TestInstalling:
    def _install(self, client, headers, pack_id="test-srd"):
        return client.post(f"/api/rulesets/packs/install/{pack_id}", headers=headers)

    def test_installs_and_loads_a_pack(self, client, admin_headers, served, session):
        resp = self._install(client, admin_headers)
        assert resp.status_code == 200, resp.json()
        body = resp.json()
        assert body["pack_id"] == "test-srd"
        assert body["entry_count"] == 2

        # On disk, as a directory the loader can re-read on restart.
        assert sorted(os.listdir(os.path.join(served, "test-srd"))) == [
            "_meta.json",
            "spell.json",
        ]
        # And in the catalog, so it is importable without a reload step.
        assert session.query(ps.ContentPack).filter_by(pack_id="test-srd").first()

    def test_the_installed_pack_is_importable_into_a_ruleset(
        self, client, admin_headers, served
    ):
        """The whole point: a pack reaches a table's ruleset."""
        self._install(client, admin_headers)
        installable = client.get(
            "/api/rulesets/installable?schema_id=pc-demo", headers=admin_headers
        ).json()
        assert [p["pack_id"] for p in installable["packs"]] == ["test-srd"]

    def test_a_gm_cannot_install(self, client, gm_headers, served):
        """A pack is server-wide, so installing one is an admin decision."""
        assert self._install(client, gm_headers).status_code == 403

    def test_a_player_cannot_install(self, client, player_headers, served):
        assert self._install(client, player_headers).status_code == 403

    def test_a_pack_not_in_the_catalogue_is_404(self, client, admin_headers, served):
        assert self._install(client, admin_headers, "no-such-pack").status_code == 404

    def test_marks_it_installed_on_the_next_browse(self, client, admin_headers, served):
        self._install(client, admin_headers)
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["packs"][0]["installed"] is True

    def test_installing_twice_replaces_rather_than_duplicating(
        self, client, admin_headers, served, session
    ):
        self._install(client, admin_headers)
        assert self._install(client, admin_headers).status_code == 200
        assert session.query(ps.ContentPack).filter_by(pack_id="test-srd").count() == 1
        assert (
            session.query(ps.ContentEntry)
            .filter_by(schema_id="pc-demo", content_type="spell")
            .count()
            == 2
        )


class TestInstallSafety:
    """A pack is written straight to disk, so its metadata cannot be trusted."""

    def _entry(self, **overrides):
        entry = {
            "pack_id": "test-srd",
            "schema_id": "pc-demo",
            "index_url": f"{REPO}/main/content-packs/index.json",
            "files": _files(),
        }
        entry.update(overrides)
        return entry

    def test_refuses_a_tampered_file(self, session, served, monkeypatch):
        files = [dict(f) for f in _files()]
        files[1]["sha256"] = "0" * 64

        def _download(url, max_bytes, *, what):
            return BODIES["content-packs/test-srd/spell.json"]

        monkeypatch.setattr(pc, "_download", _download)
        with pytest.raises(pc.PackCatalogueError, match="integrity"):
            pc.install_pack(session, self._entry(files=files))

    def test_refuses_a_filename_that_climbs_out_of_the_directory(self, session, served):
        files = [_files()[0], {**_files()[1], "name": "../../evil.json"}]
        with pytest.raises(pc.PackCatalogueError, match="unusable file"):
            pc.install_pack(session, self._entry(files=files))

    def test_refuses_a_file_that_is_not_json(self, session, served):
        files = [_files()[0], {**_files()[1], "name": "evil.sh"}]
        with pytest.raises(pc.PackCatalogueError, match="JSON files"):
            pc.install_pack(session, self._entry(files=files))

    @pytest.mark.parametrize("pack_id", ["../escape", "a/b", ".hidden", ""])
    def test_refuses_a_pack_id_that_is_not_a_plain_directory_name(
        self, session, served, pack_id
    ):
        with pytest.raises(pc.PackCatalogueError, match="usable id"):
            pc.install_pack(session, self._entry(pack_id=pack_id))

    def test_refuses_a_pack_with_no_metadata(self, session, served):
        with pytest.raises(pc.PackCatalogueError, match="_meta.json"):
            pc.install_pack(session, self._entry(files=[_files()[1]]))

    def test_refuses_a_pack_listing_no_files(self, session, served):
        with pytest.raises(pc.PackCatalogueError, match="no files"):
            pc.install_pack(session, self._entry(files=[]))

    def test_refuses_too_many_files(self, session, served):
        files = [_files()[0]] + [
            {**_files()[1], "name": f"t{i}.json"} for i in range(pc.MAX_PACK_FILES + 1)
        ]
        with pytest.raises(pc.PackCatalogueError, match="too many files"):
            pc.install_pack(session, self._entry(files=files))

    def test_refuses_a_file_on_another_host(self, session, served):
        files = [_files()[0], {**_files()[1], "path": "https://evil.test/spell.json"}]
        with pytest.raises(pc.PackCatalogueError, match="unexpected host"):
            pc.install_pack(session, self._entry(files=files))

    def test_a_failed_install_leaves_the_previous_copy_standing(self, session, served, monkeypatch):
        """Staged and swapped, so a half-download cannot replace a working pack."""
        pc.install_pack(session, self._entry())
        before = sorted(os.listdir(os.path.join(served, "test-srd")))

        files = [dict(f) for f in _files()]
        files[1]["sha256"] = "0" * 64
        with pytest.raises(pc.PackCatalogueError):
            pc.install_pack(session, self._entry(files=files))

        assert sorted(os.listdir(os.path.join(served, "test-srd"))) == before
        # And nothing half-written left lying beside it.
        assert [d for d in os.listdir(served) if d.startswith(".")] == []

    def test_refuses_when_downloads_are_disabled(self, session, served, monkeypatch):
        monkeypatch.setattr(pc, "external_installs_enabled", lambda: False)
        with pytest.raises(pc.PackCatalogueError, match="disabled"):
            pc.install_pack(session, self._entry())


class TestInstalledMeansOnDisk:
    """A pack whose directory is gone is not installed, whatever the rows say."""

    def test_a_pack_removed_from_disk_is_offered_again(self, client, admin_headers, served):
        import shutil

        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        shutil.rmtree(os.path.join(served, "test-srd"))

        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["packs"][0]["installed"] is False

    def test_the_catalogue_offers_it_again_after_a_reload_finds_it_gone(
        self, client, admin_headers, served, session
    ):
        """And the stale rows are gone, not merely hidden."""
        import shutil

        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        shutil.rmtree(os.path.join(served, "test-srd"))
        client.get("/api/rulesets/packs/browse", headers=admin_headers)
        assert session.query(ps.ContentPack).filter_by(pack_id="test-srd").count() == 0

    def test_it_can_then_be_installed_again(self, client, admin_headers, served):
        import shutil

        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        shutil.rmtree(os.path.join(served, "test-srd"))
        client.get("/api/rulesets/packs/browse", headers=admin_headers)
        resp = client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        assert resp.status_code == 200
        assert os.path.isdir(os.path.join(served, "test-srd"))


class TestUninstalling:
    def test_removes_the_directory_and_the_rows(self, client, admin_headers, served, session):
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        resp = client.delete("/api/rulesets/packs/test-srd", headers=admin_headers)
        assert resp.status_code == 200
        assert not os.path.exists(os.path.join(served, "test-srd"))
        assert session.query(ps.ContentPack).filter_by(pack_id="test-srd").count() == 0
        assert session.query(ps.ContentEntry).filter_by(schema_id="pc-demo").count() == 0

    def test_it_is_offered_for_install_again(self, client, admin_headers, served):
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        client.delete("/api/rulesets/packs/test-srd", headers=admin_headers)
        body = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()
        assert body["packs"][0]["installed"] is False

    def test_a_ruleset_that_imported_it_keeps_its_copy(
        self, client, admin_headers, served
    ):
        """Importing copies the entries, which is what makes a ruleset stable."""
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        ruleset = client.post(
            "/api/rulesets", json={"schema_id": "pc-demo", "name": "Kept"}, headers=admin_headers
        ).json()
        client.post(
            f"/api/rulesets/{ruleset['id']}/import",
            json={"pack_id": "test-srd"},
            headers=admin_headers,
        )
        client.delete("/api/rulesets/packs/test-srd", headers=admin_headers)
        entries = client.get(
            f"/api/rulesets/{ruleset['id']}/entries", headers=admin_headers
        ).json()["entries"]
        assert len(entries) == 2
        client.delete(f"/api/rulesets/{ruleset['id']}", headers=admin_headers)

    def test_a_pack_that_is_not_installed_is_404(self, client, admin_headers, served):
        assert client.delete("/api/rulesets/packs/nope", headers=admin_headers).status_code == 404

    def test_only_an_admin_may(self, client, admin_headers, gm_headers, served):
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        assert client.delete("/api/rulesets/packs/test-srd", headers=gm_headers).status_code == 403

    def test_refuses_a_directory_name_that_could_escape(self, session, served):
        """A tampered row cannot turn uninstall into deleting something else."""
        pack = ps.ContentPack(pack_id="evil", schema_id="x", name="E", directory="../../etc")
        session.add(pack)
        session.commit()
        outside = os.path.dirname(served)
        before = sorted(os.listdir(outside))
        assert ps.uninstall_pack(session, "evil") is True
        assert sorted(os.listdir(outside)) == before


class TestUpdates:
    def test_reports_the_installed_version(self, client, admin_headers, served):
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        pack = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()["packs"][0]
        assert pack["installed_version"] == "1.0.0"
        assert pack["update_available"] is False

    def test_offers_a_newer_version_as_an_update(
        self, client, admin_headers, served, monkeypatch
    ):
        client.post("/api/rulesets/packs/install/test-srd", headers=admin_headers)
        newer = _index()
        newer["packs"][0]["version"] = "1.10.0"
        monkeypatch.setattr(pc, "fetch_document", lambda url, **kwargs: newer)
        pack = client.get("/api/rulesets/packs/browse", headers=admin_headers).json()["packs"][0]
        assert pack["update_available"] is True

    @pytest.mark.parametrize(
        "offered, installed, expected",
        [
            ("1.10.0", "1.9.0", True),
            ("1.0.0", "1.0.0", False),
            ("0.9.0", "1.0.0", False),
            ("", "1.0.0", False),
            ("1.0.0", "", False),
            ("banana", "1.0.0", False),
        ],
    )
    def test_compares_versions_as_numbers(self, offered, installed, expected):
        assert pc._newer(offered, installed) is expected
