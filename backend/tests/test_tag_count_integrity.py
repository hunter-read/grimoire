"""A tag's count and its item list must describe the same population (issue #445).

``GET /api/tags`` reported a ``count`` per tag that ``GET /api/tags/{t}/items``
often disagreed with — by 208 on the reporter's largest tag, and with three tags
counting a carrier that no longer existed anywhere. The two numbers came from two
different populations: ``count`` was ``COUNT(*)`` over the ``resource_tags`` join
table, while ``items`` resolved the same links against the resource tables and
quietly dropped the ones that no longer resolved.

These cover the three ways a link outlives what it described, plus the folder
rows that did the same thing a directory at a time.
"""
import os
import shutil
import uuid

import pytest

from backend.config import LIBRARY_PATH as LIB, SessionLocal
from backend.models import Book, GameSystem, MapFolder, ResourceTag, Tag
from backend.routers.maintenance._helpers import _do_cleanup
from backend.services import library_fs as fs, tag_service
from backend.tests.conftest import make_book, make_game_system, make_map


def _tag_row(client, headers, internal):
    """The listing entry for one tag, or None when it has dropped out."""
    resp = client.get("/api/tags", headers=headers)
    assert resp.status_code == 200, resp.text
    return next((t for t in resp.json()["tags"] if t["internal"] == internal), None)


def _items(client, headers, internal):
    resp = client.get(f"/api/tags/{internal}/items", headers=headers)
    assert resp.status_code == 200, resp.text
    return resp.json()


class TestCountMatchesItems:
    """The invariant the issue actually asks about, over each way of breaking it."""

    def test_count_agrees_with_items_after_a_system_cascade(self, client, admin_headers):
        """A cascaded book delete used to leave its tag link counted forever.

        ``GameSystem.books`` is ``cascade="all, delete-orphan"``, so deleting a
        system removes its books through the ORM without passing through
        ``purge_references``. This is the reporter's clearest case: ``count: 1``
        against an empty ``items``.
        """
        tag = f"cascade{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        make_book(system.id, tags=[tag])
        assert _tag_row(client, admin_headers, tag)["count"] == 1

        db = SessionLocal()
        db.delete(db.query(GameSystem).filter_by(id=system.id).first())
        db.commit()
        db.close()

        row = _tag_row(client, admin_headers, tag)
        count = row["count"] if row else 0
        assert count == len(_items(client, admin_headers, tag)["items"]) == 0

    def test_variant_children_are_counted_once_like_every_other_browse_view(
        self, client, admin_headers
    ):
        """Filing a duplicate under a parent hides it here as it does elsewhere.

        Every other browse surface — listings, search, library stats — resolves
        through ``variants.parents_only``. The tags view was the one that did
        not, so a printer-friendly cut counted as a second carrier of every tag
        its parent had.
        """
        tag = f"variant{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        parent = make_book(system.id, tags=[tag])
        child = make_book(system.id, tags=[tag])
        assert _tag_row(client, admin_headers, tag)["count"] == 2

        linked = client.post(
            "/api/duplicates/link",
            headers=admin_headers,
            json={
                "resource_type": "book",
                "parent_id": parent.id,
                "children": [{"id": child.id, "kind": "printer-friendly", "label": "PF"}],
            },
        )
        assert linked.status_code == 200, linked.text
        assert linked.json()["linked"] == [child.id]

        items = _items(client, admin_headers, tag)["items"]
        assert _tag_row(client, admin_headers, tag)["count"] == len(items) == 1
        assert [i["item_id"] for i in items] == [parent.id]

    def test_a_link_to_a_deleted_row_is_neither_counted_nor_listed(
        self, client, admin_headers
    ):
        """The general case, whatever removed the row without cleaning up."""
        tag = f"orphan{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        book = make_book(system.id, tags=[tag])

        db = SessionLocal()
        # Delete the row the way an older version could, leaving the link behind.
        db.query(Book).filter_by(id=book.id).delete(synchronize_session=False)
        db.commit()
        assert db.query(ResourceTag).filter_by(resource_id=book.id).count() == 1
        db.close()

        row = _tag_row(client, admin_headers, tag)
        assert (row["count"] if row else 0) == 0
        assert _items(client, admin_headers, tag)["items"] == []


class TestCleanupCollectsTheDebris:
    """The listing stops *counting* dead links; cleanup stops *storing* them."""

    def test_cleanup_removes_orphaned_links_and_the_tags_left_bare(self):
        tag = f"sweep{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        book = make_book(system.id, tags=[tag])

        db = SessionLocal()
        db.query(Book).filter_by(id=book.id).delete(synchronize_session=False)
        db.commit()

        removed = _do_cleanup(db)
        assert removed["tag_links"] >= 1
        assert db.query(ResourceTag).filter_by(resource_id=book.id).count() == 0
        # The tag row had no other carrier, so it goes too rather than lingering
        # as a name nothing can use but that still owns its internal key.
        assert db.query(Tag).filter_by(internal=tag).first() is None
        db.close()

    def test_cleanup_keeps_links_whose_resource_is_still_there(self, tmp_path):
        tag = f"keep{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        # Cleanup deletes any row whose file is gone, and the factory's default
        # filepath points at a /tmp name that was never created — so the book
        # needs a real file for this to test link retention rather than deletion.
        real = tmp_path / "kept.pdf"
        real.write_bytes(b"pdf")
        book = make_book(system.id, tags=[tag], filepath=str(real))

        db = SessionLocal()
        _do_cleanup(db)
        assert db.query(ResourceTag).filter_by(resource_id=book.id).count() == 1
        assert db.query(Tag).filter_by(internal=tag).first() is not None
        db.close()


@pytest.fixture()
def map_tree():
    """A maps folder on disk, torn down afterwards."""
    stamp = uuid.uuid4().hex[:8]
    os.makedirs(os.path.join(LIB, f"maps/Battlemaps-{stamp}/Swamps"), exist_ok=True)
    yield stamp
    shutil.rmtree(os.path.join(LIB, f"maps/Battlemaps-{stamp}"), ignore_errors=True)


class TestFolderRowsFollowTheirFolder:
    """"I can see folders that no longer exist with tags" — the reporter's note.

    A folder row is keyed by *path*, not by id, so it is the one row a move or
    rename could not carry along: the files underneath were relinked by id while
    the folder's own row kept pointing at a directory that no longer existed.
    """

    def _folder_rows(self, stamp):
        db = SessionLocal()
        try:
            return {f.path: list(f.tags or []) for f in db.query(MapFolder).all() if stamp in f.path}
        finally:
            db.close()

    def test_renaming_a_folder_carries_its_tags(self, map_tree):
        rel = f"Battlemaps-{map_tree}/Swamps"
        db = SessionLocal()
        tag_service.upsert_folder_tags(db, MapFolder, rel, ["swampy"], category="map")
        db.commit()
        db.close()

        db = SessionLocal()
        fs.rename_path(db, f"maps/Battlemaps-{map_tree}/Swamps", "Marshes")
        db.close()

        assert self._folder_rows(map_tree) == {
            f"Battlemaps-{map_tree}/Marshes": ["swampy"]
        }

    def test_a_renamed_folders_tag_still_covers_the_maps_inside(self, client, admin_headers, map_tree):
        """The point of carrying the row: the tag keeps applying to its contents."""
        rel = f"Battlemaps-{map_tree}/Swamps"
        tag = f"swamp{uuid.uuid4().hex[:6]}"
        # The factory's default filepath is under /tmp; the row has to sit inside
        # the library for a rename to find and relink it.
        map_rel = f"maps/Battlemaps-{map_tree}/Swamps/bog.png"
        map_abs = os.path.join(LIB, map_rel)
        open(map_abs, "wb").close()
        make_map(relative_path=map_rel, filepath=map_abs, filename="bog.png")
        db = SessionLocal()
        tag_service.upsert_folder_tags(db, MapFolder, rel, [tag], category="map")
        db.commit()
        db.close()

        before = _items(client, admin_headers, tag)
        assert sum(len(g["items"]) for g in before["folders"]) == 1

        db = SessionLocal()
        fs.rename_path(db, f"maps/Battlemaps-{map_tree}/Swamps", "Marshes")
        db.close()

        # The map moved with the folder, so the folder group still holds it —
        # under the new path rather than the old one.
        after = _items(client, admin_headers, tag)
        assert [g["path"] for g in after["folders"]] == [f"Battlemaps-{map_tree}/Marshes"]
        assert sum(len(g["items"]) for g in after["folders"]) == 1

    def test_deleting_a_folder_removes_its_folder_tags(self, map_tree):
        rel = f"Battlemaps-{map_tree}/Swamps"
        db = SessionLocal()
        tag_service.upsert_folder_tags(db, MapFolder, rel, ["doomed"], category="map")
        db.commit()
        db.close()

        db = SessionLocal()
        fs.delete_path(db, f"maps/Battlemaps-{map_tree}/Swamps", confirm_name="Swamps")
        db.close()

        assert self._folder_rows(map_tree) == {}

    def test_cleanup_prunes_a_folder_row_whose_directory_vanished(self, map_tree):
        """A directory renamed outside Grimoire leaves a row only cleanup can see."""
        rel = f"Battlemaps-{map_tree}/Ghost"
        db = SessionLocal()
        tag_service.upsert_folder_tags(db, MapFolder, rel, ["ghostly"], category="map")
        db.commit()
        db.close()

        db = SessionLocal()
        removed = _do_cleanup(db)
        db.close()

        assert removed["folders"] >= 1
        assert self._folder_rows(map_tree) == {}


class TestSystemDeleteLeavesNothingBehind:
    """The cascade behind ``GameSystem.books`` is the path that made the debris."""

    def test_pruning_a_system_purges_its_books_references(self, admin_id):
        """Bookmarks too: ``Bookmark.book_id`` is a real FK with no ``ondelete``,
        so a bookmarked book in a pruned system used to fail the delete outright
        rather than cascade."""
        from backend.models.users import Bookmark

        tag = f"shelf{uuid.uuid4().hex[:6]}"
        system = make_game_system()
        book = make_book(system.id, tags=[tag])

        db = SessionLocal()
        db.add(Bookmark(book_id=book.id, user_id=admin_id, page_number=3))
        db.commit()

        # The system has no books on disk, so the sweep prunes book and system.
        _do_cleanup(db)

        assert db.query(GameSystem).filter_by(id=system.id).first() is None
        assert db.query(Book).filter_by(id=book.id).first() is None
        assert db.query(Bookmark).filter_by(book_id=book.id).count() == 0
        assert db.query(ResourceTag).filter_by(resource_id=book.id).count() == 0
        db.close()

    def test_a_tagged_system_row_purges_its_own_links(self):
        tag = f"systag{uuid.uuid4().hex[:6]}"
        system = make_game_system(tags=[tag])

        db = SessionLocal()
        assert db.query(ResourceTag).filter_by(resource_id=system.id).count() == 1
        _do_cleanup(db)
        assert db.query(GameSystem).filter_by(id=system.id).first() is None
        assert db.query(ResourceTag).filter_by(resource_id=system.id).count() == 0
        db.close()
