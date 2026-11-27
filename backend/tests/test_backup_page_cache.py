"""A backup does not leave what it read and wrote in the page cache."""
import os
import zipfile

import pytest

from backend.services import backup as backup_service
from backend.services.backup import _page_cache
from backend.services.backup._page_cache import ArchiveCacheRelease, drop_cached

DONTNEED = 4


@pytest.fixture
def fadvise(monkeypatch):
    """Stand in for posix_fadvise (absent on macOS), recording what was dropped.

    Each call is recorded as (the file the descriptor points at, advice).
    """
    calls: list[tuple[str, int]] = []

    def fake(fd, offset, length, advice):
        assert (offset, length) == (0, 0)  # the whole file
        calls.append((os.path.realpath(_path_of(fd)), advice))

    monkeypatch.setattr(os, "posix_fadvise", fake, raising=False)
    monkeypatch.setattr(os, "POSIX_FADV_DONTNEED", DONTNEED, raising=False)
    return calls


_open_paths: dict[int, str] = {}


def _path_of(fd: int) -> str:
    return _open_paths.get(fd, f"fd:{fd}")


@pytest.fixture(autouse=True)
def _track_opens(monkeypatch):
    """Remember which path each os.open descriptor belongs to."""
    real_open = os.open

    def tracking_open(path, flags, *args, **kwargs):
        fd = real_open(path, flags, *args, **kwargs)
        _open_paths[fd] = os.fspath(path)
        return fd

    monkeypatch.setattr(os, "open", tracking_open)
    yield
    _open_paths.clear()


class TestDropCached:
    def test_drops_the_whole_file(self, tmp_path, fadvise):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x" * 10)
        drop_cached(str(target))
        assert fadvise == [(os.path.realpath(target), DONTNEED)]

    def test_flush_writes_the_file_out_first(self, tmp_path, fadvise, monkeypatch):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        order: list[str] = []
        monkeypatch.setattr(os, "fsync", lambda fd: order.append("fsync"))
        monkeypatch.setattr(
            os, "posix_fadvise", lambda *a: order.append("fadvise"), raising=False
        )
        drop_cached(str(target), flush=True)
        assert order == ["fsync", "fadvise"]

    def test_no_flush_by_default(self, tmp_path, fadvise, monkeypatch):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        synced: list[int] = []
        monkeypatch.setattr(os, "fsync", synced.append)
        drop_cached(str(target))
        assert synced == []

    def test_missing_file_is_ignored(self, tmp_path, fadvise):
        drop_cached(str(tmp_path / "gone.bin"))
        assert fadvise == []

    def test_does_nothing_without_posix_fadvise(self, tmp_path, monkeypatch):
        monkeypatch.delattr(os, "posix_fadvise", raising=False)
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        opened: list[str] = []
        monkeypatch.setattr(os, "open", lambda *a, **k: opened.append("open"))
        drop_cached(str(target))
        _page_cache._drop_fd(-1, flush=True)  # would raise if it touched the fd
        assert opened == []

    def test_a_refusing_filesystem_is_ignored(self, tmp_path, monkeypatch):
        def refuse(*_args):
            raise OSError("not supported")

        monkeypatch.setattr(os, "posix_fadvise", refuse, raising=False)
        monkeypatch.setattr(os, "POSIX_FADV_DONTNEED", DONTNEED, raising=False)
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        drop_cached(str(target))  # does not raise


class TestArchiveCacheRelease:
    def test_drops_each_source_and_the_archive_once_enough_is_written(self, tmp_path, fadvise):
        sources = []
        for name in ("a.bin", "b.bin", "c.bin"):
            path = tmp_path / name
            path.write_bytes(os.urandom(100))
            sources.append(str(path))
        archive = tmp_path / "out.zip"

        with zipfile.ZipFile(archive, "w") as zf:
            # fileno() of the zip's own handle is not opened through os.open.
            _open_paths[zf.fp.fileno()] = str(archive)
            cache = ArchiveCacheRelease(zf, every=150)
            for source in sources:
                zf.write(source, os.path.basename(source))
                cache.added(source)

        real = os.path.realpath
        assert fadvise == [
            (real(sources[0]), DONTNEED),
            (real(sources[1]), DONTNEED),
            (real(archive), DONTNEED),  # 200 bytes in: past the 150 mark
            (real(sources[2]), DONTNEED),
        ]
        # Flushing mid-write must not have damaged the archive.
        with zipfile.ZipFile(archive) as zf:
            assert zf.testzip() is None
            assert sorted(zf.namelist()) == ["a.bin", "b.bin", "c.bin"]

    def test_a_vanished_source_counts_as_nothing(self, tmp_path, fadvise):
        with zipfile.ZipFile(tmp_path / "out.zip", "w") as zf:
            cache = ArchiveCacheRelease(zf, every=1)
            cache.added(str(tmp_path / "gone.bin"))
        assert fadvise == []

    def test_release_on_a_closed_archive_is_harmless(self, tmp_path, fadvise):
        zf = zipfile.ZipFile(tmp_path / "out.zip", "w")
        cache = ArchiveCacheRelease(zf)
        zf.close()
        cache.release()
        assert fadvise == []

    def test_a_failed_flush_is_ignored(self, tmp_path, fadvise):
        class Broken:
            def flush(self):
                raise OSError("disk gone")

        with zipfile.ZipFile(tmp_path / "out.zip", "w") as zf:
            cache = ArchiveCacheRelease(zf)
            real_fp, zf.fp = zf.fp, Broken()
            try:
                cache.release()  # does not raise
            finally:
                zf.fp = real_fp
        assert fadvise == []


class TestBackupDropsItsCache:
    def test_archive_and_copied_files_are_dropped(self, tmp_path, monkeypatch, fadvise):
        from backend.config import SessionLocal

        backups = tmp_path / "backups"
        backups.mkdir()
        monkeypatch.setattr(backup_service._config, "BACKUP_DIR", str(backups))
        monkeypatch.setattr(backup_service._config, "BACKUP_DIR_ENV", None)
        covers = tmp_path / "covers"
        covers.mkdir()
        (covers / "one.webp").write_bytes(b"cover")
        monkeypatch.setattr(
            backup_service._archive, "ASSET_DIRS", ((str(covers), "book_covers"),)
        )

        db = SessionLocal()
        try:
            record = backup_service.create_backup(db)
        finally:
            db.close()

        dropped = [path for path, advice in fadvise if advice == DONTNEED]
        assert os.path.realpath(covers / "one.webp") in dropped
        # The finished archive is the last thing dropped, under its final name.
        assert dropped[-1] == os.path.realpath(record.path)
        with zipfile.ZipFile(record.path) as zf:
            assert zf.testzip() is None
            assert "book_covers/one.webp" in zf.namelist()
