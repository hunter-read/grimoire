"""A burst of cold renders must not stall the rest of the API (issue #701).

Two halves: a handler that waits on the render pool hands its database
connection back first (``release_connection``), and misses past
``RENDER_QUEUE_LIMIT`` are refused with a 503 rather than each holding a
request thread.
"""
import os
import tempfile
import threading
import time
import uuid
from concurrent.futures import ThreadPoolExecutor

import fitz  # type: ignore[import-untyped]
import pytest
from sqlalchemy import inspect

from backend import config
from backend.config import SessionLocal, release_connection
from backend.models import GameSystem
from backend.render import pool as render_pool
from backend.routers.books import _render_cache
from backend.routers.maps import core as maps_core
from backend.tests.conftest import make_book, make_game_system, make_map


@pytest.fixture(scope="module")
def tmpdir_mod():
    return tempfile.mkdtemp()


@pytest.fixture(autouse=True)
def no_valkey(monkeypatch):
    """Every render here is a miss: nothing is served from a shared cache."""
    monkeypatch.setattr(config, "_valkey", None)
    monkeypatch.setattr(_render_cache, "valkey_cache_set", lambda *_a: False)


def _pdf(tmp):
    path = os.path.join(tmp, f"burst-{uuid.uuid4().hex[:8]}.pdf")
    doc = fitz.open()
    doc.new_page(width=612, height=792).insert_text((72, 72), "Burst")
    doc.save(path)
    doc.close()
    return path


def _book(tmp):
    path = _pdf(tmp)
    system = make_game_system()
    return make_book(
        system_id=system.id,
        filename=os.path.basename(path),
        filepath=path,
        mime_type="application/pdf",
        page_count=1,
    )


class TestReleaseConnection:
    def test_ends_the_transaction_and_keeps_what_it_loaded(self):
        system = make_game_system()
        db = SessionLocal()
        try:
            row = db.get(GameSystem, system.id)
            assert db.in_transaction()
            release_connection(db)
            assert not db.in_transaction()
            # Still loaded: reading it needs no new query, so no new connection.
            assert not inspect(row).expired_attributes
            assert row.name == system.name
            assert not db.in_transaction()
            # And the session carries on as normal.
            assert db.get(GameSystem, system.id) is row
            assert db.expire_on_commit
        finally:
            db.close()

    def test_a_session_that_never_queried_is_left_alone(self):
        db = SessionLocal()
        try:
            release_connection(db)
            assert not db.in_transaction()
        finally:
            db.close()

    def test_refuses_to_commit_unsaved_changes(self):
        system = make_game_system()
        db = SessionLocal()
        try:
            db.get(GameSystem, system.id).name = f"Renamed {uuid.uuid4().hex[:6]}"
            with pytest.raises(RuntimeError):
                release_connection(db)
            assert db.in_transaction()
        finally:
            db.rollback()
            db.close()


class TestRendersReleaseTheSession:
    """Each route has given its connection back by the time it waits on a render."""

    def _spy(self, monkeypatch, sessions, name, result):
        seen = []

        def spy(*_args, **_kwargs):
            seen.append(sessions[-1].in_transaction())
            return result

        monkeypatch.setattr(render_pool, name, spy)
        return seen

    def test_page(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        book = _book(tmpdir_mod)
        seen = self._spy(monkeypatch, request_sessions, "render_page", b"webp")
        r = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert r.status_code == 200 and r.content == b"webp"
        assert seen == [False]

    def test_tile(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        book = _book(tmpdir_mod)
        seen = self._spy(monkeypatch, request_sessions, "render_tile", b"tile")
        r = client.get(
            f"/api/books/{book.id}/page/1/tile",
            params={"width": 2048, "col": 0, "row": 0},
            headers=admin_headers,
        )
        assert r.status_code == 200 and r.content == b"tile"
        assert seen == [False]

    def test_toc(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        book = _book(tmpdir_mod)
        seen = self._spy(monkeypatch, request_sessions, "document_toc", [[1, "One", 1]])
        r = client.get(f"/api/books/{book.id}/toc", headers=admin_headers)
        assert r.status_code == 200
        assert r.json()["toc"][0]["title"] == "One"
        assert seen == [False]

    def test_words(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        book = _book(tmpdir_mod)
        words = {"width": 1, "height": 1, "words": []}
        seen = self._spy(monkeypatch, request_sessions, "page_words", words)
        r = client.get(f"/api/books/{book.id}/page/1/words", headers=admin_headers)
        assert r.status_code == 200 and r.json() == words
        assert seen == [False]

    def test_text(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        book = _book(tmpdir_mod)
        seen = self._spy(monkeypatch, request_sessions, "page_text", "Burst")
        r = client.get(f"/api/books/{book.id}/page/1/text", headers=admin_headers)
        assert r.status_code == 200 and r.json() == {"text": "Burst"}
        assert seen == [False]

    def test_map_page(self, client, admin_headers, request_sessions, monkeypatch, tmpdir_mod):
        path = _pdf(tmpdir_mod)
        m = make_map(filename=os.path.basename(path), filepath=path)
        seen = []

        def spy(*_args):
            seen.append(request_sessions[-1].in_transaction())
            return b"map"

        monkeypatch.setattr(maps_core, "render_map_pdf_page", spy)
        r = client.get(f"/api/maps/{m.id}/page/1", headers=admin_headers)
        assert r.status_code == 200 and r.content == b"map"
        assert seen == [False]

    def test_a_vanished_file_is_still_flagged(self, client, admin_headers, tmpdir_mod):
        """Marking it missing happens after the release, on a new transaction."""
        book = _book(tmpdir_mod)
        os.remove(book.filepath)
        r = client.get(f"/api/books/{book.id}/page/1", headers=admin_headers)
        assert r.status_code == 404
        r = client.get(f"/api/books/{book.id}", headers=admin_headers)
        assert r.json()["is_missing"] is True


class TestBurst:
    """The issue's probe, scaled down: more cold renders at once than the limit."""

    LIMIT = 2
    BURST = 8

    def test_a_burst_is_capped_and_the_api_stays_responsive(
        self, client, admin_headers, monkeypatch, tmpdir_mod
    ):
        monkeypatch.setattr(config, "RENDER_QUEUE_LIMIT", self.LIMIT)
        book = _book(tmpdir_mod)
        started = threading.Semaphore(0)
        release = threading.Event()

        def slow_tile(*_args):
            started.release()
            assert release.wait(10)
            return b"tile"

        monkeypatch.setattr(render_pool, "render_tile", slow_tile)

        def tile(col):
            return client.get(
                f"/api/books/{book.id}/page/1/tile",
                params={"width": 2048, "col": col % 2, "row": col // 2},
                headers=admin_headers,
            )

        with ThreadPoolExecutor(self.BURST) as pool:
            futures = [pool.submit(tile, i) for i in range(self.BURST)]
            for _ in range(self.LIMIT):
                assert started.acquire(timeout=10)
            try:
                # The renders are stuck, yet the rest of the API answers at once.
                t0 = time.monotonic()
                assert client.get("/api/health").status_code == 200
                assert client.get("/api/books", headers=admin_headers).status_code == 200
                assert time.monotonic() - t0 < 5
            finally:
                release.set()
            responses = [f.result(timeout=20) for f in futures]

        statuses = sorted(r.status_code for r in responses)
        assert 200 in statuses and 503 in statuses
        assert set(statuses) == {200, 503}
        for r in responses:
            if r.status_code == 503:
                assert r.headers["retry-after"] == str(_render_cache.RETRY_AFTER)
                assert r.headers["cache-control"] == "no-store"
        assert _render_cache._admitted == 0
