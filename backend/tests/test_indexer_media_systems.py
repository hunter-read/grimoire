"""Resilience paths in the media and system scan phases.

These are the branches a healthy library never takes: a database that stops
answering mid-walk, a file that vanishes between the directory listing and the
``stat``, a system folder whose name collides with a row that already exists.
Each one is silent when it goes wrong — the scan finishes, reports success, and
quietly leaves a collection short — so they are asserted on the *stats* the scan
returns and the rows it did or did not create, never on a log line.
"""
import tempfile
import uuid
from pathlib import Path
from unittest.mock import patch

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.indexer.categories import slugify
from backend.models import Audio, Book, GameSystem, GenericMap


def _mk_lib() -> tuple[str, Path]:
    tmp = tempfile.mkdtemp()
    lib = Path(tmp) / "library"
    lib.mkdir()
    return tmp, lib


def _scan(lib: Path, tmp: str, **kw) -> dict:
    db = SessionLocal()
    try:
        return scan_library(str(lib), tmp, db, **kw)
    finally:
        db.close()


def _media(lib: Path, section: str, *parts: str) -> Path:
    d = lib.joinpath(section, *parts)
    d.mkdir(parents=True, exist_ok=True)
    return d


def _touch(folder: Path, name: str, data: bytes = b"\x89PNG\r\n\x1a\n") -> Path:
    p = folder / name
    p.write_bytes(data)
    return p


class TestMediaScanResilience:
    """A stalled database must cost one file, not the whole collection."""

    def test_a_db_hang_querying_a_map_is_counted_and_skipped(self):
        tmp, lib = _mk_lib()
        _touch(_media(lib, "maps", "Battle"), "keep.png")

        def hang(fn, timeout, label):
            if "query map" in label:
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.media._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        assert stats["new_maps"] == 0
        # Scoped to this test's own library: the session-scoped DB is shared.
        db = SessionLocal()
        try:
            assert (
                db.query(GenericMap)
                .filter(GenericMap.filepath.like(f"{lib}%"))
                .first()
                is None
            )
        finally:
            db.close()

    def test_a_db_hang_committing_a_map_rolls_back(self):
        """A half-written row would survive as a phantom entry in the UI."""
        tmp, lib = _mk_lib()
        _touch(_media(lib, "maps", "Battle"), "rollback.png")

        def hang(fn, timeout, label):
            if label.startswith("commit map"):
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.media._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        assert stats["new_maps"] == 0

    def test_a_map_that_vanishes_before_stat_is_skipped(self):
        """The listing and the stat are not atomic; a gap there is not an error."""
        tmp, lib = _mk_lib()
        _touch(_media(lib, "maps", "Battle"), "ghost.png")

        with patch("backend.indexer.media.file_signature", return_value=None):
            stats = _scan(lib, tmp)

        assert stats["new_maps"] == 0
        assert stats["errors"] == 0, "a disappearing file is expected, not an error"

    def test_a_db_hang_querying_audio_is_counted_and_skipped(self):
        tmp, lib = _mk_lib()
        _touch(_media(lib, "audio", "Tracks"), "theme.mp3", b"ID3\x04\x00")

        def hang(fn, timeout, label):
            if "query audio" in label:
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.media._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        assert stats["new_audio"] == 0

    def test_a_db_hang_committing_audio_rolls_back(self):
        tmp, lib = _mk_lib()
        _touch(_media(lib, "audio", "Tracks"), "rollback.mp3", b"ID3\x04\x00")

        def hang(fn, timeout, label):
            if label.startswith("commit audio"):
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.media._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        assert stats["new_audio"] == 0

    def test_an_audio_file_that_vanishes_before_stat_is_skipped(self):
        tmp, lib = _mk_lib()
        _touch(_media(lib, "audio", "Tracks"), "ghost.mp3", b"ID3\x04\x00")

        with patch("backend.indexer.media.file_signature", return_value=None):
            stats = _scan(lib, tmp)

        assert stats["new_audio"] == 0
        assert stats["errors"] == 0

    def test_ignored_media_is_not_registered(self):
        """A .grimoireignore rule must hide tokens and audio, not just books."""
        tmp, lib = _mk_lib()
        (lib / ".grimoireignore").write_text("*.mp3\nskip.png\n")
        _touch(_media(lib, "tokens", "Portraits"), "skip.png")
        _touch(_media(lib, "tokens", "Portraits"), "keep.png")
        _touch(_media(lib, "audio", "Tracks"), "theme.mp3", b"ID3\x04\x00")

        stats = _scan(lib, tmp)

        assert stats["new_audio"] == 0
        assert stats["new_tokens"] == 1

    def test_a_stop_request_halts_the_audio_walk(self):
        tmp, lib = _mk_lib()
        folder = _media(lib, "audio", "Tracks")
        for i in range(4):
            _touch(folder, f"track{i}.mp3", b"ID3\x04\x00")

        stats = _scan(lib, tmp, should_stop=lambda: True)

        assert stats["new_audio"] == 0
        # Scoped to this test's own library: the session-scoped DB is shared.
        db = SessionLocal()
        try:
            assert (
                db.query(Audio).filter(Audio.filepath.like(f"{lib}%")).count() == 0
            )
        finally:
            db.close()


class TestSystemRegistrationResilience:
    """Name collisions and stalled queries around ``GameSystem`` rows."""

    def test_a_db_hang_querying_a_system_is_counted_and_skipped(self):
        tmp, lib = _mk_lib()
        d = lib / "books" / f"Sys-{uuid.uuid4().hex[:6]}" / "core"
        d.mkdir(parents=True)
        (d / "tome.pdf").write_bytes(b"%PDF-1.4")

        def hang(fn, timeout, label):
            if label.startswith("query system '"):
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.systems._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        assert stats["new_systems"] == 0
        assert stats["new_books"] == 0

    def test_a_db_hang_flushing_a_new_system_rolls_back(self):
        tmp, lib = _mk_lib()
        name = f"Sys-{uuid.uuid4().hex[:6]}"
        d = lib / "books" / name / "core"
        d.mkdir(parents=True)
        (d / "tome.pdf").write_bytes(b"%PDF-1.4")

        def hang(fn, timeout, label):
            if label.startswith("flush system"):
                raise TimeoutError(label)
            return fn()

        with patch("backend.indexer.systems._run_with_timeout", side_effect=hang):
            stats = _scan(lib, tmp)

        assert stats["errors"] >= 1
        db = SessionLocal()
        try:
            assert db.query(GameSystem).filter_by(name=name).first() is None
        finally:
            db.close()

    def test_same_named_children_of_two_containers_both_register(self):
        """``Core`` under two containers is two systems, not one shared row.

        Children are namespaced by their container on both slug and display name,
        so the unique ``name`` column never collides and neither folder's books
        are stranded.
        """
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        for container in (f"A-{stamp}(parent-system)", f"B-{stamp}(parent-system)"):
            child = lib / "books" / container / f"Core-{stamp}" / "core"
            child.mkdir(parents=True)
            (child / "tome.pdf").write_bytes(b"%PDF-1.4")

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            rows = db.query(GameSystem).filter(
                GameSystem.name.like(f"%Core-{stamp}")
            ).all()
            assert len(rows) == 2, "both container children must be registered"
            assert {r.name for r in rows} == {
                f"A-{stamp} Core-{stamp}",
                f"B-{stamp} Core-{stamp}",
            }
            assert len({r.slug for r in rows}) == 2
            assert all(r.parent_id for r in rows)
        finally:
            db.close()

    def test_a_name_collision_falls_back_to_a_slug_suffix(self):
        """``name`` is unique, so a clash with an unrelated row must not abort.

        Registering a system whose folder name is already taken by a system with
        a different slug disambiguates rather than raising — otherwise one bad
        name would cost the whole folder its books.
        """
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        name = f"Clash-{stamp}"
        d = lib / "books" / name / "core"
        d.mkdir(parents=True)
        (d / "tome.pdf").write_bytes(b"%PDF-1.4")

        # An unrelated pre-existing row already holds the name this folder wants.
        db = SessionLocal()
        try:
            db.add(GameSystem(name=name, slug=f"unrelated-{stamp}"))
            db.commit()
        finally:
            db.close()

        stats = _scan(lib, tmp)
        assert stats["new_books"] == 1, "the folder's book must still be registered"

        db = SessionLocal()
        try:
            registered = db.query(GameSystem).filter_by(slug=slugify(name)).first()
            assert registered is not None, "the folder must get its own row"
            assert registered.name != name, "the taken name must be disambiguated"
            assert name in registered.name
        finally:
            db.close()

    def test_rescanning_refreshes_a_folder_derived_name(self):
        """A folder rename must move the system with it, unless the user renamed it."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        old = lib / "books" / f"Before-{stamp}" / "core"
        old.mkdir(parents=True)
        (old / "tome.pdf").write_bytes(b"%PDF-1.4")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"Before-{stamp}").first()
            assert system is not None
            system_id = system.id
        finally:
            db.close()

        # Rename the folder, keeping the slug stable so the same row is found.
        (lib / "books" / f"Before-{stamp}").rename(lib / "books" / f"Before-{stamp} ")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            assert db.query(GameSystem).filter_by(id=system_id).first() is not None
        finally:
            db.close()

    def test_a_user_renamed_system_survives_a_rescan(self):
        """``name_is_custom`` is the opt-out: the folder must not overwrite it."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        d = lib / "books" / f"Folder-{stamp}" / "core"
        d.mkdir(parents=True)
        (d / "tome.pdf").write_bytes(b"%PDF-1.4")
        _scan(lib, tmp)

        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"Folder-{stamp}").first()
            system.name = f"My Name-{stamp}"
            system.name_is_custom = True
            db.commit()
            system_id = system.id
        finally:
            db.close()

        _scan(lib, tmp)

        db = SessionLocal()
        try:
            assert db.query(GameSystem).filter_by(id=system_id).first().name == (
                f"My Name-{stamp}"
            )
        finally:
            db.close()

    def test_a_folder_cover_is_picked_up_and_cleared(self):
        """The cover is stored library-relative, and drops when the file goes."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        root = lib / "books" / f"Cover-{stamp}"
        (root / "core").mkdir(parents=True)
        (root / "core" / "tome.pdf").write_bytes(b"%PDF-1.4")
        cover = root / "cover.png"
        cover.write_bytes(b"\x89PNG\r\n\x1a\n")

        _scan(lib, tmp)
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"Cover-{stamp}").first()
            assert system.folder_cover_path
            assert not Path(system.folder_cover_path).is_absolute()
            system_id = system.id
        finally:
            db.close()

        cover.unlink()
        _scan(lib, tmp)
        db = SessionLocal()
        try:
            assert db.query(GameSystem).filter_by(id=system_id).first().folder_cover_path == ""
        finally:
            db.close()

    def test_the_cover_file_is_not_also_registered_as_a_book(self):
        """Issue #372: shelf artwork is artwork, not a one-page "cover" book."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        root = lib / "books" / f"CoverBook-{stamp}"
        (root / "core").mkdir(parents=True)
        (root / "core" / "tome.pdf").write_bytes(b"%PDF-1.4")
        (root / "cover.jpg").write_bytes(b"\xff\xd8\xff\xe0")

        _scan(lib, tmp)
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"CoverBook-{stamp}").first()
            assert system.folder_cover_path  # artwork still applied
            titles = [b.title for b in db.query(Book).filter_by(game_system_id=system.id)]
            assert titles == ["tome"]
        finally:
            db.close()

    def test_a_cover_image_below_the_system_root_is_still_a_book(self):
        """The convention only claims the system root, so a category-folder
        ``cover.jpg`` remains an ordinary image book."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        root = lib / "books" / f"DeepCover-{stamp}"
        (root / "handouts").mkdir(parents=True)
        (root / "handouts" / "cover.jpg").write_bytes(b"\xff\xd8\xff\xe0")

        _scan(lib, tmp)
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"DeepCover-{stamp}").first()
            assert system.folder_cover_path == ""
            titles = [b.title for b in db.query(Book).filter_by(game_system_id=system.id)]
            assert titles == ["cover"]
        finally:
            db.close()

    def test_a_real_book_named_cover_pdf_at_the_root_is_kept(self):
        """Only image extensions are folder artwork; ``cover.pdf`` is a book."""
        tmp, lib = _mk_lib()
        stamp = uuid.uuid4().hex[:6]
        root = lib / "books" / f"CoverPdf-{stamp}"
        root.mkdir(parents=True)
        (root / "cover.pdf").write_bytes(b"%PDF-1.4")

        _scan(lib, tmp)
        db = SessionLocal()
        try:
            system = db.query(GameSystem).filter_by(name=f"CoverPdf-{stamp}").first()
            titles = [b.title for b in db.query(Book).filter_by(game_system_id=system.id)]
            assert titles == ["cover"]
        finally:
            db.close()
