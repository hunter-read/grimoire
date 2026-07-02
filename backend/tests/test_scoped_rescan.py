"""Tests for scoped rescan + sidecar metadata refresh (issues #109, #106)."""
from __future__ import annotations

import tempfile
from pathlib import Path
from textwrap import dedent

import pytest

from backend.config import SessionLocal
from backend.indexer import (
    resolve_scope,
    scan_library,
    _apply_opf_to_book,
)
from backend.models import Book


OPF = dedent("""\
    <?xml version='1.0' encoding='utf-8'?>
    <package xmlns="http://www.idpf.org/2007/opf" version="2.0">
        <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
            <dc:title>{title}</dc:title>
            <dc:creator opf:role="aut">{author}</dc:creator>
            <dc:publisher>{publisher}</dc:publisher>
            <dc:description>{desc}</dc:description>
        </metadata>
    </package>
""")


def _mk_lib():
    tmp = tempfile.mkdtemp(prefix="grimoire_scope_")
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _scan(lib, tmp, **kwargs):
    db = SessionLocal()
    try:
        return scan_library(str(lib), tmp, db, **kwargs)
    finally:
        db.close()


def _get_book(filename: str, system: str | None = None):
    db = SessionLocal()
    try:
        q = db.query(Book).filter(Book.filename == filename)
        if system:
            q = q.filter(Book.relative_path.like(f"books/{system}/%"))
        return q.first()
    finally:
        db.close()


# ---------------------------------------------------------------------------
# resolve_scope — validation / path-traversal guard
# ---------------------------------------------------------------------------

class TestResolveScope:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def test_resolves_valid_books_scope(self):
        section, target = resolve_scope(str(self.lib), "books/D&D 5e/adventure")
        assert section == "books"
        # Target is library-relative (symlinks not resolved, to match stored filepaths).
        assert target == self.lib / "books" / "D&D 5e" / "adventure"

    def test_resolves_maps_and_tokens(self):
        assert resolve_scope(str(self.lib), "maps/Forests")[0] == "maps"
        assert resolve_scope(str(self.lib), "tokens/Goblins")[0] == "tokens"

    def test_unknown_section_rejected(self):
        with pytest.raises(ValueError):
            resolve_scope(str(self.lib), "campaigns/secret")

    def test_empty_scope_rejected(self):
        with pytest.raises(ValueError):
            resolve_scope(str(self.lib), "")

    def test_parent_traversal_rejected(self):
        with pytest.raises(ValueError):
            resolve_scope(str(self.lib), "books/../../etc")

    def test_absolute_path_rejected(self):
        with pytest.raises(ValueError):
            resolve_scope(str(self.lib), "/etc/passwd")


# ---------------------------------------------------------------------------
# _apply_opf_to_book — non-destructive vs replace semantics
# ---------------------------------------------------------------------------

class TestApplyOpfToBook:
    def _book(self):
        return Book(
            title="Existing Title",
            filename="b.pdf",
            filepath="/x/b.pdf",
            relative_path="books/s/b.pdf",
        )

    def test_new_mode_is_noop(self):
        book = self._book()
        assert _apply_opf_to_book(book, {"title": "From OPF"}, "new") is False
        assert book.title == "Existing Title"

    def test_missing_fills_empty_only(self):
        book = self._book()
        book.publisher = ""          # empty → should fill
        book.title = "Existing Title"  # populated → protected
        changed = _apply_opf_to_book(
            book, {"title": "From OPF", "publisher": "Acme"}, "missing"
        )
        assert changed is True
        assert book.title == "Existing Title"  # protected
        assert book.publisher == "Acme"        # filled

    def test_missing_leaves_absent_fields_untouched(self):
        book = self._book()
        book.description = "keep me"
        _apply_opf_to_book(book, {"publisher": "Acme"}, "missing")
        assert book.description == "keep me"

    def test_replace_overwrites_populated(self):
        book = self._book()
        book.title = "Old"
        changed = _apply_opf_to_book(book, {"title": "New"}, "replace")
        assert changed is True
        assert book.title == "New"

    def test_replace_leaves_absent_fields_untouched(self):
        book = self._book()
        book.description = "keep me"
        _apply_opf_to_book(book, {"title": "New"}, "replace")
        assert book.description == "keep me"


# ---------------------------------------------------------------------------
# scan_library — scope isolation
# ---------------------------------------------------------------------------

class TestScopedScan:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def _book_folder(self, *parts) -> Path:
        d = self.lib / "books"
        for p in parts:
            d = d / p
        d.mkdir(parents=True, exist_ok=True)
        return d

    def test_scope_only_adds_files_in_subtree(self):
        in_scope = self._book_folder("ScopeSysA", "adventure")
        (in_scope / "scoped_only.pdf").write_bytes(b"%PDF-1.4")
        out_scope = self._book_folder("ScopeSysB", "core")
        (out_scope / "elsewhere.pdf").write_bytes(b"%PDF-1.4")

        _scan(self.lib, self.tmp, scope_path="books/ScopeSysA/adventure")

        assert _get_book("scoped_only.pdf") is not None
        # File outside the scope must NOT have been registered.
        assert _get_book("elsewhere.pdf") is None

    def test_scope_does_not_flag_sibling_as_missing(self):
        # First, a full scan registers both.
        a = self._book_folder("MissSysA", "core")
        (a / "a_book.pdf").write_bytes(b"%PDF-1.4")
        b = self._book_folder("MissSysB", "core")
        (b / "b_book.pdf").write_bytes(b"%PDF-1.4")
        _scan(self.lib, self.tmp)
        assert _get_book("a_book.pdf").is_missing is False
        assert _get_book("b_book.pdf").is_missing is False

        # Delete the out-of-scope file, then rescan only SysA.
        (b / "b_book.pdf").unlink()
        _scan(self.lib, self.tmp, scope_path="books/MissSysA")

        # SysB's record must be untouched (not flagged missing) by the scoped scan.
        assert _get_book("b_book.pdf").is_missing is False


# ---------------------------------------------------------------------------
# scan_library — metadata refresh on already-indexed books
# ---------------------------------------------------------------------------

class TestMetadataRefresh:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def _setup_book(self, system: str):
        folder = self.lib / "books" / system / "core" / "Book"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / "the_book.pdf").write_bytes(b"%PDF-1.4")
        return folder

    def _write_opf(self, folder, **fields):
        (folder / "metadata.opf").write_text(
            OPF.format(
                title=fields.get("title", "OPF Title"),
                author=fields.get("author", "OPF Author"),
                publisher=fields.get("publisher", "OPF Publisher"),
                desc=fields.get("desc", "OPF Description"),
            ),
            encoding="utf-8",
        )

    def _set_field(self, system, **fields):
        db = SessionLocal()
        try:
            book = db.query(Book).filter(Book.filename == "the_book.pdf").filter(
                Book.relative_path.like(f"books/{system}/%")
            ).first()
            for k, v in fields.items():
                setattr(book, k, v)
            db.commit()
        finally:
            db.close()

    def test_missing_fills_empty_but_protects_edited(self):
        folder = self._setup_book("RefreshMissing")
        _scan(self.lib, self.tmp)  # initial scan, no OPF
        # Simulate a user-edited publisher and an empty description.
        self._set_field("RefreshMissing", publisher="User Publisher", description="")

        self._write_opf(folder, publisher="OPF Publisher", desc="OPF Description")
        _scan(self.lib, self.tmp, scope_path="books/RefreshMissing", metadata_mode="missing")

        book = _get_book("the_book.pdf", system="RefreshMissing")
        assert book.publisher == "User Publisher"   # protected (non-null)
        assert book.description == "OPF Description"  # filled (was empty)

    def test_replace_overwrites_edited(self):
        folder = self._setup_book("RefreshReplace")
        _scan(self.lib, self.tmp)
        self._set_field("RefreshReplace", publisher="User Publisher")

        self._write_opf(folder, publisher="OPF Publisher")
        _scan(self.lib, self.tmp, scope_path="books/RefreshReplace", metadata_mode="replace")

        assert _get_book("the_book.pdf", system="RefreshReplace").publisher == "OPF Publisher"

    def test_new_mode_does_not_refresh(self):
        folder = self._setup_book("RefreshNew")
        _scan(self.lib, self.tmp)
        self._set_field("RefreshNew", publisher="User Publisher")

        self._write_opf(folder, publisher="OPF Publisher")
        _scan(self.lib, self.tmp, scope_path="books/RefreshNew", metadata_mode="new")

        assert _get_book("the_book.pdf", system="RefreshNew").publisher == "User Publisher"
