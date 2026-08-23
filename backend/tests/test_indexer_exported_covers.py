"""Exported sidecar covers must never be indexed as books (runaway ``.cover.jpg``).

The sidecar exporter writes a book's cover beside it as ``<stem>.cover.jpg``.
Before the fix the books walk indexed that image as a book of its own, so the
next export gave *it* a cover named ``<stem>.cover.cover.jpg``, which was
indexed in turn. Every rescan added another level, inflating both the book and
the game-system counts without bound.
"""
from __future__ import annotations

import tempfile
from pathlib import Path

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.indexer.metadata import is_exported_cover_name
from backend.models import Book, GameSystem


class TestIsExportedCoverName:
    def test_matches_exported_cover(self):
        assert is_exported_cover_name("Players Handbook.cover.jpg")

    def test_matches_regardless_of_case(self):
        assert is_exported_cover_name("Guide.COVER.JPG")

    def test_matches_already_nested_cover(self):
        # The files a prior buggy run left behind must also be recognised, or
        # cleanup would leave them re-indexing forever.
        assert is_exported_cover_name("Guide.cover.cover.jpg")

    def test_rejects_ordinary_image(self):
        # A bare .jpg is ordinary library content (a map, a token, an image
        # book) and must stay indexable.
        assert not is_exported_cover_name("battle-map.jpg")

    def test_rejects_folder_cover_convention(self):
        assert not is_exported_cover_name("cover.jpg")

    def test_rejects_content_file(self):
        assert not is_exported_cover_name("Players Handbook.pdf")


def _mk_lib():
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


class TestExportedCoversNotIndexed:
    def setup_method(self):
        self.tmp, self.lib = _mk_lib()

    def _scan(self):
        db = SessionLocal()
        try:
            scan_library(str(self.lib), self.tmp, db)
        finally:
            db.close()

    def _folder(self, system: str, category: str) -> Path:
        d = self.lib / "books" / system / category
        d.mkdir(parents=True, exist_ok=True)
        return d

    def _titles(self):
        db = SessionLocal()
        try:
            return {b.title for b in db.query(Book).all()}
        finally:
            db.close()

    def test_exported_cover_is_not_indexed_as_a_book(self):
        folder = self._folder("D&D 5e", "core")
        (folder / "players_handbook.pdf").write_bytes(b"%PDF-1.4")
        (folder / "players_handbook.cover.jpg").write_bytes(b"\xff\xd8\xff\xe0stub")

        self._scan()

        db = SessionLocal()
        try:
            paths = [b.filepath for b in db.query(Book).all()]
        finally:
            db.close()
        assert not any(p.endswith(".cover.jpg") for p in paths)
        assert any(p.endswith("players_handbook.pdf") for p in paths)

    def test_nested_covers_from_a_prior_run_are_not_indexed(self):
        # Files an earlier buggy build already wrote must be ignored, so a
        # rescan stops the growth even before the operator deletes them.
        folder = self._folder("D&D 5e", "core")
        (folder / "guide.pdf").write_bytes(b"%PDF-1.4")
        for name in (
            "guide.cover.jpg",
            "guide.cover.cover.jpg",
            "guide.cover.cover.cover.jpg",
        ):
            (folder / name).write_bytes(b"\xff\xd8\xff\xe0stub")

        self._scan()

        db = SessionLocal()
        try:
            paths = [b.filepath for b in db.query(Book).all()]
        finally:
            db.close()
        assert not any(".cover." in Path(p).name for p in paths)

    def test_rescanning_does_not_grow_the_book_count(self):
        # The regression in one assertion: the loop's symptom was a count that
        # climbed on every rescan.
        folder = self._folder("D&D 5e", "core")
        (folder / "guide.pdf").write_bytes(b"%PDF-1.4")
        (folder / "guide.cover.jpg").write_bytes(b"\xff\xd8\xff\xe0stub")

        # Count only this test's own library — the test DB is shared across
        # tests in the module, so a global count would mix in their books.
        root = str(self.lib)

        def _count():
            db = SessionLocal()
            try:
                return sum(
                    1 for b in db.query(Book).all() if b.filepath.startswith(root)
                )
            finally:
                db.close()

        self._scan()
        first = _count()
        self._scan()
        second = _count()

        assert first == second == 1

    def test_exported_cover_does_not_create_a_game_system(self):
        # A loose cover beside a one-page game used to register as a game of
        # its own, which is what inflated the system count.
        loose = self.lib / "books" / "one-page-rpgs"
        loose.mkdir(parents=True)
        (loose / "honey-heist.pdf").write_bytes(b"%PDF-1.4")
        (loose / "honey-heist.cover.jpg").write_bytes(b"\xff\xd8\xff\xe0stub")

        self._scan()

        db = SessionLocal()
        try:
            names = {s.name for s in db.query(GameSystem).all()}
        finally:
            db.close()
        assert not any("cover" in n.lower() for n in names)

    def test_ordinary_jpg_book_is_still_indexed(self):
        # The filter keys on the compound suffix precisely so plain images stay
        # first-class content.
        folder = self._folder("Maps & Handouts", "core")
        (folder / "tavern.jpg").write_bytes(b"\xff\xd8\xff\xe0stub")

        self._scan()

        db = SessionLocal()
        try:
            paths = [b.filepath for b in db.query(Book).all()]
        finally:
            db.close()
        assert any(p.endswith("tavern.jpg") for p in paths)
