"""Tests for sidecar export settings and the maintenance API (issue #300)."""
import json
import os

import pytest

from backend.config import SessionLocal
from backend.metadata import settings as export_settings
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
        session.commit()
        session.close()


class TestDefaults:
    def test_export_is_off_until_asked_for(self, db):
        """Writing into the library is a posture change, so it is opt-in."""
        assert export_settings.enabled_formats(db) == []
        assert export_settings.export_enabled(db) is False

    def test_covers_and_overwrite_default_off(self, db):
        assert export_settings.covers_enabled(db) is False
        assert export_settings.overwrite_foreign(db) is False


class TestFormatSelection:
    def test_round_trips_through_the_database(self, db):
        export_settings.set_enabled_formats(db, ["nfo", "opf"])
        db.commit()
        assert export_settings.enabled_formats(db) == ["opf", "nfo"]

    def test_order_is_stable_regardless_of_input_order(self, db):
        """A stable order keeps the settings UI from reshuffling itself."""
        export_settings.set_enabled_formats(db, ["json", "opf", "nfo"])
        db.commit()
        assert export_settings.enabled_formats(db) == ["opf", "nfo", "json"]

    def test_unknown_formats_are_rejected(self, db):
        with pytest.raises(ValueError, match="unknown sidecar format"):
            export_settings.set_enabled_formats(db, ["opf", "epub"])

    def test_case_and_whitespace_are_normalised(self, db):
        export_settings.set_enabled_formats(db, [" OPF ", "Nfo"])
        db.commit()
        assert export_settings.enabled_formats(db) == ["opf", "nfo"]

    def test_clearing_disables_export(self, db):
        export_settings.set_enabled_formats(db, ["opf"])
        db.commit()
        export_settings.set_enabled_formats(db, [])
        db.commit()
        assert export_settings.export_enabled(db) is False

    def test_a_malformed_stored_value_disables_rather_than_raises(self, db):
        """A corrupt setting must not break every export path that reads it."""
        db.add(AppSetting(key=export_settings.SETTING_EXPORT_FORMATS, value="{not json"))
        db.commit()
        assert export_settings.enabled_formats(db) == []

    def test_a_format_removed_upstream_is_ignored(self, db):
        db.add(
            AppSetting(
                key=export_settings.SETTING_EXPORT_FORMATS,
                value='["opf", "retired-format"]',
            )
        )
        db.commit()
        assert export_settings.enabled_formats(db) == ["opf"]


class TestToggles:
    def test_covers_round_trip(self, db):
        export_settings.set_covers_enabled(db, True)
        db.commit()
        assert export_settings.covers_enabled(db) is True

    def test_overwrite_foreign_round_trips(self, db):
        export_settings.set_overwrite_foreign(db, True)
        db.commit()
        assert export_settings.overwrite_foreign(db) is True


class TestSidecarAPI:
    def test_settings_default_to_disabled(self, client, admin_headers):
        resp = client.get("/api/maintenance/sidecars/settings", headers=admin_headers)
        assert resp.status_code == 200
        assert resp.json()["formats"] == []

    def test_settings_can_be_updated(self, client, admin_headers):
        resp = client.put(
            "/api/maintenance/sidecars/settings",
            headers=admin_headers,
            json={"formats": ["opf", "json"], "covers": True, "overwrite_foreign": False},
        )
        assert resp.status_code == 200
        assert resp.json()["formats"] == ["opf", "json"]
        assert resp.json()["covers"] is True

        client.put(
            "/api/maintenance/sidecars/settings",
            headers=admin_headers,
            json={"formats": [], "covers": False, "overwrite_foreign": False},
        )

    def test_an_unknown_format_is_a_400(self, client, admin_headers):
        resp = client.put(
            "/api/maintenance/sidecars/settings",
            headers=admin_headers,
            json={"formats": ["mobi"], "covers": False, "overwrite_foreign": False},
        )
        assert resp.status_code == 400
        assert "unknown sidecar format" in resp.json()["detail"]

    def test_export_refuses_while_disabled(self, client, admin_headers):
        """Nothing should touch the library until an admin has opted in."""
        resp = client.post("/api/maintenance/sidecars/export", headers=admin_headers)
        assert resp.status_code == 400
        assert "disabled" in resp.json()["detail"].lower()

    def test_settings_require_admin(self, client, gm_headers):
        assert client.get(
            "/api/maintenance/sidecars/settings", headers=gm_headers
        ).status_code == 403

    def test_export_requires_admin(self, client, gm_headers):
        assert client.post(
            "/api/maintenance/sidecars/export", headers=gm_headers
        ).status_code == 403

    def test_settings_require_authentication(self, client):
        assert client.get("/api/maintenance/sidecars/settings").status_code == 401


class TestBackfillEndpoint:
    """The maintenance action itself, driven through the API."""

    @pytest.fixture
    def enabled(self, client, admin_headers):
        client.put(
            "/api/maintenance/sidecars/settings",
            headers=admin_headers,
            json={"formats": ["json"], "covers": False, "overwrite_foreign": False},
        )
        yield
        client.put(
            "/api/maintenance/sidecars/settings",
            headers=admin_headers,
            json={"formats": [], "covers": False, "overwrite_foreign": False},
        )

    @pytest.fixture
    def book_on_disk(self, tmp_path):
        from backend.tests.conftest import make_book, make_game_system

        content = tmp_path / "backfill.pdf"
        content.write_bytes(b"%PDF-1.4 fake")
        book = make_book(
            system_id=make_game_system().id,
            title="Backfill Target",
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

    def test_backfill_writes_sidecars_and_reports_counts(
        self, client, admin_headers, enabled, book_on_disk
    ):
        resp = client.post("/api/maintenance/sidecars/export", headers=admin_headers)

        assert resp.status_code == 200
        body = resp.json()
        assert body["written"] >= 1
        assert body["read_only"] is False
        assert body["errors"] == []
        assert os.path.isfile(sidecar_path(book_on_disk.filepath, "json"))

    def test_a_foreign_file_is_reported_rather_than_replaced(
        self, client, admin_headers, enabled, book_on_disk
    ):
        path = sidecar_path(book_on_disk.filepath, "json")
        with open(path, "w") as fh:
            fh.write('{"hand": "written"}')

        body = client.post(
            "/api/maintenance/sidecars/export", headers=admin_headers
        ).json()

        assert body["skipped_foreign"] >= 1
        with open(path) as fh:
            assert json.load(fh) == {"hand": "written"}

    def test_a_read_only_library_is_reported_not_raised(
        self, client, admin_headers, enabled, book_on_disk, monkeypatch
    ):
        def _readonly(*a, **kw):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr("backend.metadata.export._atomic_write", _readonly)
        resp = client.post("/api/maintenance/sidecars/export", headers=admin_headers)

        assert resp.status_code == 200
        assert resp.json()["read_only"] is True
        assert any("read-only" in e.lower() for e in resp.json()["errors"])

    def test_backfill_is_blocked_during_a_scan(
        self, client, admin_headers, enabled, monkeypatch
    ):
        """A scan rewrites the rows being exported, so sidecars would be a moving target."""
        monkeypatch.setattr(
            "backend.routers.library._helpers._get_status", lambda: {"running": True}
        )
        resp = client.post("/api/maintenance/sidecars/export", headers=admin_headers)

        assert resp.status_code == 409
        assert "scan" in resp.json()["detail"].lower()
