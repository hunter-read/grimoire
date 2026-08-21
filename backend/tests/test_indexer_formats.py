"""Tests for multi-format book support (issues #180, #200, #373).

Covers the per-format capability table, plain-text book extraction/pagination,
comic-archive paging, and the scan_library integration that registers EPUB,
text, and comic books with the right MIME type, page count, thumbnail, and
full-text index.
"""
from __future__ import annotations

import io
import os
import tarfile
import tempfile
import zipfile
from pathlib import Path

from PIL import Image
from sqlalchemy import text as sql_text

from backend.config import DATA_PATH, SessionLocal
from backend.indexer import comics, index_book_text, scan_library, text_documents
from backend.indexer import formats
from backend.indexer.thumbnails import _first_image_from_archive, generate_thumbnail
from backend.models import Book


def _png_bytes(color=(10, 20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (20, 30), color).save(buf, "PNG")
    return buf.getvalue()


def _make_epub(path: Path, title: str = "Test Tome", body: str = "") -> None:
    """Write a minimal but valid EPUB that PyMuPDF can open."""
    text = body or "The dragon guards the hoard beneath the lonely mountain."
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
            f'<dc:identifier id="i">x</dc:identifier><dc:title>{title}</dc:title>'
            "<dc:language>en</dc:language></metadata><manifest>"
            '<item id="c1" href="c1.xhtml" media-type="application/xhtml+xml"/>'
            "</manifest><spine><itemref idref=\"c1\"/></spine></package>",
        )
        z.writestr(
            "c1.xhtml",
            '<?xml version="1.0"?><html xmlns="http://www.w3.org/1999/xhtml">'
            f"<body><h1>Chapter One</h1><p>{text}</p></body></html>",
        )


# ---------------------------------------------------------------------------
# formats: the capability table
# ---------------------------------------------------------------------------

class TestFormatTable:
    def test_epub_and_djvu_are_indexable(self):
        """The core of issue #373: these were filtered out of indexing."""
        assert formats.can_index("application/epub+zip")
        assert formats.can_index("image/vnd.djvu")

    def test_pdf_still_indexable(self):
        assert formats.can_index("application/pdf")

    def test_archives_are_not_indexable(self):
        assert not formats.can_index("application/zip")
        assert not formats.can_index("application/vnd.comicbook+zip")

    def test_text_formats_are_indexable(self):
        for mime in ("text/plain", "text/markdown", "application/rtf"):
            assert formats.can_index(mime)

    def test_mime_for_ext_covers_new_formats(self):
        assert formats.mime_for_ext(".epub") == "application/epub+zip"
        assert formats.mime_for_ext(".djvu") == "image/vnd.djvu"
        assert formats.mime_for_ext(".md") == "text/markdown"
        assert formats.mime_for_ext(".rtf") == "application/rtf"

    def test_mime_for_ext_is_case_insensitive(self):
        assert formats.mime_for_ext(".EPUB") == "application/epub+zip"

    def test_mime_for_ext_unknown_returns_none(self):
        assert formats.mime_for_ext(".xyz") is None

    def test_comic_mimes_match_the_archive_table(self):
        """Comic MIMEs must equal _ARCHIVE_MIME or existing DBs disagree."""
        from backend.indexer.constants import _ARCHIVE_MIME

        for ext in (".cbz", ".cbr", ".cb7", ".cbt"):
            assert formats.mime_for_ext(ext) == _ARCHIVE_MIME[ext]

    def test_thumbnailable_formats(self):
        assert formats.can_thumbnail(".epub")
        assert formats.can_thumbnail(".pdf")
        assert formats.can_thumbnail(".cbz")
        # Text documents have no cover art to render.
        assert not formats.can_thumbnail(".txt")
        assert not formats.can_thumbnail(".xyz")

    def test_page_count_formats(self):
        assert formats.has_page_count(".pdf")
        assert formats.has_page_count(".epub")
        assert formats.has_page_count(".md")
        assert not formats.has_page_count(".zip")

    def test_family_for_mime_never_reports_comic(self):
        """.cb7/.cbt share MIMEs with plain archives, so MIME can't identify them."""
        assert formats.family_for_mime("application/x-7z-compressed") is None
        assert formats.family_for_mime("application/x-tar") is None
        assert formats.family_for_mime("application/epub+zip") == "fitz"
        assert formats.family_for_mime("text/plain") == "text"

    def test_is_comic_path_uses_extension(self):
        assert formats.is_comic_path("/lib/x.cbz")
        assert formats.is_comic_path("/lib/X.CBT")
        assert not formats.is_comic_path("/lib/x.7z")
        assert not formats.is_comic_path("/lib/x.pdf")

    def test_is_fitz_mime(self):
        assert formats.is_fitz_mime("application/pdf")
        assert formats.is_fitz_mime("application/epub+zip")
        assert not formats.is_fitz_mime("text/plain")

    def test_spec_for_path(self):
        assert formats.spec_for_path("/lib/book.epub").family == "fitz"
        assert formats.spec_for_path("/lib/notes.md").family == "text"
        assert formats.spec_for_path("/lib/thing.xyz") is None

    def test_is_reflowable(self):
        assert formats.is_reflowable(".epub")
        assert not formats.is_reflowable(".pdf")

    def test_doc_exts_includes_text_formats(self):
        from backend.indexer.constants import DOC_EXTS

        assert {".epub", ".djvu", ".txt", ".md", ".rtf"} <= DOC_EXTS


class TestReflowLayout:
    def test_epub_page_count_is_deterministic(self):
        """Two opens must agree, or FTS anchors drift from the reader (#373)."""
        tmp = tempfile.mkdtemp()
        path = Path(tmp) / "b.epub"
        _make_epub(path, body=" ".join(f"Sentence {i}." for i in range(400)))
        first = formats.open_document(str(path))
        second = formats.open_document(str(path))
        try:
            assert len(first) == len(second)
            assert len(first) > 0
        finally:
            first.close()
            second.close()

    def test_apply_reflow_layout_is_safe_on_non_reflowable(self):
        class _FixedDoc:
            is_reflowable = False

            def layout(self, **kwargs):  # pragma: no cover - must not be called
                raise AssertionError("layout() called on a fixed-layout document")

        formats.apply_reflow_layout(_FixedDoc())

    def test_apply_reflow_layout_uses_shared_box(self):
        seen = {}

        class _ReflowDoc:
            is_reflowable = True

            def layout(self, **kwargs):
                seen.update(kwargs)

        formats.apply_reflow_layout(_ReflowDoc())
        assert seen["width"] == formats.EPUB_LAYOUT_WIDTH
        assert seen["height"] == formats.EPUB_LAYOUT_HEIGHT
        assert seen["fontsize"] == formats.EPUB_LAYOUT_FONTSIZE


# ---------------------------------------------------------------------------
# text_documents: .txt / .md / .rtf  (issue #200)
# ---------------------------------------------------------------------------

class TestTextDocuments:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def _write(self, name: str, content, binary=False) -> str:
        path = os.path.join(self.tmp, name)
        mode = "wb" if binary else "w"
        with open(path, mode) as fh:
            fh.write(content)
        return path

    def test_reads_plain_text(self):
        p = self._write("a.txt", "Hello adventurer")
        assert text_documents.read_text_document(p) == "Hello adventurer"

    def test_reads_markdown_keeping_markers(self):
        p = self._write("a.md", "# Heading\n\nBody text")
        out = text_documents.read_text_document(p)
        assert "# Heading" in out

    def test_rtf_is_unwrapped_to_plain_text(self):
        p = self._write("a.rtf", r"{\rtf1\ansi \b Fighter\b0\par Strength 18\par}")
        out = text_documents.read_text_document(p)
        assert "Fighter" in out and "Strength 18" in out
        assert "\\rtf1" not in out

    def test_decodes_legacy_cp1252(self):
        """Forum-era files are rarely UTF-8 (issue #200)."""
        p = self._write("old.txt", "Café — naïve".encode("cp1252"), binary=True)
        out = text_documents.read_text_document(p)
        assert "Caf" in out and out is not None

    def test_decodes_utf8_bom(self):
        p = self._write("bom.txt", "Title".encode("utf-8-sig"), binary=True)
        assert text_documents.read_text_document(p) == "Title"

    def test_unknown_extension_returns_none(self):
        p = self._write("a.pdf", "x")
        assert text_documents.read_text_document(p) is None

    def test_missing_file_returns_none(self):
        assert text_documents.read_text_document(os.path.join(self.tmp, "nope.txt")) is None

    def test_oversized_file_is_skipped(self, monkeypatch):
        monkeypatch.setattr(text_documents, "_TEXT_FILE_SIZE_CAP", 10)
        p = self._write("big.txt", "x" * 100)
        assert text_documents.read_text_document(p) is None

    def test_malformed_rtf_returns_none(self, monkeypatch):
        def _boom(*a, **k):
            raise ValueError("bad rtf")

        import striprtf.striprtf as sr

        monkeypatch.setattr(sr, "rtf_to_text", _boom)
        p = self._write("bad.rtf", r"{\rtf1 broken")
        assert text_documents.read_text_document(p) is None

    def test_paginate_splits_at_paragraphs(self):
        text = "\n\n".join(f"Paragraph {i}" for i in range(100))
        pages = text_documents.paginate(text, page_chars=100)
        assert len(pages) > 1
        # No paragraph may be cut in half across a page boundary.
        assert all(p.strip() for p in pages)
        rejoined = "\n\n".join(pages)
        for i in range(100):
            assert f"Paragraph {i}" in rejoined

    def test_paginate_keeps_oversized_paragraph_whole(self):
        big = "x" * 500
        pages = text_documents.paginate(big, page_chars=100)
        assert pages == [big]

    def test_paginate_empty_text(self):
        assert text_documents.paginate("") == []
        assert text_documents.paginate("   \n  ") == []

    def test_extract_text_pages_numbers_from_one(self):
        p = self._write("a.md", "\n\n".join(f"Para {i}" for i in range(50)))
        pages = text_documents.extract_text_pages(p)
        assert [pg["page"] for pg in pages] == list(range(1, len(pages) + 1))

    def test_extract_text_pages_unreadable_returns_empty(self):
        assert text_documents.extract_text_pages(os.path.join(self.tmp, "x.txt")) == []

    def test_page_count_matches_pagination(self):
        p = self._write("a.txt", "\n\n".join(f"Para {i}" for i in range(50)))
        assert text_documents.text_page_count(p) == len(
            text_documents.extract_text_pages(p)
        )

    def test_page_count_of_unreadable_is_zero(self):
        assert text_documents.text_page_count(os.path.join(self.tmp, "x.txt")) == 0


# ---------------------------------------------------------------------------
# comics: CBZ/CBR/CB7/CBT paging  (issue #180)
# ---------------------------------------------------------------------------

class TestComicPaging:
    def setup_method(self):
        self.tmp = tempfile.mkdtemp()

    def _cbz(self, names=("page01.png", "page02.png", "page03.png"), extra=None) -> str:
        path = os.path.join(self.tmp, "c.cbz")
        with zipfile.ZipFile(path, "w") as z:
            for i, n in enumerate(names):
                z.writestr(n, _png_bytes((i * 40, 10, 10)))
            for n, data in (extra or {}).items():
                z.writestr(n, data)
        return path

    def test_lists_pages_in_order(self):
        path = self._cbz(names=("b.png", "a.png", "c.png"))
        assert comics.list_pages(path, ".cbz") == ["a.png", "b.png", "c.png"]

    def test_ignores_non_image_members(self):
        path = self._cbz(extra={"ComicInfo.xml": b"<x/>", "readme.txt": b"hi"})
        assert comics.list_pages(path, ".cbz") == ["page01.png", "page02.png", "page03.png"]

    def test_ignores_macos_resource_forks(self):
        """__MACOSX entries sort first and used to be picked as the cover."""
        path = self._cbz(extra={"__MACOSX/._page01.png": b"junk", ".hidden.png": b"junk"})
        assert comics.list_pages(path, ".cbz") == ["page01.png", "page02.png", "page03.png"]

    def test_page_count(self):
        assert comics.page_count(self._cbz(), ".cbz") == 3

    def test_reads_requested_page(self):
        path = self._cbz()
        result = comics.read_page(path, ".cbz", 2)
        assert result is not None
        data, mime = result
        assert mime == "image/png"
        assert Image.open(io.BytesIO(data)).size == (20, 30)

    def test_out_of_range_page_returns_none(self):
        path = self._cbz()
        assert comics.read_page(path, ".cbz", 0) is None
        assert comics.read_page(path, ".cbz", 99) is None

    def test_unreadable_archive_returns_empty(self):
        bad = os.path.join(self.tmp, "bad.cbz")
        Path(bad).write_bytes(b"not a zip")
        assert comics.list_pages(bad, ".cbz") == []
        assert comics.read_page(bad, ".cbz", 1) is None

    def test_oversized_member_is_refused(self, monkeypatch):
        monkeypatch.setattr(comics, "_COMIC_PAGE_SIZE_CAP", 1)
        assert comics.read_page(self._cbz(), ".cbz", 1) is None

    def test_size_cap_allows_archives_without_size_metadata(self):
        """An archive class exposing no size API must not be refused outright."""

        class _NoMetadata:
            pass

        assert comics._within_size_cap(_NoMetadata(), "a.png", "/x.cbz") is True

    def test_tar_comic_pages(self):
        path = os.path.join(self.tmp, "c.cbt")
        with tarfile.open(path, "w") as tf:
            for n in ("p2.png", "p1.png"):
                data = _png_bytes()
                info = tarfile.TarInfo(n)
                info.size = len(data)
                tf.addfile(info, io.BytesIO(data))
        assert comics.list_pages(path, ".cbt") == ["p1.png", "p2.png"]
        assert comics.read_page(path, ".cbt", 1) is not None

    def test_page_mime_by_extension(self):
        assert comics.page_mime("a.jpg") == "image/jpeg"
        assert comics.page_mime("a.jpeg") == "image/jpeg"
        assert comics.page_mime("a.webp") == "image/webp"
        assert comics.page_mime("a.unknown") == "application/octet-stream"

    def test_cover_skips_macos_noise(self):
        """Regression: the cover used to be the __MACOSX entry, failing the thumb."""
        path = self._cbz(extra={"__MACOSX/._page01.png": b"junk"})
        cover = _first_image_from_archive(path, ".cbz")
        assert cover is not None
        assert Image.open(io.BytesIO(cover)).size == (20, 30)

    def test_thumbnail_from_comic_with_macos_noise(self):
        path = self._cbz(extra={"__MACOSX/._page01.png": b"junk"})
        out = os.path.join(self.tmp, "t.webp")
        assert generate_thumbnail(path, out) is True
        assert os.path.exists(out)


# ---------------------------------------------------------------------------
# scan_library integration
# ---------------------------------------------------------------------------

def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    (lib / "books").mkdir(parents=True)
    return tmp, lib


class TestFormatScan:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()
        self.system_dir = self.lib / "books" / f"FmtSys_{os.path.basename(self.tmp)}"
        (self.system_dir / "Core").mkdir(parents=True)

    def _scan(self, index: bool = False):
        """Scan, and optionally run the indexing pass the router does after it.

        ``scan_library`` only registers rows; turning text into FTS entries is a
        separate phase (``Phase 2`` in the library router), so tests that assert
        on searchability have to drive it the same way.
        """
        db = SessionLocal()
        try:
            stats = scan_library(str(self.lib), self.tmp, db)
            if index:
                from backend.indexer.formats import INDEXABLE_MIMES

                pending = (
                    db.query(Book)
                    .filter(
                        Book.indexed.is_(False),
                        Book.index_failed.is_(False),
                        Book.mime_type.in_(INDEXABLE_MIMES),
                    )
                    .all()
                )
                for book in pending:
                    index_book_text(book, DATA_PATH, db)
            return stats
        finally:
            db.close()

    def _get_book(self, filename: str) -> Book | None:
        db = SessionLocal()
        try:
            return db.query(Book).filter(Book.filename == filename).first()
        finally:
            db.close()

    def _fts_rows(self, book_id: str) -> int:
        db = SessionLocal()
        try:
            return db.execute(
                sql_text("SELECT COUNT(*) FROM book_search WHERE book_id = :b"),
                {"b": book_id},
            ).scalar()
        finally:
            db.close()

    def test_epub_gets_correct_mime_not_image_epub(self):
        """Regression for issue #373: EPUBs were stored as 'image/epub'."""
        name = f"tome_{os.path.basename(self.tmp)}.epub"
        _make_epub(self.system_dir / "Core" / name)
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "application/epub+zip"

    def test_epub_gets_page_count_and_thumbnail(self):
        name = f"art_{os.path.basename(self.tmp)}.epub"
        _make_epub(self.system_dir / "Core" / name)
        self._scan()

        book = self._get_book(name)
        assert book.page_count > 0
        assert book.has_thumbnail is True

    def test_text_book_is_registered_and_indexed(self):
        name = f"homebrew_{os.path.basename(self.tmp)}.md"
        body = "\n\n".join(f"The lich king rules realm {i}." for i in range(60))
        (self.system_dir / "Core" / name).write_text(body)
        self._scan(index=True)

        book = self._get_book(name)
        assert book is not None
        assert book.mime_type == "text/markdown"
        assert book.page_count > 0
        assert book.indexed is True
        assert self._fts_rows(book.id) == book.page_count

    def test_rtf_book_is_searchable(self):
        name = f"sheet_{os.path.basename(self.tmp)}.rtf"
        (self.system_dir / "Core" / name).write_text(
            r"{\rtf1\ansi Barbarian rage rules\par}"
        )
        self._scan(index=True)

        book = self._get_book(name)
        assert book.mime_type == "application/rtf"
        assert book.indexed is True
        assert self._fts_rows(book.id) >= 1

    def test_empty_text_book_is_marked_indexed_not_retried(self):
        name = f"empty_{os.path.basename(self.tmp)}.txt"
        (self.system_dir / "Core" / name).write_text("   ")
        self._scan(index=True)

        book = self._get_book(name)
        assert book.indexed is True
        assert book.index_error == "no-text"

    def test_comic_gets_page_count_from_its_images(self):
        name = f"issue_{os.path.basename(self.tmp)}.cbz"
        with zipfile.ZipFile(self.system_dir / "Core" / name, "w") as z:
            for i in range(1, 6):
                z.writestr(f"p{i:02d}.png", _png_bytes())
        self._scan()

        book = self._get_book(name)
        assert book is not None
        assert book.page_count == 5
        assert book.has_thumbnail is True

    def test_text_page_count_matches_indexed_pages(self):
        """A search hit must never point past the end of the book."""
        name = f"long_{os.path.basename(self.tmp)}.txt"
        body = "\n\n".join(f"Paragraph number {i} of the tome." for i in range(300))
        (self.system_dir / "Core" / name).write_text(body)
        self._scan(index=True)

        book = self._get_book(name)
        assert self._fts_rows(book.id) == book.page_count
