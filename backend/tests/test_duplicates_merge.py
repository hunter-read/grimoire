"""One-step merge of duplicate copies (issue #589).

The guarantee these tests hold the merge to: nothing that pointed at a merged
copy is lost. Every reference kind gets its own test, since each one is a
separate table with its own uniqueness rule, and a kind that was forgotten
would fail silently - a player's bookmark simply gone, a handout link that
renders "not found".
"""
import os
import uuid

import pytest
from sqlalchemy.exc import OperationalError

from backend.config import SessionLocal
from backend.models import Book, CampaignResource, Favorite, GameSystem, ResourceTag
from backend.models.access import UserAccessGrant
from backend.models.audio_sets import AudioSet
from backend.models.campaigns import CampaignResourceShare, WikiPage
from backend.models.share_links import ShareLink
from backend.models.users import Bookmark
from backend.services import library_fs as fs
from backend.services.duplicates import suggest_keeper
from backend.services.duplicates.merge import merge
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_campaign,
    make_game_system,
    make_map,
)

API = "/api/duplicates"


@pytest.fixture
def system():
    return make_game_system()


def _merge(client, headers, keep, merge_ids, rtype="book", **extra):
    body = {"resource_type": rtype, "merge_ids": list(merge_ids), **extra}
    if keep is not None:
        body["keep_id"] = keep
    return client.post(f"{API}/merge", headers=headers, json=body)


def _add(*rows):
    # Not expired on commit, so a test can read a row's id after the session
    # that wrote it has closed.
    db = SessionLocal(expire_on_commit=False)
    try:
        for row in rows:
            db.add(row)
        db.commit()
    finally:
        db.close()


def _query(fn):
    db = SessionLocal()
    try:
        return fn(db)
    finally:
        db.close()


def _exists(model, record_id):
    return _query(lambda db: db.query(model).filter_by(id=record_id).first() is not None)


def _on_disk(name, body=b"%PDF-1.4 stub"):
    root = os.path.join(os.environ["LIBRARY_PATH"], "books", "dupe-merge")
    os.makedirs(root, exist_ok=True)
    path = os.path.join(root, f"{uuid.uuid4().hex[:6]}-{name}")
    with open(path, "wb") as f:
        f.write(body)
    return path


class TestReferencesMove:
    """Each reference kind lands on the keeper, with no duplicates."""

    def test_bookmarks_move_and_identical_ones_collapse(
        self, client, admin_headers, admin_id, gm_id, system
    ):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        _add(
            Bookmark(user_id=admin_id, book_id=keep.id, page_number=4, label="Map"),
            Bookmark(user_id=admin_id, book_id=drop.id, page_number=4, label="Map"),
            Bookmark(user_id=admin_id, book_id=drop.id, page_number=9, label="Lair"),
            Bookmark(user_id=gm_id, book_id=drop.id, page_number=4, label="Map"),
        )
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["references"]["bookmarks"] == {"moved": 2, "deduplicated": 1}

        marks = _query(
            lambda db: sorted(
                (b.user_id, b.page_number)
                for b in db.query(Bookmark).filter_by(book_id=keep.id).all()
            )
        )
        assert marks == sorted([(admin_id, 4), (admin_id, 9), (gm_id, 4)])
        assert not _exists(Book, drop.id)

    def test_favorites_move_one_per_user(
        self, client, admin_headers, admin_id, gm_id, player_id, system
    ):
        keep, a, b = (make_book(system_id=system.id) for _ in range(3))
        _add(
            Favorite(user_id=admin_id, item_type="book", item_id=keep.id),
            Favorite(user_id=admin_id, item_type="book", item_id=a.id),
            Favorite(user_id=gm_id, item_type="book", item_id=a.id),
            Favorite(user_id=gm_id, item_type="book", item_id=b.id),
            Favorite(user_id=player_id, item_type="book", item_id=b.id),
        )
        body = _merge(client, admin_headers, keep.id, [a.id, b.id]).json()
        assert body["references"]["favorites"] == {"moved": 2, "deduplicated": 2}
        users = _query(
            lambda db: sorted(
                f.user_id
                for f in db.query(Favorite).filter_by(item_type="book", item_id=keep.id).all()
            )
        )
        assert users == sorted([admin_id, gm_id, player_id])

    def test_tags_are_unioned(self, client, admin_headers, system):
        keep = make_book(system_id=system.id, tags=["horror", "core"])
        drop = make_book(system_id=system.id, tags=["core", "gothic"])
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["tags_added"] == ["gothic"]
        assert body["references"]["tags"] == {"moved": 1, "deduplicated": 1}
        detail = client.get(f"/api/books/{keep.id}", headers=admin_headers).json()
        assert sorted(detail["tags"]) == ["core", "gothic", "horror"]
        assert _query(
            lambda db: db.query(ResourceTag).filter_by(resource_id=drop.id).count()
        ) == 0

    def test_campaign_links_move_and_keep_the_union_of_shares(
        self, client, admin_headers, admin_id, gm_id, player_id, system
    ):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        both = make_campaign(admin_id)
        only_drop = make_campaign(admin_id)
        kept_row = CampaignResource(
            campaign_id=both.id, resource_type="book", resource_id=keep.id, visibility="private"
        )
        dropped_row = CampaignResource(
            campaign_id=both.id, resource_type="book", resource_id=drop.id, visibility="private"
        )
        moving_row = CampaignResource(
            campaign_id=only_drop.id, resource_type="book", resource_id=drop.id
        )
        _add(kept_row, dropped_row, moving_row)
        _add(
            CampaignResourceShare(resource_id=kept_row.id, user_id=gm_id),
            CampaignResourceShare(resource_id=dropped_row.id, user_id=gm_id),
            CampaignResourceShare(resource_id=dropped_row.id, user_id=player_id),
        )

        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["references"]["campaigns"] == {"moved": 1, "deduplicated": 1}

        def state(db):
            rows = db.query(CampaignResource).filter_by(resource_type="book", resource_id=keep.id)
            shared = {
                s.user_id
                for s in db.query(CampaignResourceShare).filter_by(resource_id=kept_row.id)
            }
            return sorted(r.campaign_id for r in rows), shared

        campaigns, shared = _query(state)
        assert campaigns == sorted([both.id, only_drop.id])
        assert shared == {gm_id, player_id}
        # The dropped row's own shares went with it, not stranded.
        assert _query(
            lambda db: db.query(CampaignResourceShare).filter_by(resource_id=dropped_row.id).count()
        ) == 0

    def test_share_links_move(self, client, admin_headers, admin_id, system):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        link = ShareLink(
            token_hash=uuid.uuid4().hex,
            token_sealed="sealed",
            user_id=admin_id,
            resource_type="book",
            resource_id=drop.id,
        )
        _add(link)
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["references"]["share_links"]["moved"] == 1
        assert _query(lambda db: db.query(ShareLink).filter_by(id=link.id).one().resource_id) == (
            keep.id
        )

    def test_access_grants_move_and_keep_the_wider_level(
        self, client, admin_headers, gm_id, player_id, system
    ):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        _add(
            UserAccessGrant(user_id=gm_id, scope_type="book", scope_id=keep.id, level="gm"),
            UserAccessGrant(user_id=gm_id, scope_type="book", scope_id=drop.id, level="admin"),
            UserAccessGrant(user_id=player_id, scope_type="book", scope_id=drop.id, level="gm"),
        )
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["references"]["access_grants"] == {"moved": 1, "deduplicated": 1}
        levels = _query(
            lambda db: {
                g.user_id: g.level
                for g in db.query(UserAccessGrant).filter_by(scope_type="book", scope_id=keep.id)
            }
        )
        assert levels == {gm_id: "admin", player_id: "gm"}

    def test_system_cover_follows_the_keeper(self, client, admin_headers):
        system = make_game_system()
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        db = SessionLocal()
        db.query(GameSystem).filter_by(id=system.id).update({"cover_book_id": drop.id})
        db.commit()
        db.close()
        _merge(client, admin_headers, keep.id, [drop.id])
        assert _query(lambda db: db.get(GameSystem, system.id).cover_book_id) == keep.id

    def test_note_embeds_are_rewritten(self, client, admin_headers, admin_id, system):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        campaign = make_campaign(admin_id, description=f"Start with [[book:{drop.id}]]")
        # An id that merely starts with the dropped one must not be touched.
        lookalike = f"{drop.id}x"
        body_text = (
            f"See [[book:{drop.id}:12]], [[Book:{drop.id}|the handout]], "
            f"[[map:{drop.id}]] and [[book:{lookalike}]]."
        )
        page = WikiPage(campaign_id=campaign.id, title="Prep", slug="prep", body=body_text)
        _add(page)

        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["references"]["notes"]["moved"] == 2
        text = _query(lambda db: db.get(WikiPage, page.id).body)
        assert text == (
            f"See [[book:{keep.id}:12]], [[Book:{keep.id}|the handout]], "
            f"[[map:{drop.id}]] and [[book:{lookalike}]]."
        )
        desc = client.get(f"/api/campaigns/{campaign.id}", headers=admin_headers).json()
        assert desc["description"] == f"Start with [[book:{keep.id}]]"

    def test_soundboard_entries_move_without_doubling(self, client, admin_headers, admin_id):
        keep, drop = make_audio(), make_audio()
        board = AudioSet(
            user_id=admin_id,
            kind="soundboard",
            name=f"Tavern-{uuid.uuid4().hex[:6]}",
            entries=[{"audio_id": keep.id}, {"audio_id": drop.id, "loop": True}],
        )
        playlist = AudioSet(
            user_id=admin_id,
            kind="playlist",
            name=f"Road-{uuid.uuid4().hex[:6]}",
            entries=[{"audio_id": drop.id, "loop": True}],
        )
        _add(board, playlist)
        body = _merge(client, admin_headers, keep.id, [drop.id], rtype="audio").json()
        assert body["references"]["audio_sets"] == {"moved": 1, "deduplicated": 1}
        entries = _query(
            lambda db: (db.get(AudioSet, board.id).entries, db.get(AudioSet, playlist.id).entries)
        )
        assert entries == ([{"audio_id": keep.id}], [{"audio_id": keep.id, "loop": True}])

    def test_media_favorites_move(self, client, admin_headers, admin_id):
        keep, drop = make_map(), make_map()
        _add(Favorite(user_id=admin_id, item_type="map", item_id=drop.id))
        resp = _merge(client, admin_headers, keep.id, [drop.id], rtype="map")
        assert resp.status_code == 200
        assert _query(
            lambda db: db.query(Favorite).filter_by(item_type="map", item_id=keep.id).count()
        ) == 1


class TestMetadata:
    def test_fill_empty_only_fills_blanks(self, client, admin_headers, system):
        keep = make_book(system_id=system.id, title="Keep", publisher="", isbn="")
        first = make_book(system_id=system.id, title="Other", publisher="", isbn="111")
        second = make_book(system_id=system.id, title="Third", publisher="Pub", isbn="222")
        body = _merge(client, admin_headers, keep.id, [first.id, second.id]).json()
        changed = {c["field"]: (c["from_id"], c["value"]) for c in body["fields"]}
        # The first merged copy with a value wins; a title the keeper has stays.
        assert changed["isbn"] == (first.id, "111")
        assert changed["publisher"] == (second.id, "Pub")
        assert "title" not in changed
        detail = client.get(f"/api/books/{keep.id}", headers=admin_headers).json()
        assert detail["title"] == "Keep" and detail["isbn"] == "111"

    def test_none_copies_nothing(self, client, admin_headers, system):
        keep = make_book(system_id=system.id, publisher="")
        drop = make_book(system_id=system.id, publisher="Pub")
        body = _merge(client, admin_headers, keep.id, [drop.id], fields="none").json()
        assert body["fields"] == []

    def test_explicit_fields_overwrite(self, client, admin_headers, system):
        keep = make_book(system_id=system.id, title="Bad scan title")
        drop = make_book(system_id=system.id, title="Curse of Strahd")
        body = _merge(client, admin_headers, keep.id, [drop.id], fields=["title", "tags"]).json()
        assert [c["field"] for c in body["fields"]] == ["title"]
        detail = client.get(f"/api/books/{keep.id}", headers=admin_headers).json()
        assert detail["title"] == "Curse of Strahd"

    def test_rejects_unknown_fields(self, client, admin_headers, system):
        keep, drop = make_book(system_id=system.id), make_book(system_id=system.id)
        resp = _merge(client, admin_headers, keep.id, [drop.id], fields=["filepath"])
        assert resp.status_code == 400
        assert _exists(Book, drop.id)


class TestVariants:
    def _link(self, client, headers, parent, child):
        return client.post(
            f"{API}/link",
            headers=headers,
            json={
                "resource_type": "book",
                "parent_id": parent,
                "children": [{"id": child, "kind": "version"}],
            },
        )

    def test_merged_copy_variants_move_to_the_keeper(self, client, admin_headers, system):
        keep, drop, child = (make_book(system_id=system.id) for _ in range(3))
        self._link(client, admin_headers, drop.id, child.id)
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["variants_reparented"] == 1
        detail = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] == keep.id

    def test_keeping_a_variant_of_a_merged_copy_promotes_it(self, client, admin_headers, system):
        head, keep, sibling = (make_book(system_id=system.id) for _ in range(3))
        self._link(client, admin_headers, head.id, keep.id)
        self._link(client, admin_headers, head.id, sibling.id)
        body = _merge(client, admin_headers, keep.id, [head.id]).json()
        assert body["keeper_promoted"] is True
        assert body["variants_reparented"] == 1
        detail = client.get(f"/api/books/{keep.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] is None
        sib = client.get(f"/api/books/{sibling.id}", headers=admin_headers).json()
        assert sib["variant_parent_id"] == keep.id

    def test_refuses_to_stack_a_third_level(self, client, admin_headers, system):
        outsider, keep, drop, child = (make_book(system_id=system.id) for _ in range(4))
        self._link(client, admin_headers, outsider.id, keep.id)
        self._link(client, admin_headers, drop.id, child.id)
        resp = _merge(client, admin_headers, keep.id, [drop.id])
        assert resp.status_code == 409
        # Refused before anything changed.
        assert _exists(Book, drop.id)
        detail = client.get(f"/api/books/{child.id}", headers=admin_headers).json()
        assert detail["variant_parent_id"] == drop.id


class TestFilesAndDryRun:
    def test_keeps_files_by_default(self, client, admin_headers, system):
        path = _on_disk("keep-file.pdf")
        keep = make_book(system_id=system.id)
        drop = make_book(system_id=system.id, filepath=path, filename="keep-file.pdf")
        body = _merge(client, admin_headers, keep.id, [drop.id]).json()
        assert body["files"][0]["delete"] is False
        assert os.path.exists(path)
        assert not _exists(Book, drop.id)

    def test_deletes_files_when_asked(self, client, admin_headers, system):
        path = _on_disk("drop-file.pdf")
        keep = make_book(system_id=system.id)
        drop = make_book(system_id=system.id, filepath=path, filename="drop-file.pdf")
        body = _merge(client, admin_headers, keep.id, [drop.id], delete_files=True).json()
        assert body["files"][0] == {
            "id": drop.id,
            "path": drop.relative_path,
            "delete": True,
            "file_deleted": True,
            "error": None,
        }
        assert not os.path.exists(path)

    def test_dry_run_changes_nothing(self, client, admin_headers, admin_id, system):
        path = _on_disk("dry.pdf")
        keep = make_book(system_id=system.id, publisher="")
        drop = make_book(
            system_id=system.id, filepath=path, filename="dry.pdf", publisher="Pub", tags=["x"]
        )
        _add(
            Bookmark(user_id=admin_id, book_id=drop.id, page_number=2),
            Favorite(user_id=admin_id, item_type="book", item_id=drop.id),
        )
        body = _merge(
            client, admin_headers, keep.id, [drop.id], delete_files=True, dry_run=True
        ).json()
        assert body["dry_run"] is True
        assert body["references"]["bookmarks"]["moved"] == 1
        assert body["references"]["favorites"]["moved"] == 1
        assert body["tags_added"] == ["x"]
        assert body["fields"][0]["field"] == "publisher"
        assert body["files"][0]["delete"] is True
        assert [i["id"] for i in body["items"]] == [keep.id, drop.id]

        # ...and none of it happened.
        assert os.path.exists(path)
        assert _exists(Book, drop.id)
        assert _query(lambda db: db.query(Bookmark).filter_by(book_id=drop.id).count()) == 1
        assert _query(lambda db: db.get(Book, keep.id).publisher) == ""

    def test_dry_run_picks_the_suggested_keeper(self, client, admin_headers, system):
        small = make_book(system_id=system.id, page_count=10, file_size=100)
        full = make_book(system_id=system.id, page_count=200, file_size=50)
        missing = make_book(system_id=system.id, page_count=400, is_missing=True)
        body = _merge(client, admin_headers, None, [small.id, full.id, missing.id], dry_run=True)
        body = body.json()
        assert body["keep_id"] == full.id
        assert body["suggested_keep_id"] == full.id
        assert sorted(body["merge_ids"]) == sorted([small.id, missing.id])

    def test_flags_bookmarks_moving_to_a_different_printing(
        self, client, admin_headers, admin_id, system
    ):
        keep = make_book(system_id=system.id, page_count=100)
        drop = make_book(system_id=system.id, page_count=120)
        _add(
            Bookmark(user_id=admin_id, book_id=drop.id, page_number=50),
            Bookmark(user_id=admin_id, book_id=drop.id, page_number=110),
        )
        body = _merge(client, admin_headers, keep.id, [drop.id], dry_run=True).json()
        assert body["warnings"] == [
            {
                "code": "page_mismatch",
                "id": drop.id,
                "count": 2,
                "pages": 120,
                "keep_pages": 100,
                "out_of_range": 1,
            }
        ]

    def test_warns_when_keeping_a_missing_file(self, client, admin_headers, system):
        keep = make_book(system_id=system.id, is_missing=True)
        drop = make_book(system_id=system.id)
        body = _merge(client, admin_headers, keep.id, [drop.id], dry_run=True).json()
        assert {"code": "keep_missing", "id": keep.id}.items() <= body["warnings"][0].items()

    def test_read_only_library_refuses_and_changes_nothing(
        self, client, admin_headers, system, monkeypatch
    ):
        path = _on_disk("ro.pdf")
        keep = make_book(system_id=system.id)
        drop = make_book(system_id=system.id, filepath=path, filename="ro.pdf")
        monkeypatch.setattr("backend.services.library_fs.paths.os.access", lambda *a: False)

        dry = _merge(client, admin_headers, keep.id, [drop.id], delete_files=True, dry_run=True)
        assert {"code": "read_only"} in [
            {k: v for k, v in w.items() if v is not None} for w in dry.json()["warnings"]
        ]
        resp = _merge(client, admin_headers, keep.id, [drop.id], delete_files=True)
        assert resp.status_code == 409
        assert _exists(Book, drop.id) and os.path.exists(path)

    def test_a_file_that_will_not_delete_is_reported(
        self, client, admin_headers, system, monkeypatch
    ):
        path = _on_disk("stuck.pdf")
        keep = make_book(system_id=system.id)
        drop = make_book(system_id=system.id, filepath=path, filename="stuck.pdf")

        def refuse(self, *a, **kw):
            raise PermissionError(13, "Permission denied")

        monkeypatch.setattr("backend.services.library_fs.deletes.Path.unlink", refuse)
        body = _merge(client, admin_headers, keep.id, [drop.id], delete_files=True).json()
        assert body["files"][0]["file_deleted"] is False
        assert "Permission denied" in body["files"][0]["error"]
        # The row still goes: the merge itself succeeded.
        assert not _exists(Book, drop.id)

    @staticmethod
    def _with_leftovers(system, name):
        """A copy on disk with a sidecar and a cached thumbnail beside it."""
        path = _on_disk(name)
        sidecar = path[: -len(".pdf")] + ".opf"
        with open(sidecar, "w") as f:
            f.write("<package/>")
        title = f"Leftovers {uuid.uuid4().hex[:6]}"
        book = make_book(
            system_id=system.id, filepath=path, filename=name, title=title, has_thumbnail=True
        )
        thumb = fs._thumb_file("books", title, path)
        thumb.parent.mkdir(parents=True, exist_ok=True)
        thumb.write_bytes(b"thumb")
        return book, [path, sidecar, str(thumb)]

    def test_deleting_takes_sidecars_and_thumbnails_too(self, client, admin_headers, system):
        keep = make_book(system_id=system.id)
        drop, leftovers = self._with_leftovers(system, "full-drop.pdf")
        body = _merge(client, admin_headers, keep.id, [drop.id], delete_files=True).json()
        assert body["files"][0]["file_deleted"] is True
        assert [p for p in leftovers if os.path.exists(p)] == []

    def test_a_failed_commit_keeps_every_file(self, system, monkeypatch):
        """Issue #703: a rollback restores rows, never files, so none may go first."""
        keep = make_book(system_id=system.id)
        drops = [self._with_leftovers(system, f"commit-{i}.pdf") for i in range(2)]
        db = SessionLocal()

        def fail():
            raise OperationalError("COMMIT", {}, Exception("database is locked"))

        monkeypatch.setattr(db, "commit", fail)
        try:
            with pytest.raises(OperationalError):
                merge(db, "book", keep.id, [b.id for b, _ in drops], delete_files=True)
        finally:
            db.close()

        for book, leftovers in drops:
            assert _exists(Book, book.id)
            assert [p for p in leftovers if not os.path.exists(p)] == []


class TestValidation:
    def test_real_merge_must_name_its_keeper(self, client, admin_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _merge(client, admin_headers, None, [a.id, b.id]).status_code == 400

    def test_keeper_cannot_be_merged(self, client, admin_headers, system):
        a = make_book(system_id=system.id)
        assert _merge(client, admin_headers, a.id, [a.id]).status_code == 400

    def test_repeated_ids(self, client, admin_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _merge(client, admin_headers, a.id, [b.id, b.id]).status_code == 400

    def test_suggestion_needs_two_copies(self, client, admin_headers, system):
        a = make_book(system_id=system.id)
        assert _merge(client, admin_headers, None, [a.id], dry_run=True).status_code == 400

    def test_missing_item_404s(self, client, admin_headers, system):
        a = make_book(system_id=system.id)
        assert _merge(client, admin_headers, a.id, ["nope"]).status_code == 404

    def test_unknown_fields_mode(self, client, admin_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _merge(client, admin_headers, a.id, [b.id], fields="all").status_code == 422

    def test_requires_admin(self, client, gm_headers, system):
        a, b = make_book(system_id=system.id), make_book(system_id=system.id)
        assert _merge(client, gm_headers, a.id, [b.id]).status_code in (401, 403)


class TestBatch:
    def test_merges_each_group_and_reports_failures(self, client, admin_headers, system):
        k1, d1 = make_book(system_id=system.id), make_book(system_id=system.id)
        k2, d2 = make_map(), make_map()
        resp = client.post(
            f"{API}/merge-batch",
            headers=admin_headers,
            json={
                "merges": [
                    {"resource_type": "book", "keep_id": k1.id, "merge_ids": [d1.id]},
                    {"resource_type": "book", "keep_id": k1.id, "merge_ids": ["gone"]},
                    {"resource_type": "map", "keep_id": k2.id, "merge_ids": [d2.id]},
                ]
            },
        )
        body = resp.json()
        assert resp.status_code == 200
        assert (body["merged"], body["failed"]) == (2, 1)
        assert [r["ok"] for r in body["results"]] == [True, False, True]
        assert body["results"][1]["detail"]
        assert not _exists(Book, d1.id)

    def test_dry_run_batch_changes_nothing(self, client, admin_headers, system):
        k, d = make_book(system_id=system.id), make_book(system_id=system.id)
        resp = client.post(
            f"{API}/merge-batch",
            headers=admin_headers,
            json={
                "dry_run": True,
                "merges": [{"resource_type": "book", "keep_id": k.id, "merge_ids": [d.id]}],
            },
        )
        assert resp.json()["results"][0]["result"]["dry_run"] is True
        assert _exists(Book, d.id)


class TestSuggestKeeper:
    def test_prefers_the_more_complete_record_between_equal_files(self, system):
        bare = make_book(system_id=system.id, page_count=5, file_size=10, publisher="")
        rich = make_book(system_id=system.id, page_count=5, file_size=10, publisher="Pub")
        assert suggest_keeper([bare, rich], ["publisher", "tags"]) == rich.id

    def test_empty(self):
        assert suggest_keeper([]) is None
