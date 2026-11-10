"""A campaign keeps its map pages when the map leaves the library (issue #578).

Moves and renames keep a map's id, so a map page follows a map moved in the app
or outside it. A delete through the app copies the map into each campaign that
uses it first, as far as the campaign upload settings allow, and repoints its
map pages and ``[[map:id]]`` embeds at the copy. Whatever can't be copied - too
large, uploads off, a file already gone - is left as the placeholder a missing
map shows, pins intact.
"""
import io
import os
import shutil
import tempfile
import uuid
from pathlib import Path

import pytest
from PIL import Image

from backend.config import LIBRARY_PATH, SessionLocal
from backend.models import CampaignFile, CampaignResource, GenericMap, WikiPage
from backend.services import library_fs as fs
from backend.services.app_settings import set_raw
from backend.services.library_fs.deletes import delete_record, unindex_path
from backend.services.library_fs.rehome import rehome_references
from backend.tests.conftest import make_map
from backend.tests.test_wiki_map_pages import _get, _link_map, _map_page, _page, _pin


def uid():
    return uuid.uuid4().hex[:8]


def png_bytes(size=(8, 6)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", size, (40, 90, 160)).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture()
def map_dir():
    """A folder of this test's own maps inside the library, removed afterwards."""
    rel = f"maps/MapPages-{uid()}"
    path = Path(LIBRARY_PATH) / rel
    path.mkdir(parents=True, exist_ok=True)
    yield rel, path
    shutil.rmtree(path, ignore_errors=True)


@pytest.fixture()
def settings():
    """Set campaign upload settings for one test, restoring the defaults after."""
    touched = []

    def apply(**values):
        db = SessionLocal()
        for key, value in values.items():
            set_raw(db, key, str(value))
            touched.append(key)
        db.commit()
        db.close()

    yield apply
    db = SessionLocal()
    for key in touched:
        set_raw(db, key, "false" if key == "campaign_uploads_disabled" else "0")
    db.commit()
    db.close()


def _library_map(map_dir, name="coast.png", data=None):
    rel, path = map_dir
    target = path / name
    target.write_bytes(data if data is not None else png_bytes())
    return make_map(filepath=str(target), filename=name, relative_path=f"{rel}/{name}")


def _campaign(client, gm_headers):
    return client.post(
        "/api/campaigns", json={"name": f"Copies {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    ).json()["id"]


def _link(client, gm_headers, cid, m, visibility="public"):
    resp = client.post(
        f"/api/campaigns/{cid}/resources",
        json={"resource_type": "map", "resource_id": m.id, "visibility": visibility},
        headers=gm_headers,
    )
    assert resp.status_code in (200, 201), resp.text


def _delete_map(map_id, delete_file=True):
    db = SessionLocal()
    record = db.query(GenericMap).filter_by(id=map_id).one()
    delete_record(db, GenericMap, record, delete_file=delete_file)
    db.close()


def _resources(cid):
    db = SessionLocal()
    rows = [
        (r.resource_type, r.resource_id, r.visibility)
        for r in db.query(CampaignResource).filter_by(campaign_id=cid).all()
    ]
    db.close()
    return rows


class TestDeleteKeepsACopy:
    def test_map_page_moves_to_the_campaign_copy(self, client, gm_headers, map_dir):
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m, visibility="private")
        page = _map_page(client, gm_headers, cid, m.id)
        _pin(client, gm_headers, cid, page["id"], label="Port")

        _delete_map(m.id)

        got = _get(client, gm_headers, cid, page["id"])
        assert got["map"]["source"] == "file"
        assert got["map"]["name"] == "coast.png"
        assert [p["label"] for p in got["pins"]] == ["Port"]
        # The map's link is now a file link, as visible as the map was.
        assert _resources(cid) == [("file", got["map"]["id"], "private")]
        served = client.get(f"/api/campaigns/{cid}/files/{got['map']['id']}", headers=gm_headers)
        assert served.status_code == 200 and served.content == png_bytes()

    def test_embeds_become_images(self, client, gm_headers, map_dir):
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        other = make_map()
        note = _page(
            client, gm_headers, cid, title="Travel",
            body=f"Route: [[map:{m.id}|the coast]] and [[map:{other.id}]].",
        )
        _delete_map(m.id)
        body = _get(client, gm_headers, cid, note["id"])["body"]
        db = SessionLocal()
        copy = db.query(CampaignFile).filter_by(campaign_id=cid).one()
        db.close()
        assert body == f"Route: [[image:{copy.id}]] and [[map:{other.id}]]."
        # Never linked as a resource, so the copy is the GM's, like an upload.
        assert _resources(cid) == [("file", copy.id, "gm")]

    def test_every_campaign_gets_its_own_copy(self, client, gm_headers, map_dir):
        first, second = _campaign(client, gm_headers), _campaign(client, gm_headers)
        m = _library_map(map_dir)
        pages = []
        for cid in (first, second):
            _link(client, gm_headers, cid, m)
            pages.append((cid, _map_page(client, gm_headers, cid, m.id)["id"]))
        _delete_map(m.id)
        copies = {_get(client, gm_headers, cid, pid)["map"]["id"] for cid, pid in pages}
        assert len(copies) == 2

    def test_too_large_for_the_campaign_leaves_a_placeholder(
        self, client, gm_headers, map_dir, settings
    ):
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir, data=png_bytes() + b"\0" * (1024 * 1024))
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)
        _pin(client, gm_headers, cid, page["id"], label="Kept")
        settings(campaign_upload_max_file_mb=1)

        assert [c.outcome for c in _plan(m.id)] == ["too_large"]
        _delete_map(m.id)

        got = _get(client, gm_headers, cid, page["id"])
        assert got["map"]["source"] == "missing"
        assert [p["label"] for p in got["pins"]] == ["Kept"]

    def test_the_campaign_total_counts_every_copy(self, client, gm_headers, map_dir, settings):
        cid = _campaign(client, gm_headers)
        big = png_bytes() + b"\0" * (700 * 1024)
        maps = [_library_map(map_dir, f"m{i}.png", big) for i in range(2)]
        for m in maps:
            _link(client, gm_headers, cid, m)
        settings(campaign_upload_max_total_mb=1)
        db = SessionLocal()
        records = db.query(GenericMap).filter(GenericMap.id.in_([m.id for m in maps])).all()
        from backend.services.campaigns.map_copies import plan_map_copies

        outcomes = sorted(c.outcome for c in plan_map_copies(db, records))
        db.close()
        assert outcomes == ["copy", "too_large"]

    def test_uploads_off_leaves_a_placeholder(self, client, gm_headers, map_dir, settings):
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)
        settings(campaign_uploads_disabled="true")
        _delete_map(m.id)
        assert _get(client, gm_headers, cid, page["id"])["map"]["source"] == "missing"

    def test_a_file_already_gone_leaves_a_placeholder(self, client, gm_headers, map_dir):
        # The cleanup sweep's case: deleted outside the app, noticed later.
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)
        os.remove(m.filepath)
        _delete_map(m.id, delete_file=False)
        got = _get(client, gm_headers, cid, page["id"])
        assert got["map"]["source"] == "missing"
        assert _resources(cid) == []

    def test_delete_from_the_file_manager(self, client, admin_headers, gm_headers, map_dir):
        rel, _path = map_dir
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)

        preview = client.get(
            "/api/files/campaign-map-copies", params={"path": rel}, headers=admin_headers
        )
        assert preview.status_code == 200
        assert [(c["campaign_id"], c["outcome"]) for c in preview.json()["campaigns"]] == [
            (cid, "copy")
        ]

        resp = client.post(
            "/api/files/delete",
            json={"path": f"{rel}/coast.png", "delete_files": True},
            headers=admin_headers,
        )
        assert resp.status_code == 200, resp.text
        assert not os.path.exists(m.filepath)
        assert _get(client, gm_headers, cid, page["id"])["map"]["source"] == "file"

    def test_a_soft_remove_keeps_a_copy_too(self, client, gm_headers, map_dir):
        # The file stays, but a rescan would bring it back under a new id.
        rel, _path = map_dir
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)
        db = SessionLocal()
        unindex_path(db, f"{rel}/coast.png")
        db.close()
        assert _get(client, gm_headers, cid, page["id"])["map"]["source"] == "file"

    def test_a_failed_delete_leaves_no_copy_behind(self, client, gm_headers, map_dir, monkeypatch):
        rel, _path = map_dir
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)

        def refuse(self, *a, **k):
            raise PermissionError(13, "Permission denied")

        from backend.services.campaigns.map_copies import FILES_DIR

        before = set(os.listdir(FILES_DIR)) if os.path.isdir(FILES_DIR) else set()
        monkeypatch.setattr(Path, "unlink", refuse)
        db = SessionLocal()
        with pytest.raises(fs.LibraryFSError):
            fs.delete_path(db, f"{rel}/coast.png")
        db.close()
        monkeypatch.undo()

        assert _get(client, gm_headers, cid, page["id"])["map"]["source"] == "library"
        db = SessionLocal()
        assert db.query(CampaignFile).filter_by(campaign_id=cid).count() == 0
        db.close()
        assert set(os.listdir(FILES_DIR)) == before

    def test_unused_maps_copy_nothing(self, map_dir):
        m = _library_map(map_dir)
        assert _plan(m.id) == []


def _plan(map_id):
    from backend.services.campaigns.map_copies import plan_map_copies

    db = SessionLocal()
    try:
        return plan_map_copies(db, [db.query(GenericMap).filter_by(id=map_id).one()])
    finally:
        db.close()


class TestMovesKeepTheMap:
    def test_moved_in_the_app(self, client, gm_headers, map_dir):
        rel, path = map_dir
        (path / "indoor").mkdir()
        cid = _campaign(client, gm_headers)
        m = _library_map(map_dir)
        _link(client, gm_headers, cid, m)
        page = _map_page(client, gm_headers, cid, m.id)
        db = SessionLocal()
        fs.move_paths(db, [f"{rel}/coast.png"], f"{rel}/indoor")
        db.close()
        got = _get(client, gm_headers, cid, page["id"])
        assert got["map"]["source"] == "library" and got["map"]["id"] == m.id

    def test_moved_outside_the_app(self, client, gm_headers):
        from backend.indexer import scan_library

        tmp = tempfile.mkdtemp()
        try:
            lib = Path(tmp) / "library"
            (lib / "maps" / "Region").mkdir(parents=True)
            (lib / "maps" / "Region" / "coast.png").write_bytes(png_bytes((9, 7)))

            def scan():
                db = SessionLocal()
                try:
                    scan_library(str(lib), tmp, db)
                finally:
                    db.close()

            scan()
            db = SessionLocal()
            record = db.query(GenericMap).filter(GenericMap.filepath.like(f"{tmp}%")).one()
            map_id = record.id
            db.close()

            cid = _campaign(client, gm_headers)
            _link(client, gm_headers, cid, record)
            page = _map_page(client, gm_headers, cid, map_id)

            (lib / "maps" / "Elsewhere").mkdir()
            shutil.move(
                str(lib / "maps" / "Region" / "coast.png"),
                str(lib / "maps" / "Elsewhere" / "shore.png"),
            )
            scan()

            db = SessionLocal()
            moved = db.query(GenericMap).filter_by(id=map_id).one()
            assert moved.filepath.endswith("Elsewhere/shore.png")
            db.close()
            got = _get(client, gm_headers, cid, page["id"])
            assert got["map"]["source"] == "library" and got["map"]["id"] == map_id
        finally:
            db = SessionLocal()
            for row in db.query(GenericMap).filter(GenericMap.filepath.like(f"{tmp}%")).all():
                db.delete(row)
            db.commit()
            db.close()
            shutil.rmtree(tmp, ignore_errors=True)

    def test_merged_duplicates_keep_the_survivor(self, client, gm_headers):
        cid = _campaign(client, gm_headers)
        keep, dupe = make_map(), make_map()
        _link_map_record(client, gm_headers, cid, dupe)
        page = _map_page(client, gm_headers, cid, dupe.id)
        db = SessionLocal()
        report = rehome_references(db, GenericMap, dupe.id, keep.id)
        db.commit()
        assert db.query(WikiPage).filter_by(id=page["id"]).one().map_id == keep.id
        db.close()
        assert report["notes"]["moved"] >= 1


def _link_map_record(client, gm_headers, cid, m):
    resp = client.post(
        f"/api/campaigns/{cid}/resources",
        json={"resource_type": "map", "resource_id": m.id, "visibility": "public"},
        headers=gm_headers,
    )
    assert resp.status_code in (200, 201), resp.text


# Re-exported for the page tests, which share this module's PNG.
__all__ = ["png_bytes", "_link_map"]
