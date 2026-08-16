"""Tests for admin-only library file management (issue #302).

The behaviours worth defending here are the ones whose failure is silent: a move
that quietly orphans a book's tags looks identical to a successful move until the
user goes looking for the metadata weeks later. So the relink assertions check
the record *id* survives and the attached rows still resolve, not merely that the
endpoint returned 200.
"""
import os
import uuid
from pathlib import Path

import pytest

from backend.config import SessionLocal, LIBRARY_PATH
from backend.models import Book, GenericMap
from backend.services import library_fs as fs
from backend.services import tag_service

from .conftest import make_book, make_game_system, make_map


LIB = LIBRARY_PATH


@pytest.fixture
def library_tree():
    """A small on-disk library, torn down after each test.

    Uses a unique root per test so the session-scoped DB and the shared library
    directory cannot leak state between cases.
    """
    import shutil

    stamp = str(uuid.uuid4())[:8]
    made = []
    for rel in (
        f"books/System-{stamp}/core",
        f"books/System-{stamp}/adventures",
        f"maps/Battlemaps-{stamp}",
    ):
        path = os.path.join(LIB, rel)
        os.makedirs(path, exist_ok=True)
        made.append(path)
    yield stamp
    for top in (f"books/System-{stamp}", f"maps/Battlemaps-{stamp}"):
        shutil.rmtree(os.path.join(LIB, top), ignore_errors=True)


def _write(rel: str, content: bytes = b"grimoire-test-fixture") -> str:
    """Create a fixture file.

    Deliberately *not* PDF-shaped by default. These tests exercise path and
    record handling, not rendering — but a file starting with ``%PDF`` can be
    picked up by a background indexer worker from another test, which then races
    this fixture's teardown and dies on a file that has already been removed.
    Opaque bytes keep the two from ever meeting.
    """
    path = os.path.join(LIB, rel)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as f:
        f.write(content)
    return path


# ---------------------------------------------------------------------------
# Path safety
# ---------------------------------------------------------------------------


class TestSafeJoin:
    def test_rejects_parent_traversal(self):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.safe_join("books/../../etc/passwd")
        assert exc.value.code == "forbidden"

    def test_rejects_absolute_escape(self):
        with pytest.raises(fs.LibraryFSError):
            fs.safe_join("/etc/passwd")

    def test_rejects_empty(self):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.safe_join("")
        assert exc.value.code == "invalid"

    def test_rejects_null_byte(self):
        with pytest.raises(fs.LibraryFSError):
            fs.safe_join("books/x\x00y")

    def test_accepts_inside_library(self, library_tree):
        result = fs.safe_join(f"books/System-{library_tree}/core")
        assert str(result).startswith(str(fs.library_root()))

    def test_must_exist_raises_not_found(self):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.safe_join("books/nope-does-not-exist", must_exist=True)
        assert exc.value.code == "not_found"

    def test_backslashes_normalised(self, library_tree):
        result = fs.safe_join(f"books\\System-{library_tree}\\core")
        assert result.name == "core"


class TestCollectionOf:
    def test_identifies_books(self, library_tree):
        path = fs.safe_join(f"books/System-{library_tree}/core")
        assert fs.collection_of(path) == "books"

    def test_identifies_maps(self, library_tree):
        path = fs.safe_join(f"maps/Battlemaps-{library_tree}")
        assert fs.collection_of(path) == "maps"

    def test_root_has_no_collection(self):
        assert fs.collection_of(fs.library_root()) is None


# ---------------------------------------------------------------------------
# Moving files — the metadata-preserving relink
# ---------------------------------------------------------------------------


class TestMovePreservesMetadata:
    def test_move_keeps_record_id_and_tags(self, library_tree):
        """The core guarantee: a moved book is the *same row*, tags intact."""
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/bestiary.pdf")
        book = make_book(
            system.id,
            filename="bestiary.pdf",
            filepath=src,
            relative_path=f"books/System-{library_tree}/core/bestiary.pdf",
        )
        db = SessionLocal()
        tag_service.set_resource_tags(db, "book", book.id, ["monsters"])
        db.commit()
        db.close()

        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/bestiary.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()

        assert result.count == 1
        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        assert refreshed is not None, "record id must survive the move"
        assert refreshed.filepath.endswith("adventures/bestiary.pdf")
        assert refreshed.filename == "bestiary.pdf"
        assert "adventures" in refreshed.relative_path
        tags = tag_service.display_tags_for_resource(db, "book", book.id)
        db.close()
        assert "monsters" in tags, "tags must follow the book"
        assert os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/adventures/bestiary.pdf")
        )
        assert not os.path.exists(src)

    def test_move_recategorises_book(self, library_tree):
        """Category is re-derived from the destination, as a rescan would."""
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/module.pdf")
        book = make_book(
            system.id,
            filepath=src,
            filename="module.pdf",
            relative_path=f"books/System-{library_tree}/core/module.pdf",
            category="core",
        )
        db = SessionLocal()
        fs.move_paths(
            db, [f"books/System-{library_tree}/core/module.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()

        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        category = refreshed.category
        db.close()
        # "adventures/" maps onto the canonical `adventure` category slug, the
        # same value a rescan would derive for that folder.
        assert category == "adventure"

    def test_move_clears_missing_flag(self, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/found.pdf")
        book = make_book(
            system.id, filepath=src, filename="found.pdf",
            relative_path=f"books/System-{library_tree}/core/found.pdf",
            is_missing=True,
        )
        db = SessionLocal()
        fs.move_paths(
            db, [f"books/System-{library_tree}/core/found.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        db.close()
        # Asserted separately so a missing row reports itself rather than raising
        # an AttributeError on `None.is_missing`.
        assert refreshed is not None, "the moved book's row must still exist"
        assert refreshed.is_missing is False

    def test_move_map_relinks(self, library_tree):
        src = _write(f"maps/Battlemaps-{library_tree}/tavern.png", b"\x89PNG")
        os.makedirs(os.path.join(LIB, f"maps/Battlemaps-{library_tree}/indoor"), exist_ok=True)
        m = make_map(
            filepath=src, filename="tavern.png",
            relative_path=f"maps/Battlemaps-{library_tree}/tavern.png",
        )
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"maps/Battlemaps-{library_tree}/tavern.png"],
            f"maps/Battlemaps-{library_tree}/indoor",
        )
        db.close()
        assert result.count == 1
        db = SessionLocal()
        refreshed = db.query(GenericMap).filter(GenericMap.id == m.id).first()
        assert refreshed.filepath.endswith("indoor/tavern.png")
        db.close()

    def test_move_folder_relinks_contents(self, library_tree):
        """Dragging a whole category must relink every book inside it."""
        system = make_game_system(name=f"System-{library_tree}")
        os.makedirs(os.path.join(LIB, f"books/System-{library_tree}/box"), exist_ok=True)
        src = _write(f"books/System-{library_tree}/box/inner.pdf")
        book = make_book(
            system.id, filepath=src, filename="inner.pdf",
            relative_path=f"books/System-{library_tree}/box/inner.pdf",
        )
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/box"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        assert result.count == 1
        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        db.close()
        assert "adventures/box/inner.pdf" in refreshed.filepath.replace("\\", "/")

    def test_unindexed_file_still_moves(self, library_tree):
        """A loose sidecar has no row to relink, but must still move."""
        _write(f"books/System-{library_tree}/core/notes.txt", b"hi")
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/notes.txt"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        assert result.count == 1
        assert os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/adventures/notes.txt")
        )


class TestMoveConflicts:
    def test_conflict_is_skipped_not_overwritten(self, library_tree):
        _write(f"books/System-{library_tree}/core/dup.pdf", b"original")
        _write(f"books/System-{library_tree}/adventures/dup.pdf", b"existing")
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/dup.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        assert result.count == 0
        assert result.skipped[0]["code"] == "conflict"
        with open(os.path.join(LIB, f"books/System-{library_tree}/adventures/dup.pdf"), "rb") as f:
            assert f.read() == b"existing", "must never overwrite"

    def test_rename_policy_suffixes(self, library_tree):
        _write(f"books/System-{library_tree}/core/dup2.pdf", b"original")
        _write(f"books/System-{library_tree}/adventures/dup2.pdf", b"existing")
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/dup2.pdf"],
            f"books/System-{library_tree}/adventures",
            on_conflict="rename",
        )
        db.close()
        assert result.count == 1
        assert os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/adventures/dup2 (2).pdf")
        )

    def test_folder_into_itself_refused(self, library_tree):
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}"], f"books/System-{library_tree}/core"
        )
        db.close()
        assert result.count == 0
        assert result.skipped[0]["code"] == "invalid"

    def test_move_into_same_folder_is_noop(self, library_tree):
        _write(f"books/System-{library_tree}/core/stay.pdf")
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/stay.pdf"],
            f"books/System-{library_tree}/core",
        )
        db.close()
        assert result.count == 0
        assert result.skipped[0]["code"] == "noop"

    def test_traversal_source_rejected(self, library_tree):
        db = SessionLocal()
        result = fs.move_paths(
            db, ["../../etc/passwd"], f"books/System-{library_tree}/core"
        )
        db.close()
        assert result.count == 0
        assert result.skipped[0]["code"] == "forbidden"


# ---------------------------------------------------------------------------
# Rename
# ---------------------------------------------------------------------------


class TestRename:
    def test_rename_file_keeps_record(self, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/typo.pdf")
        book = make_book(
            system.id, filepath=src, filename="typo.pdf",
            relative_path=f"books/System-{library_tree}/core/typo.pdf",
        )
        db = SessionLocal()
        result = fs.rename_path(db, f"books/System-{library_tree}/core/typo.pdf", "fixed.pdf")
        db.close()
        assert result["records"] == 1
        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        db.close()
        assert refreshed.filename == "fixed.pdf"
        assert refreshed.filepath.endswith("fixed.pdf")

    def test_rename_folder_relinks_children(self, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/child.pdf")
        book = make_book(
            system.id, filepath=src, filename="child.pdf",
            relative_path=f"books/System-{library_tree}/core/child.pdf",
        )
        db = SessionLocal()
        fs.rename_path(db, f"books/System-{library_tree}/core", "rulebooks")
        db.close()
        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        db.close()
        assert "rulebooks/child.pdf" in refreshed.filepath.replace("\\", "/")

    def test_rename_rejects_path_separator(self, library_tree):
        _write(f"books/System-{library_tree}/core/a.pdf")
        db = SessionLocal()
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.rename_path(db, f"books/System-{library_tree}/core/a.pdf", "../escape.pdf")
        db.close()
        assert exc.value.code == "invalid"

    def test_rename_conflict_refused(self, library_tree):
        _write(f"books/System-{library_tree}/core/one.pdf")
        _write(f"books/System-{library_tree}/core/two.pdf")
        db = SessionLocal()
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.rename_path(db, f"books/System-{library_tree}/core/one.pdf", "two.pdf")
        db.close()
        assert exc.value.code == "conflict"

    def test_rename_to_same_name_is_noop(self, library_tree):
        _write(f"books/System-{library_tree}/core/same.pdf")
        db = SessionLocal()
        result = fs.rename_path(db, f"books/System-{library_tree}/core/same.pdf", "same.pdf")
        db.close()
        assert result["records"] == 0


# ---------------------------------------------------------------------------
# Folder creation and markers
# ---------------------------------------------------------------------------


class TestCreateFolder:
    def test_creates_plain_folder(self, library_tree):
        result = fs.create_folder(f"books/System-{library_tree}", "supplements")
        assert result["name"] == "supplements"
        assert os.path.isdir(os.path.join(LIB, f"books/System-{library_tree}/supplements"))

    def test_writes_container_marker(self, library_tree):
        fs.create_folder("books", f"Family-{library_tree}", container_kind="parent")
        marker = os.path.join(LIB, "books", f"Family-{library_tree}", ".parent-system-container")
        assert os.path.exists(marker), "container marker must be written"
        import shutil

        shutil.rmtree(os.path.join(LIB, "books", f"Family-{library_tree}"), ignore_errors=True)

    def test_writes_nsfw_marker(self, library_tree):
        fs.create_folder(f"books/System-{library_tree}", "mature", nsfw=True)
        assert os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/mature/.nsfw")
        )

    def test_rejects_unknown_container_kind(self, library_tree):
        with pytest.raises(fs.LibraryFSError):
            fs.create_folder(f"books/System-{library_tree}", "x", container_kind="bogus")

    def test_rejects_existing(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.create_folder(f"books/System-{library_tree}", "core")
        assert exc.value.code == "conflict"

    def test_rejects_separator_in_name(self, library_tree):
        with pytest.raises(fs.LibraryFSError):
            fs.create_folder(f"books/System-{library_tree}", "a/b")


class TestThumbnails:
    """A move must carry the thumbnail across, since nothing else regenerates it."""

    def test_thumbnail_follows_the_file(self, library_tree):
        import hashlib

        from backend.config import THUMB_DIR

        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/thumbed.pdf")
        book = make_book(
            system.id, title="Thumbed", filepath=src, filename="thumbed.pdf",
            relative_path=f"books/System-{library_tree}/core/thumbed.pdf",
            has_thumbnail=True,
        )
        # Lay down the thumbnail exactly where the scanner would have put it.
        old_thumb = os.path.join(
            THUMB_DIR, "books",
            f"thumbed_{hashlib.md5(src.encode()).hexdigest()[:8]}.webp",
        )
        os.makedirs(os.path.dirname(old_thumb), exist_ok=True)
        with open(old_thumb, "wb") as f:
            f.write(b"webp")

        db = SessionLocal()
        fs.move_paths(
            db, [f"books/System-{library_tree}/core/thumbed.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()

        db = SessionLocal()
        refreshed = db.query(Book).filter(Book.id == book.id).first()
        new_path, still_has = refreshed.filepath, refreshed.has_thumbnail
        db.close()
        new_thumb = os.path.join(
            THUMB_DIR, "books",
            f"thumbed_{hashlib.md5(new_path.encode()).hexdigest()[:8]}.webp",
        )
        assert still_has is True
        assert os.path.exists(new_thumb), "thumbnail must be re-homed under the new key"
        assert not os.path.exists(old_thumb)

    def test_missing_thumbnail_clears_flag(self, library_tree):
        """A thumbnail that cannot be moved degrades to a re-render, not a broken image."""
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/nothumb.pdf")
        book = make_book(
            system.id, title="NoThumb", filepath=src, filename="nothumb.pdf",
            relative_path=f"books/System-{library_tree}/core/nothumb.pdf",
            has_thumbnail=True,  # flag set, but no file on disk
        )
        db = SessionLocal()
        fs.move_paths(
            db, [f"books/System-{library_tree}/core/nothumb.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        db = SessionLocal()
        assert db.query(Book).filter(Book.id == book.id).first().has_thumbnail is False
        db.close()


class TestFailureSafety:
    def test_indexed_move_rollback_restores_file(self, library_tree, monkeypatch):
        """If the relink fails, the file must return to where it started.

        A move that leaves the file at the destination while the DB still points
        at the source is exactly the split-brain state this feature exists to
        avoid, so the disk is reverted rather than left ahead of the DB.
        """
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/rb2.pdf")
        make_book(
            system.id, filepath=src, filename="rb2.pdf",
            relative_path=f"books/System-{library_tree}/core/rb2.pdf",
        )
        monkeypatch.setattr(
            fs, "_relink", lambda *a, **k: (_ for _ in ()).throw(RuntimeError("boom"))
        )
        db = SessionLocal()
        with pytest.raises(RuntimeError):
            fs._move_one(
                db,
                fs.safe_join(f"books/System-{library_tree}/core/rb2.pdf"),
                fs.safe_join(f"books/System-{library_tree}/adventures"),
                "skip",
                fs.MoveResult(),
            )
        db.close()
        assert os.path.exists(src), "file must be restored after a failed relink"

    def test_cross_filesystem_move_falls_back_to_copy(self, library_tree, monkeypatch):
        """EXDEV (separate mounts) must fall back to shutil.move, not fail."""
        _write(f"books/System-{library_tree}/core/xdev.pdf")
        real_replace = os.replace
        calls = {"n": 0}

        def fake_replace(a, b):
            calls["n"] += 1
            if calls["n"] == 1:
                raise OSError(18, "Invalid cross-device link")
            return real_replace(a, b)

        monkeypatch.setattr(os, "replace", fake_replace)
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/xdev.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        assert result.count == 1
        assert os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/adventures/xdev.pdf")
        )

    def test_readonly_move_reports_read_only(self, library_tree, monkeypatch):
        _write(f"books/System-{library_tree}/core/ro.pdf")
        monkeypatch.setattr(
            os, "replace", lambda *a: (_ for _ in ()).throw(OSError(30, "Read-only fs"))
        )
        db = SessionLocal()
        result = fs.move_paths(
            db, [f"books/System-{library_tree}/core/ro.pdf"],
            f"books/System-{library_tree}/adventures",
        )
        db.close()
        assert result.skipped[0]["code"] == "read_only"


class TestBookPlacement:
    def test_book_outside_system_folder_is_uncategorised(self, library_tree):
        db = SessionLocal()
        system_id, category = fs.resolve_book_placement(
            db, fs.safe_join("books/loose.pdf")
        )
        db.close()
        assert system_id is None
        assert category == "uncategorized"

    def test_unknown_system_leaves_system_unset(self, library_tree):
        db = SessionLocal()
        system_id, _ = fs.resolve_book_placement(
            db, fs.safe_join("books/Never-Seen-System/core/x.pdf")
        )
        db.close()
        assert system_id is None

    def test_move_to_unknown_system_keeps_existing_system(self, library_tree):
        """A book moved somewhere unrecognised keeps its system, not orphaned."""
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/keepsys.pdf")
        book = make_book(
            system.id, filepath=src, filename="keepsys.pdf",
            relative_path=f"books/System-{library_tree}/core/keepsys.pdf",
        )
        os.makedirs(os.path.join(LIB, f"books/Unregistered-{library_tree}"), exist_ok=True)
        db = SessionLocal()
        fs.move_paths(
            db, [f"books/System-{library_tree}/core/keepsys.pdf"],
            f"books/Unregistered-{library_tree}",
        )
        db.close()
        db = SessionLocal()
        assert db.query(Book).filter(Book.id == book.id).first().game_system_id == system.id
        db.close()
        import shutil

        shutil.rmtree(os.path.join(LIB, f"books/Unregistered-{library_tree}"), ignore_errors=True)


class TestMarkers:
    def test_set_and_clear_nsfw(self, library_tree):
        rel = f"books/System-{library_tree}/core"
        result = fs.set_folder_markers(rel, nsfw=True)
        assert result["nsfw"] is True
        result = fs.set_folder_markers(rel, nsfw=False)
        assert result["nsfw"] is False

    def test_container_kinds_are_exclusive(self, library_tree):
        rel = f"books/System-{library_tree}/adventures"
        fs.set_folder_markers(rel, container_kind="parent")
        result = fs.set_folder_markers(rel, container_kind="publisher")
        assert result["container_kind"] == "publisher"
        assert not os.path.exists(os.path.join(LIB, rel, ".parent-system-container"))

    def test_clear_container_kind(self, library_tree):
        rel = f"books/System-{library_tree}/core"
        fs.set_folder_markers(rel, container_kind="family")
        result = fs.set_folder_markers(rel, container_kind="")
        assert result["container_kind"] == ""


class TestSingletonContainers:
    """One-of-a-kind collections can only be claimed by one folder."""

    def test_second_one_page_collection_refused(self, library_tree):
        fs.create_folder("books", f"OnePage-{library_tree}", container_kind="one-page")
        try:
            fs.create_folder("books", f"AlsoOnePage-{library_tree}", container_kind="one-page")
            raise AssertionError("expected a conflict")
        except fs.LibraryFSError as e:
            assert e.code == "conflict"
            # The message must name the incumbent, or the user has no idea what
            # to change.
            assert f"OnePage-{library_tree}" in e.message
        finally:
            import shutil

            shutil.rmtree(os.path.join(LIB, "books", f"OnePage-{library_tree}"), ignore_errors=True)

    def test_second_agnostic_collection_refused(self, library_tree):
        import shutil

        fs.create_folder("books", f"Agn-{library_tree}", container_kind="agnostic")
        try:
            with pytest.raises(fs.LibraryFSError) as exc:
                fs.set_folder_markers(
                    f"books/System-{library_tree}", container_kind="agnostic"
                )
            assert exc.value.code == "conflict"
        finally:
            shutil.rmtree(os.path.join(LIB, "books", f"Agn-{library_tree}"), ignore_errors=True)

    def test_a_folder_can_keep_its_own_singleton_kind(self, library_tree):
        """Re-applying the kind a folder already has is not a conflict."""
        import shutil

        rel = f"books/OnePageKeep-{library_tree}"
        fs.create_folder("books", f"OnePageKeep-{library_tree}", container_kind="one-page")
        try:
            result = fs.set_folder_markers(rel, container_kind="one-page")
            assert result["container_kind"] == "one-page"
        finally:
            shutil.rmtree(os.path.join(LIB, rel), ignore_errors=True)

    def test_reserved_slug_counts_as_the_incumbent(self, library_tree):
        """A folder merely *named* by the convention already claims the kind."""
        import shutil

        os.makedirs(os.path.join(LIB, "books", "one-page-rpgs"), exist_ok=True)
        try:
            assert fs.find_singleton_container("one-page") == "books/one-page-rpgs"
            with pytest.raises(fs.LibraryFSError):
                fs.set_folder_markers(
                    f"books/System-{library_tree}", container_kind="one-page"
                )
        finally:
            shutil.rmtree(os.path.join(LIB, "books", "one-page-rpgs"), ignore_errors=True)

    def test_repeatable_kinds_are_unaffected(self, library_tree):
        """Publishers, families and parent systems can legitimately repeat."""
        import shutil

        fs.create_folder("books", f"Pub1-{library_tree}", container_kind="publisher")
        fs.create_folder("books", f"Pub2-{library_tree}", container_kind="publisher")
        try:
            assert os.path.exists(
                os.path.join(LIB, "books", f"Pub2-{library_tree}", ".publisher-container")
            )
        finally:
            for n in (f"Pub1-{library_tree}", f"Pub2-{library_tree}"):
                shutil.rmtree(os.path.join(LIB, "books", n), ignore_errors=True)

    def test_singletons_reported_in_browse(self, client, admin_headers, library_tree):
        import shutil

        fs.create_folder("books", f"OP-{library_tree}", container_kind="one-page")
        try:
            resp = client.get("/api/files/browse", headers=admin_headers, params={"path": "books"})
            taken = resp.json()["singletons_taken"]
            assert taken.get("one-page") == f"books/OP-{library_tree}"
        finally:
            shutil.rmtree(os.path.join(LIB, "books", f"OP-{library_tree}"), ignore_errors=True)


class TestScaffoldCategories:
    def test_creates_the_standard_folders(self, library_tree):
        """Every standard category ends up covered, once.

        The fixture already ships lowercase ``core``/``adventures``, so those two
        are reported as existing under their real names rather than being
        duplicated as "Core"/"Adventures".
        """
        from backend.indexer.categories import guess_category

        base = f"books/System-{library_tree}"
        result = fs.scaffold_categories(base)

        covered = set()
        for name in result["created"] + result["existing"]:
            covered.add(guess_category(f"{base}/{name}/x.pdf"))
        wanted = {
            guess_category(f"{base}/{n}/x.pdf") for n in fs.SCAFFOLD_CATEGORY_FOLDERS
        }
        assert wanted <= covered
        assert "core" in covered and "adventure" in covered
        # The pre-existing lowercase folders were reused, not duplicated. Checked
        # against the real directory listing rather than os.path.isdir, which
        # cannot tell "Core" from "core" on a case-insensitive filesystem.
        assert "core" in result["existing"]
        on_disk = os.listdir(os.path.join(LIB, base))
        assert "core" in on_disk
        assert "Core" not in on_disk

    def test_existing_folders_are_left_alone(self, library_tree):
        """Running it on a partly-organised system fills gaps, never fails.

        The fixture already has ``core``/``adventures``, so this also covers the
        case-insensitive filesystems (macOS, Windows) where ``Core`` and ``core``
        are the same directory — those must be reported as existing rather than
        failing to create.
        """
        result = fs.scaffold_categories(f"books/System-{library_tree}")
        assert "Supplements" in result["created"]
        # The fixture's lowercase `core` already covers that category.
        assert "core" in result["existing"]

        again = fs.scaffold_categories(f"books/System-{library_tree}")
        assert again["created"] == [], "a second run must be a no-op"
        assert "Supplements" in again["existing"]

    def test_scaffolded_names_infer_back_to_canonical_categories(self, library_tree):
        """The folders must classify correctly on the next scan, not just read well."""
        from backend.indexer.categories import guess_category

        fs.scaffold_categories(f"books/System-{library_tree}")
        expected = {
            "Core": "core",
            "Supplements": "supplement",
            "Adventures": "adventure",
            "Character Sheets": "character-sheet",
        }
        for folder, category in expected.items():
            assert guess_category(f"books/System-{library_tree}/{folder}/x.pdf") == category

    def test_skips_a_category_already_covered_under_another_name(self, library_tree):
        """A shelf called "Rules" already *is* the core category.

        Creating "Core" beside it would split one category across two folders —
        the opposite of what a tidy-up button should do.
        """
        import shutil

        base = f"books/ScafAlias-{library_tree}"
        os.makedirs(os.path.join(LIB, base, "Rules"), exist_ok=True)
        os.makedirs(os.path.join(LIB, base, "Modules"), exist_ok=True)
        try:
            result = fs.scaffold_categories(base)
            assert "Core" not in result["created"], "Rules already covers `core`"
            assert "Adventures" not in result["created"], "Modules already covers `adventure`"
            # The incumbent folder is reported, so the user can see what matched.
            assert "Rules" in result["existing"]
            assert "Modules" in result["existing"]
            # Uncovered categories are still created.
            assert "Supplements" in result["created"]
            assert not os.path.isdir(os.path.join(LIB, base, "Core"))
        finally:
            shutil.rmtree(os.path.join(LIB, base), ignore_errors=True)

    def test_case_only_difference_is_not_duplicated(self, library_tree):
        import shutil

        base = f"books/ScafCase-{library_tree}"
        os.makedirs(os.path.join(LIB, base, "core"), exist_ok=True)
        try:
            result = fs.scaffold_categories(base)
            assert "Core" not in result["created"]
            assert "core" in result["existing"]
        finally:
            shutil.rmtree(os.path.join(LIB, base), ignore_errors=True)

    def test_refused_outside_books(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.scaffold_categories(f"maps/Battlemaps-{library_tree}")
        assert exc.value.code == "invalid"

    def test_refused_on_the_books_root(self, library_tree):
        # books/ holds systems, not categories.
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.scaffold_categories("books")
        assert exc.value.code == "invalid"

    def test_endpoint(self, client, admin_headers, library_tree):
        resp = client.post(
            "/api/files/folder/scaffold",
            headers=admin_headers,
            json={"path": f"books/System-{library_tree}"},
        )
        assert resp.status_code == 200
        assert "Supplements" in resp.json()["created"]


class TestSystemFolderMetadata:
    """A books/<system> folder maps to the GameSystem row it represents."""

    def test_system_folder_resolves_to_its_row(self, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        db = SessionLocal()
        found = fs.system_for_folder(db, fs.safe_join(f"books/System-{library_tree}"))
        db.close()
        assert found is not None
        assert found.id == system.id

    def test_category_folder_is_not_a_system(self, library_tree):
        make_game_system(name=f"System-{library_tree}")
        db = SessionLocal()
        found = fs.system_for_folder(db, fs.safe_join(f"books/System-{library_tree}/core"))
        db.close()
        # Only direct children of books/ are systems; deeper folders are
        # categories and carry no system metadata.
        assert found is None

    def test_maps_folder_is_not_a_system(self, library_tree):
        db = SessionLocal()
        found = fs.system_for_folder(db, fs.safe_join(f"maps/Battlemaps-{library_tree}"))
        db.close()
        assert found is None

    def test_browse_marks_a_system_folder_as_editable(self, client, admin_headers, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        resp = client.get("/api/files/browse", headers=admin_headers, params={"path": "books"})
        entry = next(
            e for e in resp.json()["entries"] if e["name"] == f"System-{library_tree}"
        )
        # Without these the UI cannot offer "Edit metadata" on a system folder.
        assert entry["record_id"] == system.id
        assert entry["collection"] == "system"

    def test_unregistered_folder_has_no_record(self, client, admin_headers, library_tree):
        import shutil

        os.makedirs(os.path.join(LIB, "books", f"NoSystem-{library_tree}"), exist_ok=True)
        try:
            resp = client.get("/api/files/browse", headers=admin_headers, params={"path": "books"})
            entry = next(
                e for e in resp.json()["entries"] if e["name"] == f"NoSystem-{library_tree}"
            )
            assert entry["record_id"] is None
            assert entry["collection"] is None
        finally:
            shutil.rmtree(os.path.join(LIB, "books", f"NoSystem-{library_tree}"), ignore_errors=True)


class TestUpload:
    """Uploads are the first path that lets arbitrary bytes into the library."""

    @staticmethod
    def _stream(data: bytes):
        import io

        return io.BytesIO(data)

    def test_uploads_a_book(self, library_tree):
        result = fs.save_upload(
            f"books/System-{library_tree}/core",
            "New Book.pdf",
            self._stream(b"%PDF-1.4 hello"),
        )
        assert result["name"] == "New Book.pdf"
        assert result["size"] == 14
        landed = os.path.join(LIB, f"books/System-{library_tree}/core/New Book.pdf")
        assert os.path.exists(landed)
        with open(landed, "rb") as f:
            assert f.read() == b"%PDF-1.4 hello"

    def test_rejects_a_type_the_collection_does_not_index(self, library_tree):
        """An .mp3 under books/ would be invisible to every view in the app."""
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(
                f"books/System-{library_tree}/core", "theme.mp3", self._stream(b"ID3")
            )
        assert exc.value.code == "invalid"

    def test_accepts_audio_under_audio(self, library_tree):
        os.makedirs(os.path.join(LIB, f"audio/Tracks-{library_tree}"), exist_ok=True)
        try:
            result = fs.save_upload(
                f"audio/Tracks-{library_tree}", "theme.mp3", self._stream(b"ID3 data")
            )
            assert result["name"] == "theme.mp3"
        finally:
            import shutil

            shutil.rmtree(os.path.join(LIB, f"audio/Tracks-{library_tree}"), ignore_errors=True)

    def test_strips_a_traversal_attempt_from_the_filename(self, library_tree):
        """The client controls the name, so it is reduced to its final component."""
        result = fs.save_upload(
            f"books/System-{library_tree}/core",
            "../../../../etc/evil.pdf",
            self._stream(b"%PDF"),
        )
        assert result["name"] == "evil.pdf"
        assert result["path"].startswith(f"books/System-{library_tree}/core/")
        # Nothing escaped the library.
        assert os.path.exists(os.path.join(LIB, f"books/System-{library_tree}/core/evil.pdf"))

    def test_rejects_a_hidden_file(self, library_tree):
        """A dotfile upload could reclassify a shelf via a container marker."""
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(
                f"books/System-{library_tree}/core",
                ".parent-system-container",
                self._stream(b"x"),
            )
        assert exc.value.code == "invalid"

    def test_rejects_an_empty_file(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(
                f"books/System-{library_tree}/core", "empty.pdf", self._stream(b"")
            )
        assert exc.value.code == "invalid"
        # The partial file must not be left behind for the scanner to find.
        assert not os.path.exists(
            os.path.join(LIB, f"books/System-{library_tree}/core/.empty.pdf.part")
        )

    def test_enforces_the_size_ceiling_and_cleans_up(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(
                f"books/System-{library_tree}/core",
                "huge.pdf",
                self._stream(b"x" * 5000),
                max_bytes=1000,
            )
        assert exc.value.code == "too_large"
        leftovers = os.listdir(os.path.join(LIB, f"books/System-{library_tree}/core"))
        assert not any(n.endswith(".part") for n in leftovers), "partial upload left behind"
        assert "huge.pdf" not in leftovers

    def test_suffixes_rather_than_overwriting(self, library_tree):
        _write(f"books/System-{library_tree}/core/dup.pdf", b"original")
        result = fs.save_upload(
            f"books/System-{library_tree}/core",
            "dup.pdf",
            self._stream(b"%PDF new"),
            on_conflict="rename",
        )
        assert result["name"] == "dup (2).pdf"
        with open(os.path.join(LIB, f"books/System-{library_tree}/core/dup.pdf"), "rb") as f:
            assert f.read() == b"original", "an upload must never overwrite"

    def test_recreates_a_dropped_folder_structure(self, library_tree):
        """A folder upload keeps its shape via the browser's relative path."""
        result = fs.save_upload(
            f"books/System-{library_tree}",
            "phb.pdf",
            self._stream(b"%PDF"),
            relative_dir="Core Rules/2024",
        )
        assert result["path"].endswith("Core Rules/2024/phb.pdf")
        assert os.path.isdir(os.path.join(LIB, f"books/System-{library_tree}/Core Rules/2024"))

    def test_a_relative_dir_cannot_escape(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload(
                f"books/System-{library_tree}",
                "x.pdf",
                self._stream(b"%PDF"),
                relative_dir="../../../../tmp/evil",
            )
        assert exc.value.code == "forbidden"

    def test_accepts_a_two_part_archive_suffix(self, library_tree):
        result = fs.save_upload(
            f"maps/Battlemaps-{library_tree}", "pack.tar.gz", self._stream(b"\x1f\x8b")
        )
        assert result["name"] == "pack.tar.gz"

    def test_refuses_outside_the_indexed_collections(self, library_tree):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.save_upload("", "stray.pdf", self._stream(b"%PDF"))
        # The library root holds collections, not files.
        assert exc.value.code in ("invalid", "forbidden")

    def test_endpoint_uploads(self, client, admin_headers, library_tree):
        resp = client.post(
            "/api/files/upload",
            headers=admin_headers,
            data={"destination": f"books/System-{library_tree}/core"},
            files={"file": ("api.pdf", b"%PDF-1.4", "application/pdf")},
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "api.pdf"

    def test_endpoint_rejects_a_bad_type(self, client, admin_headers, library_tree):
        resp = client.post(
            "/api/files/upload",
            headers=admin_headers,
            data={"destination": f"books/System-{library_tree}/core"},
            files={"file": ("song.mp3", b"ID3", "audio/mpeg")},
        )
        assert resp.status_code == 400

    def test_endpoint_requires_admin(self, client, gm_headers, library_tree):
        resp = client.post(
            "/api/files/upload",
            headers=gm_headers,
            data={"destination": f"books/System-{library_tree}/core"},
            files={"file": ("x.pdf", b"%PDF", "application/pdf")},
        )
        assert resp.status_code == 403


class TestDeleteFolder:
    def test_deletes_empty(self, library_tree):
        fs.create_folder(f"books/System-{library_tree}", "temp")
        result = fs.delete_empty_folder(f"books/System-{library_tree}/temp")
        assert not os.path.isdir(os.path.join(LIB, f"books/System-{library_tree}/temp"))
        assert result["path"].endswith("temp")

    def test_deletes_marker_only_folder(self, library_tree):
        fs.create_folder(f"books/System-{library_tree}", "tempn", nsfw=True)
        fs.delete_empty_folder(f"books/System-{library_tree}/tempn")
        assert not os.path.isdir(os.path.join(LIB, f"books/System-{library_tree}/tempn"))

    def test_refuses_non_empty(self, library_tree):
        _write(f"books/System-{library_tree}/core/keep.pdf")
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.delete_empty_folder(f"books/System-{library_tree}/core")
        assert exc.value.code == "conflict"

    def test_refuses_collection_root(self):
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.delete_empty_folder("books")
        assert exc.value.code == "forbidden"


# ---------------------------------------------------------------------------
# Read-only library
# ---------------------------------------------------------------------------


class TestReadOnly:
    def test_readonly_mount_gives_actionable_error(self, library_tree, monkeypatch):
        """A read-only mount must explain itself, not surface a raw OSError."""
        monkeypatch.setattr(os, "access", lambda *a, **k: False)
        with pytest.raises(fs.LibraryFSError) as exc:
            fs.create_folder(f"books/System-{library_tree}", "nope")
        assert exc.value.code == "read_only"
        assert "read-only" in exc.value.message.lower()


# ---------------------------------------------------------------------------
# HTTP surface — auth and wiring
# ---------------------------------------------------------------------------


class TestEndpointAuth:
    @pytest.mark.parametrize(
        "method,path,payload",
        [
            ("get", "/api/files/browse", None),
            ("post", "/api/files/move", {"sources": ["a"], "destination": "b"}),
            ("post", "/api/files/rename", {"path": "a", "new_name": "b"}),
            ("post", "/api/files/folder", {"parent": "books", "name": "x"}),
            ("put", "/api/files/folder/markers", {"path": "books", "nsfw": True}),
        ],
    )
    def test_requires_auth(self, client, method, path, payload):
        resp = getattr(client, method)(path, json=payload) if payload else getattr(client, method)(path)
        assert resp.status_code in (401, 403)

    def test_player_forbidden(self, client, player_headers, library_tree):
        resp = client.get("/api/files/browse", headers=player_headers)
        assert resp.status_code == 403

    def test_gm_forbidden(self, client, gm_headers, library_tree):
        resp = client.post(
            "/api/files/folder",
            headers=gm_headers,
            json={"parent": "books", "name": "gm-should-not"},
        )
        assert resp.status_code == 403


class TestBrowseEndpoint:
    def test_browse_root_lists_collections(self, client, admin_headers, library_tree):
        resp = client.get("/api/files/browse", headers=admin_headers)
        assert resp.status_code == 200
        data = resp.json()
        names = {e["name"] for e in data["entries"]}
        assert "books" in names
        assert data["parent"] is None

    def test_browse_shows_indexed_state(self, client, admin_headers, library_tree):
        system = make_game_system(name=f"System-{library_tree}")
        src = _write(f"books/System-{library_tree}/core/known.pdf")
        make_book(
            system.id, title="Known Book", filepath=src, filename="known.pdf",
            relative_path=f"books/System-{library_tree}/core/known.pdf",
        )
        resp = client.get(
            "/api/files/browse",
            headers=admin_headers,
            params={"path": f"books/System-{library_tree}/core"},
        )
        assert resp.status_code == 200
        entry = next(e for e in resp.json()["entries"] if e["name"] == "known.pdf")
        assert entry["title"] == "Known Book"
        assert entry["collection"] == "books"

    def test_browse_hides_marker_files(self, client, admin_headers, library_tree):
        fs.create_folder(f"books/System-{library_tree}", "hidden-markers", nsfw=True)
        resp = client.get(
            "/api/files/browse",
            headers=admin_headers,
            params={"path": f"books/System-{library_tree}/hidden-markers"},
        )
        assert resp.json()["entries"] == []

    def test_browse_reports_folder_markers(self, client, admin_headers, library_tree):
        fs.set_folder_markers(f"books/System-{library_tree}/core", nsfw=True)
        resp = client.get(
            "/api/files/browse",
            headers=admin_headers,
            params={"path": f"books/System-{library_tree}"},
        )
        core = next(e for e in resp.json()["entries"] if e["name"] == "core")
        assert core["nsfw"] is True
        assert core["is_dir"] is True
        fs.set_folder_markers(f"books/System-{library_tree}/core", nsfw=False)

    def test_browse_caps_a_huge_folder(self, client, admin_headers, library_tree):
        """A folder with more files than the cap returns a bounded page.

        Without this, a 40,000-file shelf would serialise every entry into one
        response and hand the browser a list it cannot usefully render.
        """
        big = f"books/System-{library_tree}/big"
        os.makedirs(os.path.join(LIB, big), exist_ok=True)
        for i in range(30):
            _write(f"{big}/file-{i:03d}.pdf")

        resp = client.get(
            "/api/files/browse", headers=admin_headers, params={"path": big, "limit": 10}
        )
        assert resp.status_code == 200
        data = resp.json()
        assert len(data["entries"]) == 10
        # The true size is still reported, so the UI can say what it is hiding.
        assert data["total"] == 30
        assert data["truncated"] is True

    def test_browse_reports_untruncated_when_it_fits(self, client, admin_headers, library_tree):
        _write(f"books/System-{library_tree}/core/only.pdf")
        resp = client.get(
            "/api/files/browse",
            headers=admin_headers,
            params={"path": f"books/System-{library_tree}/core"},
        )
        data = resp.json()
        assert data["truncated"] is False
        assert data["total"] == len(data["entries"])

    def test_browse_does_not_load_descendant_records(self, client, admin_headers, library_tree):
        """Listing a folder must not pull in records for its whole subtree.

        The listing only shows one folder's children, so loading every
        descendant's row was pure waste — and on a system folder holding
        thousands of books, the dominant cost of opening it.
        """
        system = make_game_system(name=f"System-{library_tree}")
        deep_dir = os.path.join(LIB, f"books/System-{library_tree}/core/nested")
        os.makedirs(deep_dir, exist_ok=True)
        deep = _write(f"books/System-{library_tree}/core/nested/deep.pdf")
        make_book(
            system.id,
            title="Deep Book",
            filepath=deep,
            filename="deep.pdf",
            relative_path=f"books/System-{library_tree}/core/nested/deep.pdf",
        )

        resp = client.get(
            "/api/files/browse",
            headers=admin_headers,
            params={"path": f"books/System-{library_tree}/core"},
        )
        names = {e["name"]: e for e in resp.json()["entries"]}
        # The nested folder is listed, but the book inside it is not.
        assert "nested" in names
        assert "deep.pdf" not in names

    def test_child_count_is_capped(self, library_tree):
        """Counting stops at the cap so a huge folder costs a peek, not a walk."""
        from backend.routers.files import core

        big = os.path.join(LIB, f"books/System-{library_tree}/counted")
        os.makedirs(big, exist_ok=True)
        for i in range(12):
            _write(f"books/System-{library_tree}/counted/f{i}.pdf")

        monkeyed = core.CHILD_COUNT_CAP
        try:
            core.CHILD_COUNT_CAP = 5
            assert core._child_count(Path(big)) == 5
        finally:
            core.CHILD_COUNT_CAP = monkeyed

    def test_child_count_none_when_unreadable(self, library_tree):
        """An unreadable folder reports no count rather than a misleading zero."""
        from backend.routers.files import core

        assert core._child_count(Path(os.path.join(LIB, "books", "does-not-exist"))) is None

    def test_browse_traversal_rejected(self, client, admin_headers):
        resp = client.get(
            "/api/files/browse", headers=admin_headers, params={"path": "../../etc"}
        )
        assert resp.status_code == 403

    def test_browse_missing_folder_404(self, client, admin_headers):
        resp = client.get(
            "/api/files/browse", headers=admin_headers, params={"path": "books/nope-xyz"}
        )
        assert resp.status_code == 404


class TestMutationEndpoints:
    def test_move_endpoint(self, client, admin_headers, library_tree):
        _write(f"books/System-{library_tree}/core/api-move.pdf")
        resp = client.post(
            "/api/files/move",
            headers=admin_headers,
            json={
                "sources": [f"books/System-{library_tree}/core/api-move.pdf"],
                "destination": f"books/System-{library_tree}/adventures",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["count"] == 1

    def test_rename_endpoint(self, client, admin_headers, library_tree):
        _write(f"books/System-{library_tree}/core/api-rename.pdf")
        resp = client.post(
            "/api/files/rename",
            headers=admin_headers,
            json={
                "path": f"books/System-{library_tree}/core/api-rename.pdf",
                "new_name": "renamed.pdf",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["to"].endswith("renamed.pdf")

    def test_create_folder_endpoint(self, client, admin_headers, library_tree):
        resp = client.post(
            "/api/files/folder",
            headers=admin_headers,
            json={
                "parent": f"books/System-{library_tree}",
                "name": "api-folder",
                "container_kind": "publisher",
            },
        )
        assert resp.status_code == 200
        assert resp.json()["container_kind"] == "publisher"

    def test_create_folder_conflict_409(self, client, admin_headers, library_tree):
        resp = client.post(
            "/api/files/folder",
            headers=admin_headers,
            json={"parent": f"books/System-{library_tree}", "name": "core"},
        )
        assert resp.status_code == 409

    def test_markers_endpoint(self, client, admin_headers, library_tree):
        resp = client.put(
            "/api/files/folder/markers",
            headers=admin_headers,
            json={"path": f"books/System-{library_tree}/adventures", "nsfw": True},
        )
        assert resp.status_code == 200
        assert resp.json()["nsfw"] is True

    def test_delete_folder_endpoint(self, client, admin_headers, library_tree):
        fs.create_folder(f"books/System-{library_tree}", "api-delete")
        resp = client.request(
            "DELETE",
            "/api/files/folder",
            headers=admin_headers,
            json={"path": f"books/System-{library_tree}/api-delete"},
        )
        assert resp.status_code == 200
