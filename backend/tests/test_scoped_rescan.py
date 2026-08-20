"""Tests for scoped rescan + sidecar metadata refresh (issues #109, #106)."""
from __future__ import annotations

import tempfile
from pathlib import Path
from textwrap import dedent

import pytest

from backend.config import SessionLocal
from backend.indexer import (
    resolve_collection_dir,
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
# resolve_collection_dir / resolve_scope — case-insensitive top-level folders
# (issue #227)
# ---------------------------------------------------------------------------

class TestCaseInsensitiveTopLevel:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def test_resolves_capitalized_folder(self):
        (self.lib / "Books").mkdir()
        assert resolve_collection_dir(self.lib, "books") == self.lib / "Books"

    def test_resolves_mixed_case_folder(self):
        (self.lib / "AuDiO").mkdir()
        assert resolve_collection_dir(self.lib, "audio") == self.lib / "AuDiO"

    def test_falls_back_to_lowercase_when_absent(self):
        # No collection folder on disk → canonical lowercase path is returned.
        assert resolve_collection_dir(self.lib, "maps") == self.lib / "maps"

    def test_ignores_case_insensitive_file_match(self):
        # A same-named *file* must not be treated as the collection folder.
        (self.lib / "Tokens").write_bytes(b"not a dir")
        assert resolve_collection_dir(self.lib, "tokens") == self.lib / "tokens"

    def test_missing_library_root_falls_back(self):
        missing = self.lib / "does-not-exist"
        assert resolve_collection_dir(missing, "books") == missing / "books"

    def test_scope_resolves_capitalized_section(self):
        (self.lib / "Books").mkdir()
        section, target = resolve_scope(str(self.lib), "books/D&D 5e/adventure")
        assert section == "books"
        assert target == self.lib / "Books" / "D&D 5e" / "adventure"

    def test_scope_accepts_capitalized_scope_input(self):
        (self.lib / "Maps").mkdir()
        section, target = resolve_scope(str(self.lib), "Maps/Forests")
        assert section == "maps"
        assert target == self.lib / "Maps" / "Forests"

    def test_scan_indexes_capitalized_books_folder(self):
        folder = self.lib / "Books" / "SysCap" / "core"
        folder.mkdir(parents=True)
        (folder / "capitalized.pdf").write_bytes(b"%PDF-1.4")

        _scan(self.lib, self.tmp)

        book = _get_book("capitalized.pdf")
        assert book is not None
        # relative_path preserves the on-disk (capitalized) collection segment.
        assert book.relative_path.replace("\\", "/").startswith("Books/SysCap/")


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


# ---------------------------------------------------------------------------
# scan_library — sidecars for newly scanned books (issue #300)
# ---------------------------------------------------------------------------

class TestSidecarsOnScan:
    """A scan that adds files keeps an export-enabled library complete."""

    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def teardown_method(self):
        from backend.metadata import settings as export_settings
        from backend.models import AppSetting

        db = SessionLocal()
        try:
            for key in (
                export_settings.SETTING_EXPORT_FORMATS,
                export_settings.SETTING_EXPORT_COVERS,
                export_settings.SETTING_EXPORT_OVERWRITE,
            ):
                row = db.query(AppSetting).filter_by(key=key).first()
                if row:
                    db.delete(row)
            db.commit()
        finally:
            db.close()

    def _enable(self, formats):
        from backend.metadata import settings as export_settings

        db = SessionLocal()
        try:
            export_settings.set_enabled_formats(db, formats)
            db.commit()
        finally:
            db.close()

    def _add_book(self, name="newly-scanned.pdf"):
        folder = self.lib / "books" / "SidecarSys" / "core"
        folder.mkdir(parents=True, exist_ok=True)
        (folder / name).write_bytes(b"%PDF-1.4")
        return folder / name

    def test_a_new_book_gets_its_sidecars(self):
        self._enable(["json", "yaml"])
        book = self._add_book()

        _scan(self.lib, self.tmp)

        assert book.with_suffix(".grimoire.json").is_file()
        assert book.with_suffix(".grimoire.yaml").is_file()

    def test_nothing_is_written_while_export_is_off(self):
        """Off by default: a scan must not start writing into the library."""
        book = self._add_book("no-export.pdf")

        _scan(self.lib, self.tmp)

        assert not book.with_suffix(".grimoire.json").exists()
        assert not book.with_suffix(".opf").exists()

    def test_an_existing_sidecar_is_not_clobbered(self):
        """The folder may predate Grimoire; a file there is the user's."""
        self._enable(["opf"])
        book = self._add_book("has-own-opf.pdf")
        opf = book.with_suffix(".opf")
        opf.write_text("<package>the user's own</package>")

        _scan(self.lib, self.tmp)

        assert opf.read_text() == "<package>the user's own</package>"

    def test_a_rescan_finding_nothing_new_writes_nothing(self):
        """Only inserted books are considered, so a no-op scan stays a no-op."""
        self._enable(["json"])
        book = self._add_book("stable.pdf")
        _scan(self.lib, self.tmp)
        sidecar = book.with_suffix(".grimoire.json")
        sidecar.write_text("Grimoire metadata sidecar v1 -- hand edited\n")

        _scan(self.lib, self.tmp)

        assert "hand edited" in sidecar.read_text()
