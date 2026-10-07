"""Tests for ``added_at`` - surfacing recently added library items (issue #199).

Covers the API shapes that carry it (books and every media type), the ``/books``
date-added sort and ``added_since`` filter an external notifier polls, the UTC
serialization helper, and the 0040 migration's backfill from ``created_at``.
"""
import datetime

import pytest
from sqlalchemy import create_engine, text

from backend.config import SessionLocal
from backend.models import Book
from backend.models.base import utc_iso
from backend.models.db import init_db
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_model3d,
    make_token,
)
from backend.tests.test_db_migrations import _alembic_head, _fresh_db, _stamped_revision

_UTC = datetime.timezone.utc


def _naive(*args):
    return datetime.datetime(*args)


@pytest.fixture(scope="module")
def dated():
    """A system holding three dated books and one that predates tracking."""
    system = make_game_system()
    books = {
        "old": make_book(system.id, title="Old", added_at=_naive(2024, 1, 1)),
        "mid": make_book(system.id, title="Mid", added_at=_naive(2025, 6, 1)),
        "new": make_book(system.id, title="New", added_at=_naive(2026, 10, 1, 12)),
    }
    # A legacy row: the column default would fill it on insert, so clear it after.
    legacy = make_book(system.id, title="Legacy")
    db = SessionLocal()
    try:
        db.query(Book).filter_by(id=legacy.id).update({"added_at": None})
        db.commit()
    finally:
        db.close()
    books["legacy"] = legacy
    return system, books


def _titles(client, headers, **params):
    resp = client.get("/api/books", headers=headers, params=params)
    assert resp.status_code == 200, resp.text
    return [b["title"] for b in resp.json()["books"]]


class TestUtcIso:
    def test_none_stays_none(self):
        assert utc_iso(None) is None

    def test_naive_value_is_tagged_utc(self):
        assert utc_iso(_naive(2026, 10, 1, 12)) == "2026-10-01T12:00:00+00:00"

    def test_aware_value_keeps_its_offset(self):
        tz = datetime.timezone(datetime.timedelta(hours=2))
        value = datetime.datetime(2026, 10, 1, 14, tzinfo=tz)
        assert utc_iso(value) == "2026-10-01T14:00:00+02:00"


class TestNewBookIsStamped:
    def test_insert_sets_added_at(self):
        system = make_game_system()
        before = datetime.datetime.now(_UTC).replace(tzinfo=None)
        book = make_book(system.id)
        assert book.added_at is not None
        assert book.added_at.replace(tzinfo=None) >= before - datetime.timedelta(seconds=1)


class TestAddedAtInResponses:
    def test_list_rows_carry_utc_added_at(self, client, admin_headers, dated):
        system, books = dated
        resp = client.get("/api/books", headers=admin_headers, params={"system_id": system.id})
        rows = {b["id"]: b for b in resp.json()["books"]}
        parsed = datetime.datetime.fromisoformat(rows[books["new"].id]["added_at"])
        assert parsed == datetime.datetime(2026, 10, 1, 12, tzinfo=_UTC)
        assert rows[books["legacy"].id]["added_at"] is None

    def test_book_detail_carries_added_at(self, client, admin_headers, dated):
        _, books = dated
        resp = client.get(f"/api/books/{books['mid'].id}", headers=admin_headers)
        assert resp.status_code == 200
        parsed = datetime.datetime.fromisoformat(resp.json()["added_at"])
        assert parsed == datetime.datetime(2025, 6, 1, tzinfo=_UTC)

    def test_system_detail_books_carry_added_at(self, client, admin_headers, dated):
        system, books = dated
        resp = client.get(f"/api/systems/{system.id}", headers=admin_headers)
        assert resp.status_code == 200
        rows = {b["id"]: b for b in resp.json()["books"]}
        assert rows[books["old"].id]["added_at"].startswith("2024-01-01T00:00:00")
        assert rows[books["legacy"].id]["added_at"] is None


class TestListSortAndFilter:
    def test_default_sort_is_still_title(self, client, admin_headers, dated):
        system, _ = dated
        assert _titles(client, admin_headers, system_id=system.id) == [
            "Legacy",
            "Mid",
            "New",
            "Old",
        ]

    def test_title_sort_can_descend(self, client, admin_headers, dated):
        system, _ = dated
        titles = _titles(client, admin_headers, system_id=system.id, order="desc")
        assert titles == ["Old", "New", "Mid", "Legacy"]

    def test_added_at_sort_is_newest_first_with_undated_last(self, client, admin_headers, dated):
        system, _ = dated
        titles = _titles(client, admin_headers, system_id=system.id, sort="added_at")
        assert titles == ["New", "Mid", "Old", "Legacy"]

    def test_ascending_added_at_still_puts_undated_last(self, client, admin_headers, dated):
        system, _ = dated
        titles = _titles(client, admin_headers, system_id=system.id, sort="added_at", order="asc")
        assert titles == ["Old", "Mid", "New", "Legacy"]

    def test_added_since_keeps_only_newer_books(self, client, admin_headers, dated):
        system, _ = dated
        resp = client.get(
            "/api/books",
            headers=admin_headers,
            params={"system_id": system.id, "sort": "added_at", "added_since": "2025-01-01T00:00:00"},
        )
        body = resp.json()
        assert [b["title"] for b in body["books"]] == ["New", "Mid"]
        # The count reflects the filter, so a poller can page through it.
        assert body["total"] == 2

    def test_added_since_honours_an_offset(self, client, admin_headers, dated):
        system, _ = dated
        # 14:00+02:00 is 12:00 UTC - exactly when "New" was added, so it matches.
        titles = _titles(
            client,
            admin_headers,
            system_id=system.id,
            added_since="2026-10-01T14:00:00+02:00",
        )
        assert titles == ["New"]
        # One second later it no longer does.
        titles = _titles(
            client,
            admin_headers,
            system_id=system.id,
            added_since="2026-10-01T14:00:01+02:00",
        )
        assert titles == []

    def test_unknown_sort_is_rejected(self, client, admin_headers):
        resp = client.get("/api/books", headers=admin_headers, params={"sort": "size"})
        assert resp.status_code == 422


class TestMediaCarriesAddedAt:
    """Maps, tokens, audio and 3D models expose ``added_at`` for the badge."""

    _WHEN = _naive(2026, 9, 30, 8)
    _EXPECTED = datetime.datetime(2026, 9, 30, 8, tzinfo=_UTC)

    @pytest.mark.parametrize(
        "factory, path, key",
        [
            (make_map, "/api/maps", "maps"),
            (make_token, "/api/tokens", "tokens"),
            (make_audio, "/api/audio", "audio"),
            (make_model3d, "/api/models", "models"),
        ],
    )
    def test_list_rows_carry_added_at(self, client, admin_headers, factory, path, key):
        item = factory(added_at=self._WHEN)
        resp = client.get(path, headers=admin_headers)
        assert resp.status_code == 200, resp.text
        row = next(r for r in resp.json()[key] if r["id"] == item.id)
        assert datetime.datetime.fromisoformat(row["added_at"]) == self._EXPECTED

    @pytest.mark.parametrize(
        "factory, path",
        [(make_token, "/api/tokens"), (make_audio, "/api/audio"), (make_model3d, "/api/models")],
    )
    def test_detail_carries_added_at(self, client, admin_headers, factory, path):
        item = factory(added_at=self._WHEN)
        resp = client.get(f"{path}/{item.id}", headers=admin_headers)
        assert resp.status_code == 200, resp.text
        assert datetime.datetime.fromisoformat(resp.json()["added_at"]) == self._EXPECTED


class TestAddedAtMigration:
    """0040 adds ``added_at`` to every item table, backfilled from ``created_at``."""

    _BEFORE = "34e9f14ea065"
    _TABLES = ("books", "generic_maps", "tokens", "audio", "models_3d")

    def _db_before_added_at(self):
        """A current DB rewound to just before 0040, holding a dated and an
        undated row in books and in maps."""
        path = _fresh_db()
        engine = create_engine(f"sqlite:///{path}")
        with engine.begin() as conn:
            for table in self._TABLES:
                conn.execute(text(f"DROP INDEX ix_{table}_added_at"))
                conn.execute(text(f"ALTER TABLE {table} DROP COLUMN added_at"))
            for rid, created in (("dated", "2025-03-04 05:06:07.000000"), ("undated", None)):
                params = {
                    "id": rid,
                    "f": f"{rid}.pdf",
                    "p": f"/lib/{rid}.pdf",
                    "r": f"{rid}.pdf",
                    "c": created,
                }
                conn.execute(
                    text(
                        "INSERT INTO books (id, title, filename, filepath, relative_path, "
                        "created_at) VALUES (:id, :id, :f, :p, :r, :c)"
                    ),
                    params,
                )
                conn.execute(
                    text(
                        "INSERT INTO generic_maps (id, filename, filepath, relative_path, "
                        "created_at) VALUES (:id, :f, :p, :r, :c)"
                    ),
                    params,
                )
            conn.execute(
                text("UPDATE alembic_version SET version_num = :v"), {"v": self._BEFORE}
            )
        engine.dispose()
        return path

    def _added(self, path, table):
        engine = create_engine(f"sqlite:///{path}")
        try:
            with engine.connect() as conn:
                rows = conn.execute(text(f"SELECT id, added_at FROM {table}")).fetchall()
                indexes = conn.execute(text(f"PRAGMA index_list('{table}')")).fetchall()
            return dict(rows), {row[1] for row in indexes}
        finally:
            engine.dispose()

    def test_backfills_from_created_at_and_leaves_unknowns_null(self):
        path = self._db_before_added_at()
        init_db(path)

        for table in ("books", "generic_maps"):
            added, _ = self._added(path, table)
            assert added["dated"] == "2025-03-04 05:06:07.000000"
            assert added["undated"] is None
        for table in self._TABLES:
            _, indexes = self._added(path, table)
            assert f"ix_{table}_added_at" in indexes
        assert _stamped_revision(path) == _alembic_head(path)

    def test_upgrade_then_downgrade(self):
        from alembic import command

        from backend.models.db import _alembic_config

        path = self._db_before_added_at()
        init_db(path)
        engine = create_engine(f"sqlite:///{path}")
        try:
            with engine.begin() as conn:
                command.downgrade(_alembic_config(conn), self._BEFORE)
            with engine.connect() as conn:
                for table in self._TABLES:
                    columns = {
                        row[1] for row in conn.execute(text(f"PRAGMA table_info('{table}')"))
                    }
                    assert "added_at" not in columns
        finally:
            engine.dispose()
