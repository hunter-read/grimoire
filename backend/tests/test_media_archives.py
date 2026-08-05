"""Archive support in the maps / tokens / audio collections (issue #250).

Map packs and art collections are commonly distributed as zips bundling the
images with supplementary files (PSD, STL, …). Those archives are indexed as
opaque items in their collection: listed, downloadable, and flagged
``is_archive`` so the UI offers a download instead of a broken preview.
"""
import os
import pathlib
import tempfile
import zipfile

from backend.tests.conftest import make_audio, make_map, make_token
from backend.indexer.constants import MEDIA_ARCHIVE_EXTS, _COMIC_ARCHIVE_EXTS


def _write_zip(path, name="inner.png", data=b"fake-png"):
    """Create a real zip on disk so FileResponse has something to serve."""
    with zipfile.ZipFile(path, "w") as zf:
        zf.writestr(name, data)
    return path


class TestMediaArchiveExts:
    def test_excludes_comic_archives(self):
        # A .cbz in the maps tree is a misfiled book, not a map pack.
        assert not (MEDIA_ARCHIVE_EXTS & _COMIC_ARCHIVE_EXTS)

    def test_includes_common_archive_formats(self):
        for ext in (".zip", ".rar", ".7z", ".tar", ".tar.gz", ".tar.bz2"):
            assert ext in MEDIA_ARCHIVE_EXTS


class TestMapArchives:
    def test_list_flags_archive(self, client, admin_headers):
        m = make_map(filename="pack.zip", relative_path="Dungeons/pack.zip")
        resp = client.get("/api/maps", headers=admin_headers)
        assert resp.status_code == 200
        row = next(x for x in resp.json()["maps"] if x["id"] == m.id)
        assert row["is_archive"] is True

    def test_list_flags_non_archive(self, client, admin_headers):
        m = make_map(filename="plain.png")
        resp = client.get("/api/maps", headers=admin_headers)
        row = next(x for x in resp.json()["maps"] if x["id"] == m.id)
        assert row["is_archive"] is False

    def test_detail_flags_archive_and_skips_image_probe(
        self, client, admin_headers, tmp_path
    ):
        f = _write_zip(tmp_path / "pack.zip")
        m = make_map(filename="pack.zip", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_archive"] is True
        # No raster to measure, and no PDF page reader.
        assert body["is_pdf"] is False
        assert body["pixel_width"] is None
        assert body["grid"] is None

    def test_serves_archive_with_zip_mime(self, client, admin_headers, tmp_path):
        f = _write_zip(tmp_path / "pack.zip")
        m = make_map(filename="pack.zip", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"
        assert resp.content == f.read_bytes()

    def test_serves_multi_suffix_archive(self, client, admin_headers, tmp_path):
        f = tmp_path / "pack.tar.gz"
        f.write_bytes(b"\x1f\x8b fake gzip")
        m = make_map(filename="pack.tar.gz", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/gzip"

    def test_page_endpoint_rejects_archive(self, client, admin_headers, tmp_path):
        f = _write_zip(tmp_path / "pack.zip")
        m = make_map(filename="pack.zip", filepath=str(f))
        resp = client.get(f"/api/maps/{m.id}/page/1", headers=admin_headers)
        assert resp.status_code == 400


class TestTokenArchives:
    def test_list_flags_archive(self, client, admin_headers):
        t = make_token(filename="tokens.zip")
        resp = client.get("/api/tokens", headers=admin_headers)
        row = next(x for x in resp.json()["tokens"] if x["id"] == t.id)
        assert row["is_archive"] is True

    def test_detail_flags_archive_without_dimensions(
        self, client, admin_headers, tmp_path
    ):
        f = _write_zip(tmp_path / "tokens.zip")
        t = make_token(filename="tokens.zip", filepath=str(f))
        resp = client.get(f"/api/tokens/{t.id}", headers=admin_headers)
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_archive"] is True
        assert body["pixel_width"] is None
        assert body["pixel_height"] is None

    def test_serves_archive_with_zip_mime(self, client, admin_headers, tmp_path):
        f = _write_zip(tmp_path / "tokens.zip")
        t = make_token(filename="tokens.zip", filepath=str(f))
        resp = client.get(f"/api/tokens/{t.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"


class TestAudioArchives:
    def test_list_flags_archive(self, client, admin_headers):
        a = make_audio(filename="ambience.zip", duration=0.0, title="")
        resp = client.get("/api/audio", headers=admin_headers)
        row = next(x for x in resp.json()["audio"] if x["id"] == a.id)
        assert row["is_archive"] is True

    def test_detail_flags_archive(self, client, admin_headers):
        a = make_audio(filename="ambience.zip", duration=0.0, title="")
        resp = client.get(f"/api/audio/{a.id}", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["is_archive"] is True

    def test_regular_track_not_flagged(self, client, admin_headers):
        a = make_audio(filename="theme.mp3")
        resp = client.get(f"/api/audio/{a.id}", headers=admin_headers)
        assert resp.json()["is_archive"] is False

    def test_serves_archive_with_zip_mime(self, client, admin_headers, tmp_path):
        f = _write_zip(tmp_path / "ambience.zip")
        a = make_audio(filename="ambience.zip", filepath=str(f))
        resp = client.get(f"/api/audio/{a.id}/file", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] == "application/zip"


class TestScanRegistersArchives:
    """The indexer walks archives into maps / tokens / audio."""

    def setup_method(self):
        self.tmp = tempfile.mkdtemp()
        self.lib = pathlib.Path(self.tmp) / "library"
        # Unique suffix per instance — tests share one DB session.
        self.uid = os.path.basename(self.tmp)
        for section in ("maps", "tokens", "audio"):
            (self.lib / section / "Pack").mkdir(parents=True)
        self.map_zip = self.lib / "maps" / "Pack" / f"battlemaps_{self.uid}.zip"
        _write_zip(self.map_zip)
        _write_zip(self.lib / "tokens" / "Pack" / f"portraits_{self.uid}.zip")
        _write_zip(self.lib / "audio" / "Pack" / f"ambience_{self.uid}.zip")
        # A comic archive in the maps tree stays out — it is a books format.
        _write_zip(self.lib / "maps" / "Pack" / f"issue_{self.uid}.cbz")

    def _scan(self):
        from backend.config import SessionLocal
        from backend.indexer import scan_library

        db = SessionLocal()
        try:
            scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def test_registers_archives_in_each_collection(self):
        from backend.config import SessionLocal
        from backend.models import Audio, GenericMap, Token

        self._scan()

        db = SessionLocal()
        try:
            m = db.query(GenericMap).filter_by(filename=f"battlemaps_{self.uid}.zip").first()
            t = db.query(Token).filter_by(filename=f"portraits_{self.uid}.zip").first()
            a = db.query(Audio).filter_by(filename=f"ambience_{self.uid}.zip").first()
            assert m is not None
            assert t is not None
            assert a is not None
            # Archives are opaque: no thumbnail, and no audio metadata.
            assert not m.has_thumbnail
            assert not t.has_thumbnail
            assert a.duration == 0.0
            assert not a.has_artwork
            # Comic archives are books-only and must not land in maps.
            assert (
                db.query(GenericMap).filter_by(filename=f"issue_{self.uid}.cbz").first() is None
            )
        finally:
            db.close()

    def test_archive_file_size_recorded(self):
        from backend.config import SessionLocal
        from backend.models import GenericMap

        self._scan()

        db = SessionLocal()
        try:
            m = db.query(GenericMap).filter_by(filename=f"battlemaps_{self.uid}.zip").first()
            assert m.file_size == os.path.getsize(self.map_zip)
        finally:
            db.close()
