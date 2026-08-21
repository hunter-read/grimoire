"""Page-serving tests for non-PDF book formats (issues #180, #200, #373).

Exercises the reader endpoints for comic archives (page images served straight
out of the archive), plain-text books (text served from the synthetic pages),
and EPUB/DjVu (rendered through PyMuPDF like a PDF).
"""
import io
import os
import tempfile
import uuid
import zipfile
from pathlib import Path

import pytest
from PIL import Image

from backend.tests.conftest import make_book, make_game_system


def _png_bytes(color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), color).save(buf, "PNG")
    return buf.getvalue()


@pytest.fixture(scope="module")
def sys_row():
    return make_game_system()


@pytest.fixture(scope="module")
def tmpdir_mod():
    return tempfile.mkdtemp()


class TestComicPages:
    """Comic archives page in the reader instead of downloading (issue #180)."""

    def _make_comic(self, system_id, tmp, pages=3):
        # Unique per call: books.filepath is UNIQUE in the schema.
        path = os.path.join(tmp, f"comic-{pages}-{uuid.uuid4().hex[:8]}.cbz")
        with zipfile.ZipFile(path, "w") as z:
            for i in range(1, pages + 1):
                z.writestr(f"p{i:02d}.png", _png_bytes((i * 30, 10, 10)))
        return make_book(
            system_id=system_id,
            title="Comic Issue",
            filename=os.path.basename(path),
            filepath=path,
            mime_type="application/vnd.comicbook+zip",
            page_count=pages,
        )

    def test_serves_a_page_image_from_the_archive(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        book = self._make_comic(sys_row.id, tmpdir_mod)
        resp = client.get(f"/api/books/{book.id}/page/2", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"].startswith("image/")
        # The bytes are the real page image, not a placeholder.
        assert Image.open(io.BytesIO(resp.content)).size == (20, 30)

    def test_page_beyond_the_end_is_404(self, client, admin_headers, sys_row, tmpdir_mod):
        book = self._make_comic(sys_row.id, tmpdir_mod, pages=2)
        resp = client.get(f"/api/books/{book.id}/page/99", headers=admin_headers)
        assert resp.status_code == 404

    def test_missing_archive_on_disk_is_404(self, client, admin_headers, sys_row):
        book = make_book(
            system_id=sys_row.id,
            title="Gone Comic",
            filename="gone.cbz",
            filepath="/nonexistent/gone.cbz",
            mime_type="application/vnd.comicbook+zip",
            page_count=5,
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404

    def test_words_overlay_is_empty_for_a_comic(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        """Comics have no text geometry — an empty overlay, never a 500."""
        book = self._make_comic(sys_row.id, tmpdir_mod)
        resp = client.get(f"/api/books/{book.id}/page/1/words", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json() == {"width": 0, "height": 0, "words": []}


class TestTextBookPages:
    """Plain-text books serve their synthetic pages as text (issue #200)."""

    def _make_text_book(self, system_id, tmp, name, content, mime):
        path = os.path.join(tmp, f"{uuid.uuid4().hex[:8]}-{name}")
        Path(path).write_text(content)
        return make_book(
            system_id=system_id,
            title="Text Doc",
            filename=name,
            filepath=path,
            mime_type=mime,
            page_count=1,
        )

    def test_serves_text_of_a_markdown_book(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        book = self._make_text_book(
            sys_row.id, tmpdir_mod, "notes.md", "# Heading\n\nThe lich king waits.", "text/markdown"
        )
        resp = client.get(f"/api/books/{book.id}/page/1/text", headers=admin_headers)
        assert resp.status_code == 200
        assert "lich king" in resp.json()["text"]

    def test_page_out_of_range_is_400(self, client, admin_headers, sys_row, tmpdir_mod):
        book = self._make_text_book(
            sys_row.id, tmpdir_mod, "short.txt", "Just one page", "text/plain"
        )
        resp = client.get(f"/api/books/{book.id}/page/99/text", headers=admin_headers)
        assert resp.status_code == 400

    def test_missing_file_is_404(self, client, admin_headers, sys_row):
        book = make_book(
            system_id=sys_row.id,
            title="Gone Text",
            filename="gone.txt",
            filepath="/nonexistent/gone.txt",
            mime_type="text/plain",
            page_count=1,
        )
        resp = client.get(f"/api/books/{book.id}/page/1/text", headers=admin_headers)
        assert resp.status_code == 404

    def test_words_overlay_is_empty_for_text(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        book = self._make_text_book(
            sys_row.id, tmpdir_mod, "words.txt", "Some prose here", "text/plain"
        )
        resp = client.get(f"/api/books/{book.id}/page/1/words", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["words"] == []

    def test_rendering_a_text_book_as_an_image_is_404(
        self, client, admin_headers, sys_row, tmpdir_mod
    ):
        """A text book has no page image to render."""
        book = self._make_text_book(
            sys_row.id, tmpdir_mod, "render.txt", "No pixels here", "text/plain"
        )
        resp = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 404


def _make_epub_file(path: Path, body: str) -> None:
    with zipfile.ZipFile(path, "w") as z:
        z.writestr("mimetype", "application/epub+zip")
        z.writestr(
            "META-INF/container.xml",
            '<?xml version="1.0"?><container version="1.0" '
            'xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles>'
            '<rootfile full-path="c.opf" media-type="application/oebps-package+xml"/>'
            "</rootfiles></container>",
        )
        z.writestr(
            "c.opf",
            '<?xml version="1.0"?><package xmlns="http://www.idpf.org/2007/opf" '
            'version="3.0" unique-identifier="i"><metadata '
            'xmlns:dc="http://purl.org/dc/elements/1.1/">'
            '<dc:identifier id="i">x</dc:identifier><dc:title>T</dc:title>'
            "<dc:language>en</dc:language></metadata><manifest>"
            '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>'
            '</manifest><spine><itemref idref="c1"/></spine></package>',
        )
        z.writestr(
            "c1.xhtml",
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
            f"<body><p>{body}</p></body></html>",
        )


class TestEpubPages:
    """EPUB renders through the same pipeline as a PDF (issue #373)."""

    @pytest.fixture(scope="class")
    def epub_book(self, sys_row, tmpdir_mod):
        path = Path(tmpdir_mod) / "novel.epub"
        _make_epub_file(path, "The wizard studied the arcane tome for many hours.")
        return make_book(
            system_id=sys_row.id,
            title="Novel",
            filename="novel.epub",
            filepath=str(path),
            mime_type="application/epub+zip",
            page_count=1,
        )

    def test_renders_a_page_image(self, client, admin_headers, epub_book):
        resp = client.get(f"/api/books/{epub_book.id}/page/1", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.headers["content-type"] in ("image/webp", "image/png")

    def test_out_of_range_page_is_400(self, client, admin_headers, epub_book):
        resp = client.get(f"/api/books/{epub_book.id}/page/999", headers=admin_headers)
        assert resp.status_code == 400

    def test_serves_page_text(self, client, admin_headers, epub_book):
        resp = client.get(f"/api/books/{epub_book.id}/page/1/text", headers=admin_headers)
        assert resp.status_code == 200
        assert "arcane tome" in resp.json()["text"]

    def test_toc_endpoint_accepts_epub(self, client, admin_headers, epub_book):
        """Previously 404'd because the handler required application/pdf."""
        resp = client.get(f"/api/books/{epub_book.id}/toc", headers=admin_headers)
        assert resp.status_code == 200
        assert "toc" in resp.json()

    def test_words_overlay_available_for_epub(self, client, admin_headers, epub_book):
        resp = client.get(f"/api/books/{epub_book.id}/page/1/words", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["width"] > 0


class TestDjvuRouting:
    """DjVu has an image/* MIME but is a paged document (issue #373)."""

    def test_djvu_is_not_short_circuited_as_a_flat_image(
        self, client, admin_headers, sys_row
    ):
        """An image book 400s on page 2; a DjVu must reach the render path instead.

        The file does not exist, so the render path 404s — the point is that it
        is *not* the 400 the single-image branch would produce.
        """
        book = make_book(
            system_id=sys_row.id,
            title="Scanned DjVu",
            filename="scan.djvu",
            filepath="/nonexistent/scan.djvu",
            mime_type="image/vnd.djvu",
            page_count=12,
        )
        resp = client.get(f"/api/books/{book.id}/page/2", headers=admin_headers)
        assert resp.status_code == 404
