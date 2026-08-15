"""Content-hash change detection, cache invalidation, and move detection.

Covers the three behaviours that depend on hashing library files:

* a file replaced in place is noticed and everything derived from its old bytes
  is thrown away (the bug this feature exists to fix),
* a file that merely moved is recognised as the same item rather than being
  re-added from scratch (issue #284), and
* an unchanged rescan still reads **no** file content — the property that keeps a
  rescan of a large library affordable.
"""
from __future__ import annotations

import os
import tempfile
import time
from pathlib import Path
from unittest.mock import patch

from backend.config import SessionLocal
from backend.indexer import hashing, scan_library
from backend.models import Book, GameSystem, Token


def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _scan(lib: Path, tmp: str, db) -> dict:
    """Run a scan with thumbnail generation stubbed out (no real PDFs here)."""
    with patch("backend.indexer.generate_thumbnail", return_value=False):
        return scan_library(str(lib), tmp, db)


def _touch_future(path: Path) -> None:
    """Bump mtime so the stat gate opens, without relying on clock resolution."""
    stamp = time.time() + 10
    os.utime(path, (stamp, stamp))


class TestHashFile:
    def test_hashes_contents_not_path(self):
        tmp, lib = _mk_lib()
        a, b = lib / "a.bin", lib / "b.bin"
        a.write_bytes(b"same")
        b.write_bytes(b"same")
        assert hashing.hash_file(str(a)) == hashing.hash_file(str(b))

    def test_differs_when_contents_differ(self):
        tmp, lib = _mk_lib()
        a, b = lib / "a.bin", lib / "b.bin"
        a.write_bytes(b"one")
        b.write_bytes(b"two")
        assert hashing.hash_file(str(a)) != hashing.hash_file(str(b))

    def test_chunked_read_matches_single_read(self):
        """A tiny chunk size must not change the digest (streaming correctness)."""
        tmp, lib = _mk_lib()
        f = lib / "big.bin"
        f.write_bytes(b"abcdefghij" * 500)
        assert hashing.hash_file(str(f), chunk_size=7) == hashing.hash_file(str(f))

    def test_returns_none_for_unreadable_file(self):
        assert hashing.hash_file("/nonexistent/nope.bin") is None

    def test_cancels_midway(self):
        """A stop request abandons the read rather than finishing a huge file."""
        tmp, lib = _mk_lib()
        f = lib / "big.bin"
        f.write_bytes(b"x" * 4096)
        assert hashing.hash_file(str(f), should_stop=lambda: True, chunk_size=8) is None

    def test_file_signature_returns_none_when_missing(self):
        assert hashing.file_signature("/nonexistent/nope.bin") is None


class TestBackfillIsNotAChange:
    """A row with no stored hash must not be treated as replaced.

    This is the upgrade path: every pre-existing book has content_hash NULL, and
    reporting those as changed would re-render an entire library on first scan.
    """

    def test_null_hash_never_reports_changed(self):
        book = Book(title="t", filename="f", filepath="/f", relative_path="f")
        book.content_hash = None
        assert hashing.changed_content(book, "abc123") is False

    def test_missing_digest_never_reports_changed(self):
        book = Book(title="t", filename="f", filepath="/f", relative_path="f")
        book.content_hash = "abc123"
        # hash_file returned None (unreadable / cancelled) — nothing to compare.
        assert hashing.changed_content(book, None) is False

    def test_real_difference_reports_changed(self):
        book = Book(title="t", filename="f", filepath="/f", relative_path="f")
        book.content_hash = "abc123"
        assert hashing.changed_content(book, "def456") is True

    def test_apply_signature_keeps_hash_when_digest_is_none(self):
        book = Book(title="t", filename="f", filepath="/f", relative_path="f")
        book.content_hash = "keepme"
        hashing.apply_signature(book, 123.0, 45, None)
        assert book.content_hash == "keepme"
        assert book.file_mtime == 123.0
        assert book.file_size == 45


class TestScanRecordsSignature:
    def test_new_book_is_hashed_on_insert(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        f = d / "tome.pdf"
        f.write_bytes(b"%PDF-1.4 original")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            assert book is not None
            assert book.content_hash == hashing.hash_file(str(f))
            assert book.file_mtime is not None
            assert book.file_size == len(b"%PDF-1.4 original")
        finally:
            db.close()


class TestUnchangedRescanReadsNothing:
    """The performance guard.

    An unchanged rescan must not hash anything. Without this assertion, someone
    could move the hash outside the (mtime, size) gate and turn every scheduled
    rescan into a full read of the entire library — correct, but unusably slow,
    and nothing else in the suite would notice.
    """

    def test_rescan_of_unchanged_library_hashes_nothing(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        for i in range(4):
            (d / f"book{i}.pdf").write_bytes(f"%PDF-1.4 content {i}".encode())

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)  # first scan hashes each file once

            calls: list[str] = []
            real = hashing.hash_file

            def counting_hash(path, *a, **kw):
                calls.append(path)
                return real(path, *a, **kw)

            with patch("backend.indexer.scan.hash_file", side_effect=counting_hash):
                _scan(lib, tmp, db)

            assert calls == [], f"unchanged rescan hashed {len(calls)} file(s): {calls}"
        finally:
            db.close()

    def test_touch_without_edit_hashes_but_does_not_reindex(self):
        """A changed mtime costs one hash; an identical digest changes nothing."""
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        f = d / "tome.pdf"
        f.write_bytes(b"%PDF-1.4 stable")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            book.indexed = True
            book.has_thumbnail = True
            book.page_count = 7
            db.commit()

            _touch_future(f)
            stats = _scan(lib, tmp, db)

            db.refresh(book)
            assert stats.get("replaced_books", 0) == 0
            # Still considered fully indexed — no work was redone.
            assert book.indexed is True
            assert book.page_count == 7
        finally:
            db.close()


class TestReplacedFileIsReindexed:
    """The reported bug: same filename, new bytes, stale everything."""

    def test_replacement_resets_the_book_for_reprocessing(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        f = d / "tome.pdf"
        f.write_bytes(b"%PDF-1.4 low quality scan")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            original_id = book.id
            original_hash = book.content_hash
            book.indexed = True
            book.has_thumbnail = True
            book.page_count = 100
            db.commit()

            # Replace in place, exactly as the user did.
            f.write_bytes(b"%PDF-1.4 a much better quality version of the same book")
            _touch_future(f)

            with patch("backend.services.content_cache.invalidate_book_content") as inval:
                stats = _scan(lib, tmp, db)

            db.refresh(book)
            assert stats.get("replaced_books", 0) == 1
            # Same row (tags/favorites/progress survive), new contents.
            assert book.id == original_id
            assert book.content_hash != original_hash
            assert book.content_hash == hashing.hash_file(str(f))
            # Flags reset so the normal phases rebuild the derived data.
            assert book.indexed is False
            assert book.has_thumbnail is False
            assert book.page_count == 0
            assert inval.called
        finally:
            db.close()

    def test_caches_are_invalidated_for_the_replaced_book(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        f = d / "tome.pdf"
        f.write_bytes(b"%PDF-1.4 first")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            book_id = book.id

            f.write_bytes(b"%PDF-1.4 second, different length")
            _touch_future(f)

            with patch("backend.services.content_cache.invalidate_book_content") as inval:
                _scan(lib, tmp, db)

            assert inval.call_count == 1
            args, kwargs = inval.call_args
            assert args[0] == book_id
            assert args[1] == str(f)
        finally:
            db.close()


class TestMoveDetection:
    """Issue #284 — a moved file keeps its row, and everything attached to it."""

    def test_moved_book_keeps_its_row(self):
        tmp, lib = _mk_lib()
        src = lib / "books" / "OldSystem" / "core"
        src.mkdir(parents=True)
        f = src / "tome.pdf"
        f.write_bytes(b"%PDF-1.4 a book that will be filed elsewhere")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            original_id = book.id
            original_hash = book.content_hash

            dest = lib / "books" / "NewSystem" / "core"
            dest.mkdir(parents=True)
            moved_to = dest / "tome.pdf"
            f.rename(moved_to)

            stats = _scan(lib, tmp, db)

            assert stats.get("moved_books", 0) == 1
            survivor = db.query(Book).filter_by(id=original_id).first()
            assert survivor is not None
            assert survivor.filepath == str(moved_to)
            assert survivor.is_missing is False
            assert survivor.content_hash == original_hash
            # Exactly one row for this content — the duplicate was removed.
            assert db.query(Book).filter_by(content_hash=original_hash).count() == 1
        finally:
            db.close()

    def test_moved_token_keeps_its_row(self):
        tmp, lib = _mk_lib()
        src = lib / "tokens" / "Old"
        src.mkdir(parents=True)
        f = src / "goblin.png"
        f.write_bytes(b"\x89PNG token-move-detection-fixture")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            tok = db.query(Token).filter_by(filepath=str(f)).first()
            original_id = tok.id

            dest = lib / "tokens" / "New"
            dest.mkdir(parents=True)
            moved_to = dest / "goblin.png"
            f.rename(moved_to)

            stats = _scan(lib, tmp, db)

            assert stats.get("moved_tokens", 0) == 1
            survivor = db.query(Token).filter_by(id=original_id).first()
            assert survivor is not None
            assert survivor.filepath == str(moved_to)
            assert survivor.is_missing is False
        finally:
            db.close()

    def test_ambiguous_duplicates_are_left_alone(self):
        """Identical files moved together are indistinguishable — don't guess.

        Two gone and two arrived with the same bytes: there is no way to tell
        which became which, and pairing them arbitrarily would attach one book's
        tags and progress to the other. Fall back to missing/new instead.
        """
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        same = b"%PDF-1.4 byte-for-byte identical duplicate"
        (d / "copy_a.pdf").write_bytes(same)
        (d / "copy_b.pdf").write_bytes(same)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            digest = hashing.hash_file(str(d / "copy_a.pdf"))
            assert db.query(Book).filter_by(content_hash=digest).count() == 2

            # Both originals vanish and two fresh copies appear elsewhere.
            (d / "copy_a.pdf").unlink()
            (d / "copy_b.pdf").unlink()
            other = lib / "books" / "Sys" / "adventure"
            other.mkdir(parents=True)
            (other / "copy_c.pdf").write_bytes(same)
            (other / "copy_d.pdf").write_bytes(same)

            stats = _scan(lib, tmp, db)

            assert stats.get("moved_books", 0) == 0
            # Both originals are reported missing, not paired off by guesswork.
            for name in ("copy_a.pdf", "copy_b.pdf"):
                row = db.query(Book).filter_by(filepath=str(d / name)).first()
                assert row is not None
                assert row.is_missing is True
        finally:
            db.close()

    def test_single_duplicate_moving_is_still_recognised(self):
        """One gone, one newly arrived — unambiguous even though a twin exists.

        The surviving twin is excluded as a destination because it is not a new
        row, which leaves exactly one candidate and makes the match safe.
        """
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        same = b"%PDF-1.4 one of a matched pair"
        (d / "copy_a.pdf").write_bytes(same)
        (d / "copy_b.pdf").write_bytes(same)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            a_id = db.query(Book).filter_by(filepath=str(d / "copy_a.pdf")).first().id
            b_id = db.query(Book).filter_by(filepath=str(d / "copy_b.pdf")).first().id

            (d / "copy_a.pdf").unlink()
            other = lib / "books" / "Sys" / "adventure"
            other.mkdir(parents=True)
            moved_to = other / "copy_a.pdf"
            moved_to.write_bytes(same)

            stats = _scan(lib, tmp, db)

            assert stats.get("moved_books", 0) == 1
            survivor = db.query(Book).filter_by(id=a_id).first()
            assert survivor.filepath == str(moved_to)
            assert survivor.is_missing is False
            # The untouched twin is left exactly where it was.
            twin = db.query(Book).filter_by(id=b_id).first()
            assert twin is not None
            assert twin.filepath == str(d / "copy_b.pdf")
        finally:
            db.close()

    def test_plain_deletion_is_still_reported_missing(self):
        """No new file to match means this is a real deletion, not a move."""
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        f = d / "gone.pdf"
        f.write_bytes(b"%PDF-1.4 this one really is deleted")

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            f.unlink()

            stats = _scan(lib, tmp, db)

            assert stats.get("moved_books", 0) == 0
            assert stats.get("missing_books", 0) == 1
            db.refresh(book)
            assert book.is_missing is True
        finally:
            db.close()


class TestMovedBookMetadataFollows:
    """A move across systems must re-derive everything the path implies.

    The row survives (that is ``TestMoveDetection``), but it also has to stop
    describing where it used to live: system, edition, slug, and category are all
    inferred from the folder structure, so a book dragged from one edition shelf
    to another must come out the far side looking like it was always there.
    """

    def _system_of(self, db, book):
        return db.query(GameSystem).filter_by(id=book.game_system_id).first()

    def test_move_between_editions_of_a_parent_container(self):
        """The reported shape: D&D/3e/unsorted -> D&D/5e/adventures/<name>/."""
        tmp, lib = _mk_lib()
        container = lib / "books" / "MetaDnD"
        (container / "3e" / "unsorted").mkdir(parents=True)
        (container / ".parent-system-container").write_text("")
        f = container / "3e" / "unsorted" / "strahd.pdf"
        f.write_bytes(b"%PDF-1.4 " + b"strahd-payload" * 40)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            original_id = book.id
            before = self._system_of(db, book)
            assert before.edition == "3e"
            assert book.category == "unsorted"

            dest = container / "5e" / "adventures" / "Curse of Strahd"
            dest.mkdir(parents=True)
            moved_to = dest / "strahd.pdf"
            f.rename(moved_to)

            stats = _scan(lib, tmp, db)
            assert stats.get("moved_books", 0) == 1

            survivor = db.query(Book).filter_by(id=original_id).first()
            after = self._system_of(db, survivor)
            # Same row — tags, favorites, and progress ride along.
            assert survivor.id == original_id
            assert survivor.is_missing is False
            # …but every folder-derived field now describes the new location.
            assert after.id != before.id
            assert after.edition == "5e"
            assert after.slug.endswith("--5e")
            assert after.parent_id == before.parent_id, "same container"
            assert survivor.category == "adventure"
            assert survivor.relative_path.replace("\\", "/").startswith("books/MetaDnD/5e/")
        finally:
            db.close()

    def test_move_out_of_a_publisher_container_drops_its_attribution(self):
        """Publisher/family attribution comes from the container, so it must not
        survive a move out to an unaffiliated shelf."""
        tmp, lib = _mk_lib()
        pub = lib / "books" / "MetaPublisher"
        (pub / "MetaAlien" / "core").mkdir(parents=True)
        (pub / ".publisher-container").write_text("")
        f = pub / "MetaAlien" / "core" / "alien.pdf"
        f.write_bytes(b"%PDF-1.4 " + b"alien-payload" * 40)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            original_id = book.id
            before = self._system_of(db, book)
            assert before.publishers and before.publishers[0]["name"] == "MetaPublisher"

            dest = lib / "books" / "MetaHomebrew" / "core"
            dest.mkdir(parents=True)
            f.rename(dest / "alien.pdf")

            _scan(lib, tmp, db)

            survivor = db.query(Book).filter_by(id=original_id).first()
            after = self._system_of(db, survivor)
            assert after.name == "MetaHomebrew"
            assert after.parent_id is None
            assert not after.publishers, "publisher attribution must not follow"
        finally:
            db.close()

    def test_move_into_a_parent_container_gains_the_edition(self):
        """The inverse: a loose system's book filed under an edition shelf."""
        tmp, lib = _mk_lib()
        container = lib / "books" / "MetaPathfinder"
        (container / "2e").mkdir(parents=True)
        (container / ".parent-system-container").write_text("")
        loose = lib / "books" / "MetaLoose" / "core"
        loose.mkdir(parents=True)
        f = loose / "guide.pdf"
        f.write_bytes(b"%PDF-1.4 " + b"guide-payload" * 40)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            book = db.query(Book).filter_by(filepath=str(f)).first()
            original_id = book.id
            assert self._system_of(db, book).edition == ""

            dest = container / "2e" / "core"
            dest.mkdir(parents=True)
            f.rename(dest / "guide.pdf")

            _scan(lib, tmp, db)

            survivor = db.query(Book).filter_by(id=original_id).first()
            after = self._system_of(db, survivor)
            assert survivor.id == original_id
            assert after.edition == "2e"
            assert after.parent_id is not None
            assert after.parent_system == "MetaPathfinder"
        finally:
            db.close()


class TestPreexistingRowIsNotAMoveTarget:
    """A long-standing file must not be claimed as the destination of a move.

    If A and B hold identical bytes and A is deleted, B is still exactly where it
    always was. Treating B as "where A moved to" would rewrite B's row and delete
    it as a duplicate, losing a book that never moved.
    """

    def test_deleting_one_of_two_identical_files_keeps_the_other_intact(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / "Sys" / "core"
        d.mkdir(parents=True)
        same = b"%PDF-1.4 identical twins"
        a, b = d / "a.pdf", d / "b.pdf"
        a.write_bytes(same)
        b.write_bytes(same)

        db = SessionLocal()
        try:
            _scan(lib, tmp, db)
            b_row = db.query(Book).filter_by(filepath=str(b)).first()
            b_id = b_row.id

            a.unlink()
            _scan(lib, tmp, db)

            survivor = db.query(Book).filter_by(id=b_id).first()
            assert survivor is not None, "the untouched file's row was destroyed"
            assert survivor.filepath == str(b), "the untouched file's path was rewritten"
            assert survivor.is_missing is False
        finally:
            db.close()
