"""Per-file overhead of a rescan: work a large library pays once per file.

Every check here guards a cost that was invisible on a few thousand files and
dominated a 50,000-file library: a directory listing per row, a status write
per file, a second walk of the tree. Each is asserted by counting the calls
rather than timing them, so a regression fails the same way on any machine.
"""
import os
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest

from backend.config import SessionLocal
from backend.indexer import scan_library
from backend.indexer import _context
from backend.indexer._context import list_thumbnail_hashes, path_hash, throttled

PNG = b"\x89PNG\r\n\x1a\n"


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


def _fake_thumbnail(filepath, output_path, size=(300, 400), should_stop=None, timeout=None):
    os.makedirs(os.path.dirname(output_path), exist_ok=True)
    Path(output_path).write_bytes(b"webp")
    return True


class TestThumbnailListing:
    """The has-a-thumbnail check lists each section's directory once per scan."""

    def test_a_rescan_lists_the_maps_thumbnails_once(self):
        tmp, lib = _mk_lib()
        maps = lib / "maps" / "Dungeon"
        maps.mkdir(parents=True)
        for i in range(25):
            (maps / f"room-{i}.png").write_bytes(PNG)
        with patch("backend.indexer.generate_thumbnail", side_effect=_fake_thumbnail):
            _scan(lib, tmp)

        thumbs = os.path.join(tmp, "thumbnails", "maps")
        assert len(os.listdir(thumbs)) == 25
        real_scandir = os.scandir
        listed: list[str] = []

        def counting_scandir(path="."):
            if os.fspath(path) == thumbs:
                listed.append(os.fspath(path))
            return real_scandir(path)

        with (
            patch("backend.indexer.generate_thumbnail") as render,
            patch("backend.indexer._context.os.scandir", side_effect=counting_scandir),
        ):
            _scan(lib, tmp)

        assert len(listed) == 1, "one listing per section, not one per row"
        render.assert_not_called()

    def test_a_stranded_thumbnail_is_still_re_rendered(self):
        tmp, lib = _mk_lib()
        maps = lib / "maps"
        maps.mkdir()
        (maps / "a.png").write_bytes(PNG)
        (maps / "b.png").write_bytes(PNG)
        with patch("backend.indexer.generate_thumbnail", side_effect=_fake_thumbnail):
            _scan(lib, tmp)
        # Strand b's thumbnail, so the next scan has to re-render it.
        thumbs = Path(tmp, "thumbnails", "maps")
        for f in thumbs.iterdir():
            if f.name.endswith(f"_{path_hash(str(maps / 'b.png'))}.webp"):
                f.unlink()

        with patch("backend.indexer.generate_thumbnail", side_effect=_fake_thumbnail) as render:
            stats = _scan(lib, tmp)
        assert stats["updated_maps"] == 1
        assert render.call_count == 1


class TestListThumbnailHashes:
    def test_keeps_only_slug_hash_webp_names(self, tmp_path):
        for name in (
            "goblin-cave_0a1b2c3d.webp",
            "_deadbeef.webp",
            ".hidden_12345678.webp",
            "goblin-cave_0A1B2C3D.webp",
            "short_1234567.webp",
            "nounderscore12345678.webp",
            "goblin_12345678.png",
        ):
            (tmp_path / name).write_bytes(b"")
        assert list_thumbnail_hashes(str(tmp_path)) == {"0a1b2c3d", "deadbeef"}

    def test_a_missing_directory_holds_nothing(self, tmp_path):
        assert list_thumbnail_hashes(str(tmp_path / "nope")) == set()


class _Clock:
    """A ``time`` stand-in whose ``monotonic`` only moves when told to."""

    def __init__(self) -> None:
        self.now = 1000.0

    def monotonic(self) -> float:
        return self.now


class TestThrottledStop:
    def test_reuses_an_answer_within_the_interval(self):
        clock = _Clock()
        asked = []

        def should_stop():
            asked.append(clock.now)
            return False

        with patch("backend.indexer._context.time", clock):
            check = throttled(should_stop, 0.5)
            assert [check() for _ in range(50)] == [False] * 50
            assert len(asked) == 1
            clock.now += 0.5
            check()
        assert len(asked) == 2

    def test_a_stop_once_seen_stands(self):
        clock = _Clock()
        answers = iter([True, False])
        with patch("backend.indexer._context.time", clock):
            check = throttled(lambda: next(answers), 0.5)
            assert check() is True
            clock.now += 10
            assert check() is True, "a stop must not be taken back"

    def test_no_interval_asks_every_time(self):
        fn = lambda: False  # noqa: E731
        assert throttled(fn, 0) is fn


class TestScanStatusThrottle:
    """A rescan asks for a stop and reports progress a few times, not per file."""

    def test_a_walk_of_250_maps_asks_once_and_reports_every_hundred(self, monkeypatch):
        monkeypatch.setattr(_context, "STATUS_INTERVAL", 0.5)
        tmp, lib = _mk_lib()
        maps = lib / "maps"
        maps.mkdir()
        for i in range(250):
            (maps / f"m{i:03}.png").write_bytes(PNG)

        stops: list[int] = []
        reports: list[int] = []

        def should_stop():
            stops.append(1)
            return False

        def on_progress(sb, tb, sm, *rest):
            reports.append(sm)

        with (
            patch("backend.indexer._context.time", _Clock()),
            patch("backend.indexer.generate_thumbnail", return_value=False),
        ):
            stats = _scan(lib, tmp, should_stop=should_stop, on_progress=on_progress)

        assert stats["new_maps"] == 250
        assert len(stops) == 1, "the clock never moved, so one real ask"
        # The opening report, one per hundred files, and the walk's final count.
        assert reports == [0, 100, 200, 250]

    def test_a_stop_is_still_honoured(self, monkeypatch):
        monkeypatch.setattr(_context, "STATUS_INTERVAL", 0.5)
        clock = _Clock()
        tmp, lib = _mk_lib()
        maps = lib / "maps"
        maps.mkdir()
        for i in range(20):
            (maps / f"m{i:02}.png").write_bytes(PNG)

        def slow_thumbnail(*args, **kwargs):
            clock.now += 0.2  # each file takes a fifth of a second
            return False

        with (
            patch("backend.indexer._context.time", clock),
            patch("backend.indexer.generate_thumbnail", side_effect=slow_thumbnail),
        ):
            # Stop requested from the start: seen on the first ask.
            stats = _scan(lib, tmp, should_stop=lambda: clock.now > 1000.5)

        # Asked at 0s (no), reused through 0.4s, asked again at 0.6s (yes).
        assert 0 < stats["new_maps"] < 20


class TestReconcileUsesTheWalk:
    """The missing-file sweep trusts what the walk just saw instead of re-statting it."""

    def _library(self) -> tuple[str, Path, Path]:
        tmp, lib = _mk_lib()
        maps = lib / "maps" / "Keep"
        maps.mkdir(parents=True)
        for i in range(10):
            (maps / f"m{i}.png").write_bytes(PNG + bytes([i]))
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            _scan(lib, tmp)
        return tmp, lib, maps

    def test_an_unscoped_rescan_stats_no_registered_file(self):
        tmp, lib, maps = self._library()
        real_exists = os.path.exists
        statted: list[str] = []

        def counting_exists(path):
            if os.fspath(path).startswith(str(lib)):
                statted.append(os.fspath(path))
            return real_exists(path)

        with (
            patch("backend.indexer.reconcile.os.path.exists", side_effect=counting_exists),
            patch("backend.indexer.generate_thumbnail", return_value=False),
        ):
            stats = _scan(lib, tmp)
        assert statted == []
        assert stats["missing_maps"] == 0

    def test_a_deleted_file_is_still_flagged_and_comes_back(self):
        from backend.models import GenericMap

        tmp, lib, maps = self._library()
        gone = maps / "m3.png"
        data = gone.read_bytes()
        gone.unlink()
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            stats = _scan(lib, tmp)
        assert stats["missing_maps"] == 1

        db = SessionLocal()
        try:
            row = db.query(GenericMap).filter_by(filepath=str(gone)).one()
            assert row.is_missing is True
        finally:
            db.close()

        gone.write_bytes(data)
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            _scan(lib, tmp)
        db = SessionLocal()
        try:
            row = db.query(GenericMap).filter_by(filepath=str(gone)).one()
            assert row.is_missing is False
        finally:
            db.close()

    def test_a_row_the_walk_cannot_see_is_checked_on_disk(self):
        """A file in a hidden folder is never walked, but it is still there."""
        from backend.indexer.hashing import file_signature
        from backend.models import GenericMap

        tmp, lib, maps = self._library()
        hidden = lib / "maps" / ".stash"
        hidden.mkdir()
        f = hidden / "kept.png"
        f.write_bytes(PNG)
        mtime, size = file_signature(str(f))
        db = SessionLocal()
        try:
            db.add(
                GenericMap(
                    filename="kept.png",
                    filepath=str(f),
                    relative_path=os.path.relpath(f, lib),
                    file_size=size,
                    file_mtime=mtime,
                )
            )
            db.commit()
        finally:
            db.close()

        with patch("backend.indexer.generate_thumbnail", return_value=False):
            stats = _scan(lib, tmp)
        assert stats["missing_maps"] == 0


class TestOneWalk:
    """A rescan walks each media tree once: no counting pass, no tags.json pass."""

    def _walks_of(self, lib: Path, tmp: str, section: str, **kw) -> int:
        real_walk = os.walk
        top = str(lib / section)
        walks: list[str] = []

        def counting_walk(path, *a, **k):
            if os.fspath(path) == top:
                walks.append(top)
            return real_walk(path, *a, **k)

        with (
            patch("os.walk", side_effect=counting_walk),
            patch("backend.indexer.generate_thumbnail", return_value=False),
        ):
            _scan(lib, tmp, **kw)
        return len(walks)

    def test_a_rescan_walks_maps_once(self):
        tmp, lib = _mk_lib()
        maps = lib / "maps" / "Caves"
        maps.mkdir(parents=True)
        for i in range(5):
            (maps / f"c{i}.png").write_bytes(PNG + bytes([i]))
        (maps / "tags.json").write_text('{".": ["underground"]}')
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            _scan(lib, tmp)

        assert self._walks_of(lib, tmp, "maps") == 1

    def test_tags_json_still_applies_from_the_one_walk(self):
        from backend.models import MapFolder

        tmp, lib = _mk_lib()
        maps = lib / "maps" / "Caves" / "Deep"
        maps.mkdir(parents=True)
        (maps / "a.png").write_bytes(PNG)
        (maps / "tags.json").write_text('{".": ["Abyssal"]}')
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            _scan(lib, tmp)
        db = SessionLocal()
        try:
            folder = db.query(MapFolder).filter_by(path=os.path.join("Caves", "Deep")).one()
            assert "abyssal" in folder.tags
        finally:
            db.close()

    def test_a_rescan_takes_its_totals_from_the_database(self):
        tmp, lib = _mk_lib()
        maps = lib / "maps"
        maps.mkdir()
        for i in range(4):
            (maps / f"m{i}.png").write_bytes(PNG + bytes([i]))
        with patch("backend.indexer.generate_thumbnail", return_value=False):
            _scan(lib, tmp)
        # Two more arrive. The total is the four already known until the walk
        # passes it, and never reports fewer than were walked.
        (maps / "m4.png").write_bytes(PNG + b"4")
        (maps / "m5.png").write_bytes(PNG + b"5")
        seen: list[tuple[int, int]] = []
        with (
            patch("backend.indexer.scan._count_eligible_files") as walk_count,
            patch("backend.indexer.generate_thumbnail", return_value=False),
        ):
            _scan(lib, tmp, on_progress=lambda sb, tb, sm, tm, *r: seen.append((sm, tm)))
        walk_count.assert_not_called()
        assert seen[0] == (0, 4)
        assert seen[-1] == (6, 6)
        assert all(scanned <= total for scanned, total in seen)


class TestQueriesPerDirectory:
    """A rescan looks each directory up once, and loads no row it will not write."""

    def _count_selects(self, lib: Path, tmp: str) -> list[str]:
        from sqlalchemy import event

        db = SessionLocal()
        engine = db.get_bind()
        selects: list[str] = []

        def count(conn, cursor, statement, *args):
            if statement.lstrip().upper().startswith("SELECT"):
                selects.append(statement)

        event.listen(engine, "before_cursor_execute", count)
        try:
            with patch("backend.indexer.generate_thumbnail", side_effect=_fake_thumbnail):
                scan_library(str(lib), tmp, db)
        finally:
            event.remove(engine, "before_cursor_execute", count)
            db.close()
        return selects

    def _library(self) -> tuple[str, Path]:
        tmp, lib = _mk_lib()
        for d in range(4):
            folder = lib / "maps" / f"Set {d}"
            folder.mkdir(parents=True)
            for i in range(200):
                (folder / f"m{i:03}.png").write_bytes(PNG + bytes([d, i % 256]))
        tokens = lib / "tokens"
        tokens.mkdir()
        for i in range(100):
            (tokens / f"t{i:03}.png").write_bytes(PNG + bytes([9, i]))
        core = lib / "books" / "Overhead System" / "core"
        core.mkdir(parents=True)
        for i in range(100):
            (core / f"book-{i:03}.txt").write_text(f"book {i}\n")
        # Thumbnails that succeed: a failed one is retried by every rescan.
        with patch("backend.indexer.generate_thumbnail", side_effect=_fake_thumbnail):
            _scan(lib, tmp)
        return tmp, lib

    def test_a_1000_file_rescan_issues_fewer_than_50_selects(self):
        tmp, lib = self._library()
        selects = self._count_selects(lib, tmp)
        assert len(selects) < 50, f"{len(selects)} SELECTs for a 1,000-file rescan"

    def test_an_unchanged_book_is_not_loaded(self):
        tmp, lib = self._library()
        selects = self._count_selects(lib, tmp)
        # A full Book load selects its description; the skip lookup never does.
        assert not [s for s in selects if "books.description" in s]

    def test_a_db_hang_on_the_lookup_skips_that_directory_only(self):
        from backend.indexer import media
        from backend.indexer._db import DatabaseBusyError

        tmp, lib = _mk_lib()
        for name in ("Locked", "Open"):
            folder = lib / "maps" / name
            folder.mkdir(parents=True)
            for i in range(3):
                (folder / f"{name}{i}.png").write_bytes(PNG + name.encode() + bytes([i]))
        real = media._db_call

        def locked(fn, label):
            if label.startswith("query map") and "Locked" in label:
                raise DatabaseBusyError(label)
            return real(fn, label)

        with (
            patch.object(media, "_db_call", locked),
            patch("backend.indexer.generate_thumbnail", return_value=False),
        ):
            stats = _scan(lib, tmp)
        assert stats["errors"] == 3
        assert stats["new_maps"] == 3


@pytest.mark.sqlite_only  # a SQLite pragma
class TestScanSession:
    def test_the_scan_commits_without_syncing_and_puts_it_back(self):
        from sqlalchemy import text

        from backend.services.library_scan.runner import _scan_session

        with _scan_session() as db:
            assert db.execute(text("PRAGMA synchronous")).scalar() == 1  # NORMAL
            db.commit()
            # Still the same connection after a commit.
            assert db.execute(text("PRAGMA synchronous")).scalar() == 1
        # Every pooled connection is back at the default.
        sessions = [SessionLocal() for _ in range(3)]
        try:
            assert {s.execute(text("PRAGMA synchronous")).scalar() for s in sessions} == {2}
        finally:
            for s in sessions:
                s.close()


class TestImageThumbnails:
    """A big image is shrunk as it is decoded, not decoded whole and then shrunk."""

    def test_a_large_jpeg_is_never_held_at_full_size(self, tmp_path):
        from PIL import Image

        from backend.indexer.thumbnails import _write_thumbnail

        src = tmp_path / "battlemap.jpg"
        Image.new("RGB", (4000, 3000), (90, 120, 60)).save(src, "JPEG")
        loaded: list[tuple[int, int]] = []
        real_load = Image.Image.load

        def spy(self):
            out = real_load(self)
            loaded.append(self.size)
            return out

        out = tmp_path / "thumb.webp"
        with patch.object(Image.Image, "load", spy):
            _write_thumbnail(str(src), str(out), (300, 400))
        assert (4000, 3000) not in loaded
        with Image.open(out) as thumb:
            assert thumb.size == (300, 225)

    def test_an_rgb_png_comes_out_as_it_did(self, tmp_path):
        from PIL import Image

        from backend.indexer.thumbnails import _write_thumbnail

        src = tmp_path / "map.png"
        img = Image.new("RGB", (900, 600))
        img.putdata([((x * 7) % 256, (y * 3) % 256, (x + y) % 256) for y in range(600) for x in range(900)])
        img.save(src)
        _write_thumbnail(str(src), str(tmp_path / "new.webp"), (300, 400))
        # What the old order made: convert, then shrink.
        with Image.open(src) as old:
            old = old.convert("RGB")
            old.thumbnail((300, 400), Image.Resampling.LANCZOS)
            old.save(tmp_path / "old.webp", "WEBP", quality=80)
        with Image.open(tmp_path / "new.webp") as a, Image.open(tmp_path / "old.webp") as b:
            assert a.tobytes() == b.tobytes()

    def test_a_palette_or_alpha_image_is_still_converted_first(self, tmp_path):
        from PIL import Image

        from backend.indexer.thumbnails import _write_thumbnail

        for mode in ("P", "RGBA", "LA"):
            src = tmp_path / f"token-{mode}.png"
            Image.new(mode, (800, 800)).save(src)
            out = tmp_path / f"{mode}.webp"
            _write_thumbnail(str(src), str(out), (200, 200))
            with Image.open(out) as thumb:
                assert thumb.mode == "RGB" and thumb.size == (200, 200)


class TestDocumentHelper:
    def test_a_poster_page_renders_at_twice_the_box_not_twice_its_size(self):
        from backend.render.scan_worker import render_scale

        # 24 x 36 inches is 1728 x 2592 points; a 300 x 400 box wants 800 tall.
        scale = render_scale(1728, 2592, (300, 400))
        assert round(2592 * scale) == 800
        # A page smaller than the box keeps the old zoom of 2.
        assert render_scale(100, 100, (300, 400)) == 2.0
        assert render_scale(0, 0, (300, 400)) == 2.0

    def test_the_page_count_after_a_thumbnail_reuses_its_parse(self, tmp_path):
        import pymupdf

        from backend.render import scan_worker

        pdf = tmp_path / "book.pdf"
        doc = pymupdf.open()
        for _ in range(3):
            doc.new_page()
        doc.save(pdf)
        doc.close()
        opened: list[str] = []
        real_open = scan_worker.open_document

        def counting(path):
            opened.append(path)
            return real_open(path)

        with patch.object(scan_worker, "open_document", counting):
            assert scan_worker.thumbnail(str(pdf), str(tmp_path / "t.webp"), (100, 100))
            assert scan_worker.page_count(str(pdf)) == 3
            assert len(opened) == 1
            # Nothing is held afterwards, and a second count opens it afresh.
            assert scan_worker.page_count(str(pdf)) == 3
            assert len(opened) == 2

    def test_a_held_document_is_dropped_for_another_file_or_a_changed_one(self, tmp_path):
        import pymupdf

        from backend.render import scan_worker

        paths = []
        for name, pages in (("a.pdf", 1), ("b.pdf", 2)):
            doc = pymupdf.open()
            for _ in range(pages):
                doc.new_page()
            doc.save(tmp_path / name)
            doc.close()
            paths.append(str(tmp_path / name))
        a, b = paths
        assert scan_worker.thumbnail(a, str(tmp_path / "a.webp"), (100, 100))
        assert scan_worker.page_count(b) == 2  # a's parse is not b's
        assert scan_worker._held is None

        assert scan_worker.thumbnail(a, str(tmp_path / "a.webp"), (100, 100))
        doc = pymupdf.open()
        for _ in range(5):
            doc.new_page()
        doc.save(tmp_path / "a2.pdf")
        doc.close()
        os.replace(tmp_path / "a2.pdf", a)
        assert scan_worker.page_count(a) == 5, "a replaced file is read again"
