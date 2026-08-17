"""Sidecar refresh through the book endpoints (issue #300).

The rule these pin down: editing metadata **updates** the sidecars a book
already has and **creates** none. A user who never runs the backfill never
finds new files in their library, while a book that does have a ``.nfo`` cannot
silently drift from the database.
"""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.metadata import settings as export_settings
from backend.metadata.export import export_book
from backend.metadata.formats import sidecar_path
from backend.models import AppSetting, Book
from backend.tests.conftest import make_book, make_game_system


@pytest.fixture
def system():
    return make_game_system()


@pytest.fixture
def book_on_disk(tmp_path, system):
    """A book whose content file exists, so sidecars can be written beside it."""
    content = tmp_path / "handbook.pdf"
    content.write_bytes(b"%PDF-1.4 fake")
    book = make_book(
        system_id=system.id,
        title="Original Title",
        filepath=str(content),
        filename=content.name,
        relative_path=content.name,
        indexed=True,
    )
    yield book
    db = SessionLocal()
    db.query(Book).filter_by(id=book.id).delete()
    db.commit()
    db.close()


@pytest.fixture
def sidecars_enabled():
    """Turn on JSON export for the duration of a test, then clear it."""
    db = SessionLocal()
    export_settings.set_enabled_formats(db, ["json"])
    db.commit()
    db.close()
    yield
    db = SessionLocal()
    for key in (
        export_settings.SETTING_EXPORT_FORMATS,
        export_settings.SETTING_EXPORT_COVERS,
        export_settings.SETTING_EXPORT_OVERWRITE,
    ):
        row = db.query(AppSetting).filter_by(key=key).first()
        if row:
            db.delete(row)
    db.commit()
    db.close()


def _seed_sidecar(book):
    """Create the sidecar a backfill would have written."""
    db = SessionLocal()
    row = db.query(Book).filter_by(id=book.id).first()
    export_book(db, row, ["json"])
    db.close()


def _sidecar_title(book):
    with open(sidecar_path(book.filepath, "json")) as fh:
        return json.load(fh)["title"]


class TestSingleUpdate:
    def test_an_existing_sidecar_follows_the_edit(
        self, client, admin_headers, book_on_disk, sidecars_enabled
    ):
        _seed_sidecar(book_on_disk)

        resp = client.patch(
            f"/api/books/{book_on_disk.id}",
            headers=admin_headers,
            json={"title": "Edited Through The API"},
        )

        assert resp.status_code == 200
        assert _sidecar_title(book_on_disk) == "Edited Through The API"

    def test_no_sidecar_is_created_by_an_edit(
        self, client, admin_headers, book_on_disk, sidecars_enabled
    ):
        """Files appear from the backfill, never as a side effect of editing."""
        client.patch(
            f"/api/books/{book_on_disk.id}",
            headers=admin_headers,
            json={"title": "Edited"},
        )

        assert not os.path.exists(sidecar_path(book_on_disk.filepath, "json"))

    def test_nothing_happens_while_export_is_disabled(
        self, client, admin_headers, book_on_disk
    ):
        _seed_sidecar(book_on_disk)

        client.patch(
            f"/api/books/{book_on_disk.id}",
            headers=admin_headers,
            json={"title": "Should Not Propagate"},
        )

        assert _sidecar_title(book_on_disk) == "Original Title"

    def test_the_edit_still_succeeds_when_the_sidecar_cannot_be_written(
        self, client, admin_headers, book_on_disk, sidecars_enabled, monkeypatch
    ):
        """A read-only mount must not turn a good metadata save into a 500."""
        _seed_sidecar(book_on_disk)

        def _readonly(*a, **kw):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr("backend.metadata.export._atomic_write", _readonly)
        resp = client.patch(
            f"/api/books/{book_on_disk.id}",
            headers=admin_headers,
            json={"title": "Saved Anyway"},
        )

        assert resp.status_code == 200
        db = SessionLocal()
        assert db.query(Book).filter_by(id=book_on_disk.id).first().title == "Saved Anyway"
        db.close()


class TestBulkUpdate:
    def test_bulk_edits_refresh_sidecars_too(
        self, client, admin_headers, book_on_disk, sidecars_enabled
    ):
        _seed_sidecar(book_on_disk)

        resp = client.post(
            "/api/books/bulk",
            headers=admin_headers,
            json={"items": [{"id": book_on_disk.id, "publisher": "Bulk Publisher"}]},
        )

        assert resp.status_code == 200
        with open(sidecar_path(book_on_disk.filepath, "json")) as fh:
            assert json.load(fh)["publisher"] == "Bulk Publisher"

    def test_bulk_tagging_refreshes_sidecars(
        self, client, admin_headers, book_on_disk, sidecars_enabled
    ):
        """Tags live in their own tables, so they need the same hook."""
        _seed_sidecar(book_on_disk)

        resp = client.post(
            "/api/books/bulk/tags",
            headers=admin_headers,
            json={"ids": [book_on_disk.id], "tags": ["playtest"]},
        )

        assert resp.status_code == 200
        with open(sidecar_path(book_on_disk.filepath, "json")) as fh:
            assert "playtest" in json.load(fh)["tags"]
