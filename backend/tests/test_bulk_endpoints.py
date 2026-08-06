"""Tests for the bulk update/tag endpoints (issue #270).

Applying a selection used to be one PATCH per item from the browser, which raced
on the unique ``tags.internal`` constraint and returned intermittent 500s. These
cover the single-request replacements and the race-safety fix underneath them.
"""
import threading

from backend.config import SessionLocal
from backend.models import Tag, TokenFolder
from backend.services import tag_service
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_game_system,
    make_map,
    make_token,
)


def _tags_of(resource_type, resource_id):
    db = SessionLocal()
    try:
        return tag_service.display_tags_for_resource(db, resource_type, resource_id)
    finally:
        db.close()


class TestBulkAddTags:
    """The bulk action bar's tag input — the exact flow reported in #270."""

    def test_applies_a_new_tag_to_every_token(self, client, admin_headers):
        tokens = [make_token() for _ in range(5)]
        resp = client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id for t in tokens], "tags": ["Goblin"]},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        body = resp.json()
        assert set(body["updated"]) == {t.id for t in tokens}
        assert body["errors"] == []
        for t in tokens:
            assert "Goblin" in _tags_of("token", t.id)

    def test_is_additive(self, client, admin_headers):
        t = make_token(tags=["existing"])
        client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id], "tags": ["added"]},
            headers=admin_headers,
        )
        assert set(_tags_of("token", t.id)) == {"existing", "added"}

    def test_returns_tags_per_id_for_local_state(self, client, admin_headers):
        t = make_token(tags=["old"])
        body = client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id], "tags": ["new"]},
            headers=admin_headers,
        ).json()
        assert set(body["tags"][t.id]) == {"old", "new"}

    def test_unknown_id_is_reported_not_fatal(self, client, admin_headers):
        t = make_token()
        body = client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id, "does-not-exist"], "tags": ["x"]},
            headers=admin_headers,
        ).json()
        assert body["updated"] == [t.id]
        assert body["errors"] == [{"id": "does-not-exist", "detail": "Token not found"}]

    def test_creates_the_shared_tag_row_once(self, client, admin_headers):
        tokens = [make_token() for _ in range(4)]
        client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id for t in tokens], "tags": ["Unique-Tag-Once"]},
            headers=admin_headers,
        )
        db = SessionLocal()
        try:
            rows = db.query(Tag).filter(Tag.internal == "unique-tag-once").all()
            assert len(rows) == 1
        finally:
            db.close()

    def test_player_denied(self, client, player_headers):
        t = make_token()
        resp = client.post(
            "/api/tokens/bulk/tags",
            json={"ids": [t.id], "tags": ["x"]},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_rejects_empty_selection(self, client, admin_headers):
        resp = client.post(
            "/api/tokens/bulk/tags", json={"ids": [], "tags": ["x"]}, headers=admin_headers
        )
        assert resp.status_code == 422


class TestBulkUpdate:
    """Per-item field edits — the "Save all" path of the bulk edit modal."""

    def test_applies_different_fields_per_item(self, client, admin_headers):
        a, b = make_token(), make_token()
        resp = client.post(
            "/api/tokens/bulk",
            json={
                "items": [
                    {"id": a.id, "description": "first", "tags": ["alpha"]},
                    {"id": b.id, "is_explicit": True},
                ]
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        assert set(resp.json()["updated"]) == {a.id, b.id}
        assert _tags_of("token", a.id) == ["alpha"]

        detail = client.get(f"/api/tokens/{a.id}", headers=admin_headers).json()
        assert detail["description"] == "first"
        assert client.get(f"/api/tokens/{b.id}", headers=admin_headers).json()["is_explicit"]

    def test_replaces_tags_rather_than_merging(self, client, admin_headers):
        """Unlike /bulk/tags, a per-item update sets the tag list outright."""
        t = make_token(tags=["old"])
        client.post(
            "/api/tokens/bulk",
            json={"items": [{"id": t.id, "tags": ["new"]}]},
            headers=admin_headers,
        )
        assert _tags_of("token", t.id) == ["new"]

    def test_unknown_id_skipped(self, client, admin_headers):
        t = make_token()
        body = client.post(
            "/api/tokens/bulk",
            json={"items": [{"id": t.id, "description": "ok"}, {"id": "nope"}]},
            headers=admin_headers,
        ).json()
        assert body["updated"] == [t.id]
        assert body["errors"][0]["id"] == "nope"

    def test_player_denied(self, client, player_headers):
        t = make_token()
        resp = client.post(
            "/api/tokens/bulk",
            json={"items": [{"id": t.id, "description": "x"}]},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestBulkAcrossResourceTypes:
    """Every bulk-editable collection exposes the same pair of endpoints."""

    def test_maps(self, client, admin_headers):
        m = make_map()
        assert (
            client.post(
                "/api/maps/bulk/tags", json={"ids": [m.id], "tags": ["cave"]}, headers=admin_headers
            ).status_code
            == 200
        )
        assert _tags_of("map", m.id) == ["cave"]
        client.post(
            "/api/maps/bulk",
            json={"items": [{"id": m.id, "grid_size": "22x22"}]},
            headers=admin_headers,
        )
        assert client.get(f"/api/maps/{m.id}", headers=admin_headers).json()["grid_size"] == "22x22"

    def test_audio(self, client, admin_headers):
        a = make_audio()
        assert (
            client.post(
                "/api/audio/bulk/tags",
                json={"ids": [a.id], "tags": ["ambient"]},
                headers=admin_headers,
            ).status_code
            == 200
        )
        assert _tags_of("audio", a.id) == ["ambient"]

    def test_books(self, client, admin_headers):
        system = make_game_system()
        book = make_book(system.id)
        assert (
            client.post(
                "/api/books/bulk/tags",
                json={"ids": [book.id], "tags": ["lore"]},
                headers=admin_headers,
            ).status_code
            == 200
        )
        assert _tags_of("book", book.id) == ["lore"]
        client.post(
            "/api/books/bulk",
            json={"items": [{"id": book.id, "publisher": "WotC"}]},
            headers=admin_headers,
        )
        assert (
            client.get(f"/api/books/{book.id}", headers=admin_headers).json()["publisher"]
            == "WotC"
        )

    def test_systems(self, client, admin_headers):
        s = make_game_system()
        assert (
            client.post(
                "/api/systems/bulk/tags",
                json={"ids": [s.id], "tags": ["fantasy"]},
                headers=admin_headers,
            ).status_code
            == 200
        )
        assert _tags_of("system", s.id) == ["fantasy"]

    def test_system_rename_conflict_is_reported_per_item(self, client, admin_headers):
        """A duplicate name fails just its own item, not the whole batch."""
        taken = make_game_system()
        other = make_game_system()
        body = client.post(
            "/api/systems/bulk",
            json={
                "items": [
                    {"id": other.id, "name": taken.name},
                    {"id": other.id, "description": "applied anyway"},
                ]
            },
            headers=admin_headers,
        ).json()
        assert body["errors"][0]["id"] == other.id
        assert "already exists" in body["errors"][0]["detail"]
        assert other.id in body["updated"]


class TestBulkFolderTags:
    def test_sets_tags_on_many_folders_at_once(self, client, admin_headers):
        resp = client.post(
            "/api/token-folders/bulk",
            json={
                "folders": [
                    {"path": "Monsters", "tags": ["Beast"]},
                    {"path": "Heroes", "tags": ["Player"]},
                ]
            },
            headers=admin_headers,
        )
        assert resp.status_code == 200
        db = SessionLocal()
        try:
            paths = {f.path: f.tags for f in db.query(TokenFolder).all()}
        finally:
            db.close()
        assert paths["Monsters"] == ["beast"]
        assert paths["Heroes"] == ["player"]

    def test_player_denied(self, client, player_headers):
        resp = client.post(
            "/api/token-folders/bulk",
            json={"folders": [{"path": "X", "tags": ["y"]}]},
            headers=player_headers,
        )
        assert resp.status_code == 403


class TestTagCreationIsRaceSafe:
    """The root cause of #270: concurrent creation of the same new tag.

    Even with bulk endpoints, two users (or two tabs) can still apply the same
    new tag at once, so ``get_or_create_tag`` itself must tolerate the race.
    """

    def test_concurrent_creation_of_same_tag_yields_one_row(self):
        barrier = threading.Barrier(8)
        errors: list[Exception] = []

        def worker():
            db = SessionLocal()
            try:
                barrier.wait(timeout=10)
                tag_service.get_or_create_tag(db, "Concurrent-Tag", category="token")
                db.commit()
            except Exception as exc:  # pragma: no cover - only on regression
                errors.append(exc)
                db.rollback()
            finally:
                db.close()

        threads = [threading.Thread(target=worker) for _ in range(8)]
        for t in threads:
            t.start()
        for t in threads:
            t.join(timeout=30)

        assert errors == [], f"concurrent tag creation raised: {errors}"
        db = SessionLocal()
        try:
            rows = db.query(Tag).filter(Tag.internal == "concurrent-tag").all()
        finally:
            db.close()
        assert len(rows) == 1

    def test_losing_writer_adopts_the_winning_row(self):
        """The loser must return the winner's row, not None or a duplicate."""
        db_a, db_b = SessionLocal(), SessionLocal()
        try:
            first = tag_service.get_or_create_tag(db_a, "Adopted", category="token")
            db_a.commit()
            # db_b read before the commit above would see nothing; force the
            # insert path and confirm it resolves to the committed row.
            second = tag_service.get_or_create_tag(db_b, "adopted", category="map")
            db_b.commit()
            assert second is not None
            assert second.id == first.id
        finally:
            db_a.close()
            db_b.close()
