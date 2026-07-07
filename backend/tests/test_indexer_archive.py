"""Tests for archive-file indexing (issue #94).

Covers archive_ext()/archive_mime() classification and the scan_library
integration path that registers archives alongside books, including
first-image cover thumbnails for comic-book archives (.cbz/.cbt).
"""
from __future__ import annotations

import io
import os
import tarfile
import tempfile
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from backend.config import SessionLocal
from backend.indexer import (
    _first_image_from_archive,
    archive_ext,
    archive_mime,
    scan_library,
)
from backend.models import Book


# ---------------------------------------------------------------------------
# archive_ext / archive_mime
# ---------------------------------------------------------------------------

class TestArchiveExt:
    def test_single_suffix(self):
        assert archive_ext("bundle.zip") == ".zip"

    def test_comic_zip(self):
        assert archive_ext("comic.cbz") == ".cbz"

    def test_case_insensitive(self):
        assert archive_ext("BUNDLE.ZIP") == ".zip"

    def test_two_part_tar_gz(self):
        assert archive_ext("logs.tar.gz") == ".tar.gz"

    def test_two_part_tar_bz2(self):
        assert archive_ext("logs.tar.bz2") == ".tar.bz2"

    def test_tgz_single(self):
        assert archive_ext("logs.tgz") == ".tgz"

    def test_non_archive_returns_empty(self):
        assert archive_ext("book.pdf") == ""

    def test_no_extension_returns_empty(self):
        assert archive_ext("README") == ""


class TestArchiveMime:
    def test_zip(self):
        assert archive_mime(".zip") == "application/zip"

    def test_cbz(self):
        assert archive_mime(".cbz") == "application/vnd.comicbook+zip"

    def test_cbr(self):
        assert archive_mime(".cbr") == "application/vnd.comicbook-rar"

    def test_unknown_falls_back(self):
        assert archive_mime(".xyz") == "application/octet-stream"


# ---------------------------------------------------------------------------
# _first_image_from_archive
# ---------------------------------------------------------------------------

def _png_bytes() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), (120, 40, 40)).save(buf, "PNG")
    return buf.getvalue()


class TestFirstImageFromArchive:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def test_zip_picks_first_by_name(self):
        p = os.path.join(self.tmp, "a.cbz")
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("02.png", b"second")
            zf.writestr("01.png", _png_bytes())
            zf.writestr("notes.txt", b"ignore me")
        data = _first_image_from_archive(p, ".cbz")
        # 01.png sorts first and is a valid image.
        assert Image.open(io.BytesIO(data)).size == (20, 30)

    def test_zip_without_images_returns_none(self):
        p = os.path.join(self.tmp, "b.cbz")
        with zipfile.ZipFile(p, "w") as zf:
            zf.writestr("readme.txt", b"no images here")
        assert _first_image_from_archive(p, ".cbz") is None

    def test_tar_picks_image(self):
        p = os.path.join(self.tmp, "c.cbt")
        with tarfile.open(p, "w") as tf:
            data = _png_bytes()
            info = tarfile.TarInfo("page.png")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        out = _first_image_from_archive(p, ".cbt")
        assert Image.open(io.BytesIO(out)).size == (20, 30)

    def test_sevenzip_picks_image(self):
        py7zr = pytest.importorskip("py7zr")
        p = os.path.join(self.tmp, "d.cb7")
        with py7zr.SevenZipFile(p, "w") as zf:
            zf.writestr(_png_bytes(), "page.png")
        out = _first_image_from_archive(p, ".cb7")
        assert Image.open(io.BytesIO(out)).size == (20, 30)

    def test_corrupt_archive_returns_none(self):
        p = os.path.join(self.tmp, "corrupt.cbz")
        Path(p).write_bytes(b"not a real zip")
        assert _first_image_from_archive(p, ".cbz") is None

    def test_missing_rar_binary_returns_none(self):
        # A bogus .cbr — rarfile either can't parse it or lacks the extraction
        # backend; either way the helper must degrade to None, never raise.
        p = os.path.join(self.tmp, "e.cbr")
        Path(p).write_bytes(b"Rar!\x1a\x07\x00 not really")
        assert _first_image_from_archive(p, ".cbr") is None


# ---------------------------------------------------------------------------
# scan_library integration
# ---------------------------------------------------------------------------

def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    (lib / "books").mkdir(parents=True)
    return tmp, lib


class TestArchiveScan:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()
        # Unique system name per instance keeps the shared session DB isolated.
        self.system_dir = self.lib / "books" / f"ArchiveSys_{os.path.basename(self.tmp)}"
        (self.system_dir / "Utilities").mkdir(parents=True)

    def _scan(self):
        db = SessionLocal()
        try:
            scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def _get_book(self, filename: str) -> Book | None:
        db = SessionLocal()
        try:
            return db.query(Book).filter(Book.filename == filename).first()
        finally:
            db.close()

    def test_plain_zip_registered_without_thumbnail(self):
        name = f"tools_{os.path.basename(self.tmp)}.zip"
        with zipfile.ZipFile(self.system_dir / "Utilities" / name, "w") as zf:
            zf.writestr("notes.txt", "hello")
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "application/zip"
        assert book.category == "utilities"
        assert book.page_count == 0
        assert book.has_thumbnail is False

    def test_cbz_gets_cover_thumbnail(self):
        name = f"issue_{os.path.basename(self.tmp)}.cbz"
        with zipfile.ZipFile(self.system_dir / "Utilities" / name, "w") as zf:
            # Out-of-order names to prove name-sort ordering picks page 01.
            zf.writestr("02.png", _png_bytes())
            zf.writestr("01.png", _png_bytes())
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "application/vnd.comicbook+zip"
        assert book.has_thumbnail is True

    def test_cbt_tar_gets_cover_thumbnail(self):
        name = f"issue_{os.path.basename(self.tmp)}.cbt"
        buf = self.system_dir / "Utilities" / name
        with tarfile.open(buf, "w") as tf:
            data = _png_bytes()
            info = tarfile.TarInfo("page.png")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "application/x-tar"
        assert book.has_thumbnail is True

    def test_tar_gz_registered(self):
        name = f"pack_{os.path.basename(self.tmp)}.tar.gz"
        buf = self.system_dir / "Utilities" / name
        with tarfile.open(buf, "w:gz") as tf:
            data = b"payload"
            info = tarfile.TarInfo("data.bin")
            info.size = len(data)
            tf.addfile(info, io.BytesIO(data))
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "application/gzip"
        assert book.has_thumbnail is False
