"""Deleting a library row takes its references with it.

Nothing in the schema does this for us: the polymorphic references
(favorites, resource tags, campaign resources) carry no foreign key, and
``bookmarks.book_id`` has one with no ``ondelete`` — so deleting a bookmarked
book used to raise IntegrityError rather than cascade. See
``services/library_fs/references.py``.
"""
import uuid
from pathlib import Path

import pytest
from sqlalchemy import text

from backend.config import SessionLocal
from backend.models import (
    Audio,
    Book,
    CampaignResource,
    CampaignResourceShare,
    Favorite,
    GenericMap,
    ResourceTag,
    Token,
)
from backend.models.users import Bookmark
from backend.services.library_fs.deletes import delete_record
from backend.services.library_fs.references import (
    item_type_for,
    purge_references,
    reference_counts,
    reference_counts_for,
)
from backend.tests.conftest import (
    make_audio,
    make_book,
    make_campaign,
    make_game_system,
    make_map,
    make_token,
)


def _attach_all(db, item_type, item_id, user_id, campaign_id):
    """Give a record one of every kind of reference row."""
    db.add(Favorite(user_id=user_id, item_type=item_type, item_id=item_id))
    tag = db.query(ResourceTag).first()
    tag_id = tag.tag_id if tag else None
    if tag_id is None:
        from backend.models import Tag

        t = Tag(internal=f"t-{uuid.uuid4().hex[:8]}", display="T", category=item_type)
        db.add(t)
        db.flush()
        tag_id = t.id
    db.add(ResourceTag(tag_id=tag_id, resource_type=item_type, resource_id=item_id))
    resource = CampaignResource(
        campaign_id=campaign_id, resource_type=item_type, resource_id=item_id
    )
    db.add(resource)
    db.flush()
    db.add(CampaignResourceShare(resource_id=resource.id, user_id=user_id))
    db.commit()
    return resource.id


class TestPurgeReferences:
    def test_item_type_for_each_model(self):
        assert item_type_for(Book) == "book"
        assert item_type_for(GenericMap) == "map"
        assert item_type_for(Token) == "token"
        assert item_type_for(Audio) == "audio"

    def test_unknown_model_is_a_no_op(self):
        class Nope:
            pass

        assert item_type_for(Nope) == ""
        db = SessionLocal()
        try:
            purge_references(db, Nope, "whatever")  # must not raise
            assert reference_counts(db, Nope, "whatever") == {}
        finally:
            db.close()

    def test_book_references_are_all_removed(self, admin_id):
        system = make_game_system()
        book = make_book(system_id=system.id)
        campaign = make_campaign(owner_id=admin_id)
        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=admin_id, book_id=book.id, page_number=3))
            resource_id = _attach_all(db, "book", book.id, admin_id, campaign.id)
            db.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:b, 1, 'dragons')"
                ),
                {"b": book.id},
            )
            db.commit()

            counts = reference_counts(db, Book, book.id)
            assert counts == {
                "favorites": 1,
                "tags": 1,
                "campaigns": 1,
                "bookmarks": 1,
            }

            purge_references(db, Book, book.id)
            db.delete(db.query(Book).filter_by(id=book.id).first())
            db.commit()

            assert db.query(Bookmark).filter_by(book_id=book.id).count() == 0
            assert db.query(Favorite).filter_by(item_type="book", item_id=book.id).count() == 0
            assert (
                db.query(ResourceTag)
                .filter_by(resource_type="book", resource_id=book.id)
                .count()
                == 0
            )
            assert db.query(CampaignResource).filter_by(id=resource_id).count() == 0
            # Shares cascade off the resource through the ORM relationship, which
            # is why references.py deletes resources one at a time.
            assert db.query(CampaignResourceShare).filter_by(resource_id=resource_id).count() == 0
            fts = db.execute(
                text("SELECT COUNT(*) FROM book_search WHERE book_id = :b"), {"b": book.id}
            ).scalar()
            assert fts == 0
        finally:
            db.close()

    @pytest.mark.parametrize(
        "factory,model,item_type",
        [(make_map, GenericMap, "map"), (make_token, Token, "token"), (make_audio, Audio, "audio")],
    )
    def test_media_references_are_removed(self, admin_id, factory, model, item_type):
        record = factory()
        campaign = make_campaign(owner_id=admin_id)
        db = SessionLocal()
        try:
            _attach_all(db, item_type, record.id, admin_id, campaign.id)
            counts = reference_counts(db, model, record.id)
            assert counts["favorites"] == 1
            assert counts["tags"] == 1
            assert counts["campaigns"] == 1
            # Only books have bookmarks.
            assert "bookmarks" not in counts

            purge_references(db, model, record.id)
            db.commit()

            assert (
                db.query(Favorite).filter_by(item_type=item_type, item_id=record.id).count() == 0
            )
            assert (
                db.query(ResourceTag)
                .filter_by(resource_type=item_type, resource_id=record.id)
                .count()
                == 0
            )
            assert (
                db.query(CampaignResource)
                .filter_by(resource_type=item_type, resource_id=record.id)
                .count()
                == 0
            )
        finally:
            db.close()

    def test_record_with_no_references_is_fine(self):
        system = make_game_system()
        book = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            assert reference_counts(db, Book, book.id) == {
                "favorites": 0,
                "tags": 0,
                "campaigns": 0,
                "bookmarks": 0,
            }
            purge_references(db, Book, book.id)  # must not raise
            db.commit()
        finally:
            db.close()


class TestDeleteRecord:
    def test_deletes_row_and_file(self, tmp_path):
        target = tmp_path / "gone.pdf"
        target.write_bytes(b"%PDF-1.4 stub")
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(target))

        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            result = delete_record(db, Book, row)
            assert result["file_deleted"] is True
            assert not target.exists()
            assert db.query(Book).filter_by(id=book.id).first() is None
        finally:
            db.close()

    def test_bookmarked_book_deletes_without_integrity_error(self, admin_id, tmp_path):
        """The regression: PRAGMA foreign_keys=ON + a bookmark used to 500."""
        target = tmp_path / "bookmarked.pdf"
        target.write_bytes(b"%PDF-1.4 stub")
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(target))

        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=admin_id, book_id=book.id, page_number=7))
            db.commit()

            row = db.query(Book).filter_by(id=book.id).first()
            delete_record(db, Book, row)

            assert db.query(Book).filter_by(id=book.id).first() is None
            assert db.query(Bookmark).filter_by(book_id=book.id).count() == 0
        finally:
            db.close()

    def test_keeps_file_when_asked(self, tmp_path):
        target = tmp_path / "keep.pdf"
        target.write_bytes(b"%PDF-1.4 stub")
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(target))

        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            result = delete_record(db, Book, row, delete_file=False)
            assert result["file_deleted"] is False
            assert target.exists()
            assert db.query(Book).filter_by(id=book.id).first() is None
        finally:
            db.close()

    def test_missing_file_still_deletes_the_row(self, tmp_path):
        """A duplicate whose file a rescan already lost must still be cleanable."""
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(tmp_path / "never-existed.pdf"))

        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            result = delete_record(db, Book, row)
            assert result["file_deleted"] is False
            assert db.query(Book).filter_by(id=book.id).first() is None
        finally:
            db.close()

    def test_deletes_sidecars_alongside_the_file(self, tmp_path):
        target = tmp_path / "withsidecar.pdf"
        target.write_bytes(b"%PDF-1.4 stub")
        sidecar = tmp_path / "withsidecar.opf"
        sidecar.write_text("<package/>")
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(target))

        db = SessionLocal()
        try:
            row = db.query(Book).filter_by(id=book.id).first()
            delete_record(db, Book, row)
            assert not target.exists()
            assert not sidecar.exists()
        finally:
            db.close()

    def test_read_only_mount_rolls_back(self, tmp_path, monkeypatch):
        target = tmp_path / "readonly.pdf"
        target.write_bytes(b"%PDF-1.4 stub")
        system = make_game_system()
        book = make_book(system_id=system.id, filepath=str(target))

        def _erofs(self, *a, **kw):
            raise OSError(30, "Read-only file system")

        monkeypatch.setattr(Path, "unlink", _erofs)

        db = SessionLocal()
        try:
            from backend.services.library_fs.constants import LibraryFSError

            row = db.query(Book).filter_by(id=book.id).first()
            with pytest.raises(LibraryFSError) as exc:
                delete_record(db, Book, row)
            assert exc.value.code == "read_only"
            db.rollback()
            # The row survived, because nothing was committed.
            assert db.query(Book).filter_by(id=book.id).first() is not None
        finally:
            db.close()


class TestBatchedReferenceCounts:
    """``reference_counts_for`` must agree with ``reference_counts``, per record.

    The duplicate listing switched to the batched form to avoid four COUNT
    queries per member; the counts it reports are what a user decides a deletion
    on, so "same answer, fewer queries" is the whole contract.
    """

    def test_matches_the_single_record_function(self, admin_id):
        system = make_game_system()
        loaded = make_book(system_id=system.id)
        bare = make_book(system_id=system.id)
        campaign = make_campaign(owner_id=admin_id)

        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=admin_id, book_id=loaded.id, page_number=1))
            _attach_all(db, "book", loaded.id, admin_id, campaign.id)
            db.commit()

            batched = reference_counts_for(db, Book, [loaded.id, bare.id])
            assert batched[loaded.id] == reference_counts(db, Book, loaded.id)
            assert batched[bare.id] == reference_counts(db, Book, bare.id)
            # A record with nothing pointing at it reports explicit zeros rather
            # than dropping out of the result.
            assert batched[bare.id] == {
                "favorites": 0,
                "tags": 0,
                "campaigns": 0,
                "bookmarks": 0,
            }
        finally:
            db.close()

    def test_counts_are_not_shared_between_records(self, admin_id):
        """The bug a batched rewrite invites: one record's counts on everyone."""
        system = make_game_system()
        a = make_book(system_id=system.id)
        b = make_book(system_id=system.id)
        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=admin_id, book_id=a.id, page_number=1))
            db.add(Bookmark(user_id=admin_id, book_id=a.id, page_number=2))
            db.commit()

            counts = reference_counts_for(db, Book, [a.id, b.id])
            assert counts[a.id]["bookmarks"] == 2
            assert counts[b.id]["bookmarks"] == 0
        finally:
            db.close()

    def test_media_models_have_no_bookmark_key(self):
        m = make_map()
        db = SessionLocal()
        try:
            counts = reference_counts_for(db, GenericMap, [m.id])
            assert "bookmarks" not in counts[m.id]
            assert counts[m.id] == reference_counts(db, GenericMap, m.id)
        finally:
            db.close()

    def test_unknown_model_and_empty_input(self):
        class Nope:
            pass

        db = SessionLocal()
        try:
            assert reference_counts_for(db, Nope, ["x"]) == {"x": {}}
            assert reference_counts_for(db, Book, []) == {}
        finally:
            db.close()
