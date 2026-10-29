"""Tests for keeping a Grimoire Codex DB collection in step with the library.

With ``codex_sync_collection`` on, linking marks the record in the token owner's
collection and unlinking takes the mark back, unless another local record is
still linked to it. ``POST /api/codex/collection/sync`` replaces every mark
Grimoire made. Grimoire Codex DB is faked (``codex_fake``), so the tests check
exactly which calls are made, and that a failing one never fails the change.
"""
import uuid

import httpx
import pytest

from backend import codex
from backend.codex import collection as codex_collection
from backend.config import SessionLocal
from backend.models import Book, GameSystem
from backend.tests.codex_fake import _codex_id, _link, _set, fake_codex  # noqa: F401  (the "fake" fixture)
from backend.tests.conftest import make_book, make_game_system


def _id(prefix: str) -> str:
    """A record id no other test links, since the test database is shared."""
    return f"{prefix}_{uuid.uuid4().hex[:10]}"


def _calls(fake) -> list[tuple[str, str]]:
    """The collection calls made, as (method, path with the query)."""
    return [
        (r.method, r.url.raw_path.decode())
        for r in fake.requests
        if r.url.path.startswith("/api/v1/me/collection")
    ]


def _accept(fake, kind: str, codex_id: str) -> None:
    path = f"/api/v1/me/collection/{kind}/{codex_id}"
    fake.on("PUT", path, body={"owned": True})
    fake.on("DELETE", path, body={"owned": False})


class TestSetting:
    def test_off_by_default_and_saved_like_the_others(self, client, admin_headers, fake):
        assert client.get("/api/codex/settings", headers=admin_headers).json()["sync_collection"] is False
        r = client.put("/api/codex/settings", json={"sync_collection": True}, headers=admin_headers)
        assert r.json()["sync_collection"] is True

    def test_environment_pins_it(self, client, admin_headers, fake, monkeypatch):
        from backend import config

        monkeypatch.setitem(config.CODEX_DB_ENV, "codex_sync_collection", "true")
        body = client.get("/api/codex/settings", headers=admin_headers).json()
        assert body["sync_collection"] is True and "sync_collection" in body["locked"]
        r = client.put("/api/codex/settings", json={"sync_collection": False}, headers=admin_headers)
        assert r.status_code == 400
        assert "GRIMOIRE_CODEX_DB_SYNC_COLLECTION" in r.json()["detail"]


class TestLiveUpdates:
    def test_nothing_is_sent_while_the_setting_is_off(self, client, gm_headers, fake):
        book = make_book(make_game_system().id)
        r = client.patch(f"/api/books/{book.id}", json={"codex_id": _id("bk")}, headers=gm_headers)
        assert r.status_code == 200
        assert client.delete(f"/api/codex/books/{book.id}/link", headers=gm_headers).status_code == 200
        assert _calls(fake) == []

    def test_linking_marks_and_unlinking_unmarks(self, client, gm_headers, fake):
        _set(sync_collection=True)
        book = make_book(make_game_system().id)
        codex_id = _id("bk")
        _accept(fake, "books", codex_id)
        client.patch(f"/api/books/{book.id}", json={"codex_id": codex_id}, headers=gm_headers)
        assert _calls(fake) == [("PUT", f"/api/v1/me/collection/books/{codex_id}")]
        assert fake.body(f"/api/v1/me/collection/books/{codex_id}") == {"source": "grimoire"}

        # Saving the same link again is not a change.
        client.patch(f"/api/books/{book.id}", json={"codex_id": codex_id}, headers=gm_headers)
        assert len(_calls(fake)) == 1

        assert client.delete(f"/api/codex/books/{book.id}/link", headers=gm_headers).status_code == 200
        assert _calls(fake)[-1] == ("DELETE", f"/api/v1/me/collection/books/{codex_id}?source=grimoire")

    def test_relinking_moves_the_mark(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        old, new = _id("sy"), _id("sy")
        _link(GameSystem, system.id, old)
        _accept(fake, "systems", old)
        _accept(fake, "systems", new)
        r = client.patch(f"/api/systems/{system.id}", json={"codex_id": new}, headers=gm_headers)
        assert r.status_code == 200
        assert _calls(fake) == [
            ("PUT", f"/api/v1/me/collection/systems/{new}"),
            ("DELETE", f"/api/v1/me/collection/systems/{old}?source=grimoire"),
        ]

    def test_a_record_another_book_still_holds_stays_marked(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        first, second = make_book(system.id), make_book(system.id)
        codex_id = _id("bk")
        _link(Book, first.id, codex_id)
        _link(Book, second.id, codex_id)
        assert client.delete(f"/api/codex/books/{first.id}/link", headers=gm_headers).status_code == 200
        assert _calls(fake) == []

    def test_a_missing_book_does_not_hold_the_mark(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        here, gone = make_book(system.id), make_book(system.id, is_missing=True)
        codex_id = _id("bk")
        _accept(fake, "books", codex_id)
        _link(Book, here.id, codex_id)
        _link(Book, gone.id, codex_id)
        client.delete(f"/api/codex/books/{here.id}/link", headers=gm_headers)
        assert _calls(fake) == [("DELETE", f"/api/v1/me/collection/books/{codex_id}?source=grimoire")]

    def test_unlinking_a_system_unmarks_it(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        codex_id = _id("sy")
        _accept(fake, "systems", codex_id)
        _link(GameSystem, system.id, codex_id)
        assert client.delete(f"/api/codex/systems/{system.id}/link", headers=gm_headers).status_code == 200
        assert _calls(fake) == [("DELETE", f"/api/v1/me/collection/systems/{codex_id}?source=grimoire")]

    def test_bulk_edits_mark_each_new_link(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        books = [make_book(system.id), make_book(system.id), make_book(system.id)]
        ids = [_id("bk"), _id("bk")]
        for codex_id in ids:
            _accept(fake, "books", codex_id)
        r = client.post(
            "/api/books/bulk",
            json={
                "items": [
                    {"id": books[0].id, "codex_id": ids[0]},
                    {"id": books[1].id, "codex_id": ids[1]},
                    {"id": books[2].id, "product_code": "X1"},
                ]
            },
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert sorted(_calls(fake)) == sorted(("PUT", f"/api/v1/me/collection/books/{i}") for i in ids)

        other = make_game_system()
        codex_id = _id("sy")
        _accept(fake, "systems", codex_id)
        r = client.post(
            "/api/systems/bulk", json={"items": [{"id": other.id, "codex_id": codex_id}]}, headers=gm_headers
        )
        assert r.status_code == 200
        assert _calls(fake)[-1] == ("PUT", f"/api/v1/me/collection/systems/{codex_id}")

    def test_sending_a_record_marks_it_once_linked(self, client, gm_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        book = make_book(system.id)
        book_id, system_id = _id("bk"), _id("sy")
        _accept(fake, "books", book_id)
        _accept(fake, "systems", system_id)
        fake.on(
            "POST",
            "/api/v1/grimoire/books",
            body={"codex_id": book_id, "edit": {"id": "ed_9", "status": "applied"}},
        )
        r = client.post(
            f"/api/codex/books/{book.id}/submit",
            json={"system": {"codex_id": system_id}},
            headers=gm_headers,
        )
        assert r.json()["linked"] is True
        assert sorted(_calls(fake)) == sorted(
            [
                ("PUT", f"/api/v1/me/collection/books/{book_id}"),
                ("PUT", f"/api/v1/me/collection/systems/{system_id}"),
            ]
        )

    def test_a_failed_call_never_fails_the_change(self, client, gm_headers, fake):
        _set(sync_collection=True)
        book = make_book(make_game_system().id)
        codex_id = _id("bk")
        fake.on("PUT", f"/api/v1/me/collection/books/{codex_id}", status=500, body={"error": "boom"})
        r = client.patch(f"/api/books/{book.id}", json={"codex_id": codex_id}, headers=gm_headers)
        assert r.status_code == 200
        assert _codex_id(Book, book.id) == codex_id

    def test_an_unreachable_server_stops_the_rest(self, fake, monkeypatch):
        _set(sync_collection=True)
        made = []

        def unreachable(_settings, _kind, codex_id):
            made.append(codex_id)
            raise codex.CodexError("Could not reach Grimoire Codex DB")

        monkeypatch.setattr(codex_collection.client, "collection_mark", unreachable)
        db = SessionLocal()
        try:
            system = make_game_system()
            books = [make_book(system.id), make_book(system.id)]
            before = codex_collection.links_before(db, "book", [b.id for b in books])
            for b in books:
                db.get(Book, b.id).codex_id = _id("bk")
            db.commit()
            codex_collection.push_link_changes(db, "book", before)
        finally:
            db.close()
        assert len(made) == 1


class TestSync:
    def test_sends_every_linked_record_but_missing_books(self, client, admin_headers, fake):
        _set(sync_collection=True)
        system = make_game_system()
        system_id, here, gone = _id("sy"), _id("bk"), _id("bk")
        _link(GameSystem, system.id, system_id)
        _link(Book, make_book(system.id).id, here)
        _link(Book, make_book(system.id, is_missing=True).id, gone)
        fake.on(
            "POST",
            "/api/v1/me/collection/sync",
            body={"books": 7, "systems": 2, "unknown": {"books": [here], "systems": []}},
        )
        r = client.post("/api/codex/collection/sync", headers=admin_headers)
        assert r.status_code == 200
        body = r.json()
        sent = fake.body("/api/v1/me/collection/sync")
        assert sent["source"] == "grimoire"
        assert here in sent["books"] and gone not in sent["books"]
        assert system_id in sent["systems"]
        assert body["sent"] == {"books": len(sent["books"]), "systems": len(sent["systems"])}
        assert body["books"] == 7 and body["systems"] == 2
        assert body["unknown"] == {"books": [here], "systems": []}

    def test_refused_while_the_setting_is_off(self, client, admin_headers, fake):
        r = client.post("/api/codex/collection/sync", headers=admin_headers)
        assert r.status_code == 400
        assert "Collection sync is off" in r.json()["detail"]
        assert _calls(fake) == []

    def test_admin_only(self, client, gm_headers, fake):
        _set(sync_collection=True)
        assert client.post("/api/codex/collection/sync", headers=gm_headers).status_code == 403

    def test_a_codex_failure_reaches_the_user(self, client, admin_headers, fake):
        _set(sync_collection=True)
        fake.routes[("POST", "/api/v1/me/collection/sync")] = lambda _req: httpx.Response(
            422, json={"error": "Too many records"}
        )
        r = client.post("/api/codex/collection/sync", headers=admin_headers)
        assert r.status_code == 422 and r.json()["detail"] == "Too many records"

    def test_an_odd_answer_reads_as_nothing_marked(self, client, admin_headers, fake):
        _set(sync_collection=True)
        fake.on("POST", "/api/v1/me/collection/sync", body={})
        body = client.post("/api/codex/collection/sync", headers=admin_headers).json()
        assert body["books"] == 0 and body["unknown"] == {"books": [], "systems": []}

    @pytest.mark.parametrize("reply", [[], None, "ok"])
    def test_a_reply_that_is_not_an_object_is_a_502(self, client, admin_headers, fake, reply):
        _set(sync_collection=True)
        fake.on("POST", "/api/v1/me/collection/sync", body=reply)
        assert client.post("/api/codex/collection/sync", headers=admin_headers).status_code == 502

    def test_counts_that_are_not_numbers_read_as_none(self, client, admin_headers, fake):
        _set(sync_collection=True)
        fake.on(
            "POST",
            "/api/v1/me/collection/sync",
            body={"books": "abc", "systems": "3", "unknown": {"books": "bk_1", "systems": ["sy_1"]}},
        )
        r = client.post("/api/codex/collection/sync", headers=admin_headers)
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["books"] == 0 and body["systems"] == 3
        assert body["unknown"] == {"books": [], "systems": ["sy_1"]}
