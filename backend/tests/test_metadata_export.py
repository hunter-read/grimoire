"""Tests for sidecar export to disk (issue #300).

The behaviour under test is mostly about restraint: what export declines to do
to a user's library. Foreign files stay untouched, a read-only mount reports
instead of raising, and a metadata edit never conjures a file into existence.
"""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.metadata import settings as export_settings
from backend.metadata.export import (
    ExportResult,
    export_book,
    export_library,
    refresh_existing,
    refresh_existing_safe,
)
from backend.metadata.formats import sidecar_path
from backend.models import AppSetting, Book


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        for key in (
            export_settings.SETTING_EXPORT_FORMATS,
            export_settings.SETTING_EXPORT_COVERS,
            export_settings.SETTING_EXPORT_OVERWRITE,
        ):
            row = session.query(AppSetting).filter_by(key=key).first()
            if row:
                session.delete(row)
        session.query(Book).filter(Book.id.like("sidecar-%")).delete(
            synchronize_session=False
        )
        session.commit()
        session.close()


def _make_book(db, tmp_path, book_id="sidecar-1", **overrides):
    """An indexed book whose content file actually exists on disk."""
    content = tmp_path / f"{book_id}.pdf"
    content.write_bytes(b"%PDF-1.4 fake")
    fields = {
        "id": book_id,
        "title": "Player's Handbook",
        "filename": content.name,
        "filepath": str(content),
        "relative_path": content.name,
        "description": "The core rules.",
        "authors": ["Jeremy Crawford"],
        "publisher": "Wizards of the Coast",
        "year": 2014,
        # Already indexed: these are stub bytes, not real PDFs, and an idle
        # indexer picking them up would fail extraction and roll back the
        # session out from under the test.
        "indexed": True,
        **overrides,
    }
    book = Book(**fields)
    db.add(book)
    db.commit()
    return book


class TestExportBook:
    def test_writes_the_enabled_formats_only(self, db, tmp_path):
        book = _make_book(db, tmp_path)

        result = export_book(db, book, ["opf", "json"])

        assert result.written == 2
        assert os.path.isfile(sidecar_path(book.filepath, "opf"))
        assert os.path.isfile(sidecar_path(book.filepath, "json"))
        assert not os.path.exists(sidecar_path(book.filepath, "nfo"))

    def test_no_formats_writes_nothing(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        assert export_book(db, book, []).written == 0
        assert not os.path.exists(sidecar_path(book.filepath, "opf"))

    def test_content_the_scan_has_not_found_is_skipped(self, db, tmp_path):
        """Writing beside a file that is gone would litter orphaned sidecars."""
        book = _make_book(db, tmp_path)
        os.unlink(book.filepath)

        result = export_book(db, book, ["opf"])

        assert result.skipped_missing == 1
        assert result.written == 0

    def test_exported_metadata_matches_the_database(self, db, tmp_path):
        book = _make_book(db, tmp_path, title="Xanathar's Guide", year=2017)

        export_book(db, book, ["json"])

        payload = json.loads(open(sidecar_path(book.filepath, "json")).read())
        assert payload["title"] == "Xanathar's Guide"
        assert payload["year"] == 2017
        assert payload["authors"] == ["Jeremy Crawford"]

    def test_rewrites_a_sidecar_it_wrote_before(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        export_book(db, book, ["json"])

        book.title = "Renamed"
        db.commit()
        result = export_book(db, book, ["json"])

        assert result.written == 1
        assert result.skipped_foreign == 0
        payload = json.loads(open(sidecar_path(book.filepath, "json")).read())
        assert payload["title"] == "Renamed"


class TestForeignFiles:
    """'Never destructive': a file Grimoire did not write is not Grimoire's."""

    def test_a_hand_written_sidecar_is_left_alone(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        path = sidecar_path(book.filepath, "opf")
        original = "<package><metadata>hand written</metadata></package>"
        open(path, "w").write(original)

        result = export_book(db, book, ["opf"])

        assert result.skipped_foreign == 1
        assert result.written == 0
        assert open(path).read() == original
        assert any("not written by Grimoire" in e for e in result.errors)

    def test_overwrite_foreign_takes_it_over(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        path = sidecar_path(book.filepath, "opf")
        open(path, "w").write("<package>hand written</package>")

        result = export_book(db, book, ["opf"], overwrite_foreign=True)

        assert result.written == 1
        assert "hand written" not in open(path).read()

    def test_an_unreadable_sidecar_counts_as_foreign(self, db, tmp_path, monkeypatch):
        """Unable to prove we wrote it is not grounds for overwriting it."""
        book = _make_book(db, tmp_path)
        path = sidecar_path(book.filepath, "opf")
        open(path, "w").write("whatever")

        def _boom(*a, **kw):
            raise OSError("permission denied")

        monkeypatch.setattr("builtins.open", _boom)
        result = export_book(db, book, ["opf"])

        assert result.skipped_foreign == 1
        assert result.written == 0


class TestRefreshExisting:
    """The on-write rule: update what exists, create nothing."""

    def test_creates_nothing_when_no_sidecar_exists(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        export_settings.set_enabled_formats(db, ["nfo"])
        db.commit()

        result = refresh_existing(db, book)

        assert result.written == 0
        assert not os.path.exists(sidecar_path(book.filepath, "nfo"))

    def test_updates_a_sidecar_that_already_exists(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        export_settings.set_enabled_formats(db, ["nfo"])
        db.commit()
        export_book(db, book, ["nfo"])  # the backfill creates it

        book.title = "Edited In The UI"
        db.commit()
        result = refresh_existing(db, book)

        assert result.written == 1
        assert "Edited In The UI" in open(sidecar_path(book.filepath, "nfo")).read()

    def test_only_refreshes_formats_that_are_enabled(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        export_book(db, book, ["opf", "nfo"])
        export_settings.set_enabled_formats(db, ["nfo"])
        db.commit()

        book.title = "Only NFO Should Change"
        db.commit()
        refresh_existing(db, book)

        assert "Only NFO Should Change" in open(sidecar_path(book.filepath, "nfo")).read()
        assert "Only NFO Should Change" not in open(sidecar_path(book.filepath, "opf")).read()

    def test_does_nothing_when_export_is_disabled(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        export_book(db, book, ["nfo"])

        book.title = "Should Not Propagate"
        db.commit()
        result = refresh_existing(db, book)

        assert result.written == 0
        assert "Should Not Propagate" not in open(sidecar_path(book.filepath, "nfo")).read()

    def test_safe_variant_swallows_failures(self, db, tmp_path, monkeypatch):
        """The edit is already committed; a sidecar problem must not 500 it."""
        book = _make_book(db, tmp_path)

        def _boom(*a, **kw):
            raise RuntimeError("disk on fire")

        monkeypatch.setattr("backend.metadata.export.refresh_existing", _boom)
        refresh_existing_safe(db, book)  # must not raise


class TestReadOnlyMount:
    def test_reports_instead_of_raising(self, db, tmp_path, monkeypatch):
        book = _make_book(db, tmp_path)

        def _readonly(*a, **kw):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr("backend.metadata.export._atomic_write", _readonly)
        result = export_book(db, book, ["opf"])

        assert result.read_only is True
        assert result.failed == 1
        assert any("read-only" in e.lower() for e in result.errors)

    def test_a_library_run_stops_at_the_first_read_only_failure(
        self, db, tmp_path, monkeypatch
    ):
        """One actionable error beats one identical error per book."""
        for i in range(3):
            _make_book(db, tmp_path, book_id=f"sidecar-{i}")

        def _readonly(*a, **kw):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr("backend.metadata.export._atomic_write", _readonly)
        result = export_library(db, ["opf"])

        assert result.read_only is True
        assert result.failed == 1
        assert len(result.errors) == 1


class TestExportLibrary:
    def test_writes_for_every_indexed_book(self, db, tmp_path):
        books = [_make_book(db, tmp_path, book_id=f"sidecar-{i}") for i in range(3)]

        result = export_library(db, ["json"])

        assert result.written >= 3
        for book in books:
            assert os.path.isfile(sidecar_path(book.filepath, "json"))

    def test_missing_books_are_not_exported(self, db, tmp_path):
        book = _make_book(db, tmp_path, is_missing=True)

        export_library(db, ["json"])

        assert not os.path.exists(sidecar_path(book.filepath, "json"))

    def test_disabled_export_is_a_no_op(self, db, tmp_path):
        book = _make_book(db, tmp_path)
        assert export_library(db).written == 0
        assert not os.path.exists(sidecar_path(book.filepath, "json"))

    def test_progress_is_reported_per_book(self, db, tmp_path):
        _make_book(db, tmp_path, book_id="sidecar-a")
        _make_book(db, tmp_path, book_id="sidecar-b")
        seen = []

        export_library(db, ["json"], progress=lambda done, total: seen.append((done, total)))

        assert seen and seen[-1][0] == seen[-1][1]


class TestAtomicWrite:
    def test_a_failed_write_leaves_no_temp_file_behind(self, db, tmp_path, monkeypatch):
        book = _make_book(db, tmp_path)

        def _boom(*a, **kw):
            raise OSError("no space left on device")

        monkeypatch.setattr("os.replace", _boom)
        export_book(db, book, ["json"])

        leftovers = [p for p in os.listdir(tmp_path) if p.startswith(".grimoire-")]
        assert leftovers == []


class TestExportResult:
    def test_merge_bounds_the_error_list(self):
        """A library-wide failure must not return megabytes of identical text."""
        total = ExportResult()
        for i in range(50):
            total.merge(ExportResult(failed=1, errors=[f"error {i}"]))

        assert total.failed == 50
        assert len(total.errors) == 20

    def test_merge_deduplicates(self):
        total = ExportResult()
        for _ in range(5):
            total.merge(ExportResult(failed=1, errors=["the same problem"]))

        assert total.errors == ["the same problem"]
