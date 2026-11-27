"""A backup does not leave what it read and wrote in the system's file cache."""
import errno
import io
import os
import zipfile

import pytest

from backend.services import backup as backup_service
from backend.services.backup import _os_cache
from backend.services.backup._os_cache import (
    ArchiveCacheRelease,
    IncompleteCopyError,
    drop_cached,
)

DONTNEED = 4


def _ident(path) -> tuple[int, int]:
    st = os.stat(path)
    return (st.st_dev, st.st_ino)


@pytest.fixture
def dropped(monkeypatch):
    """Stand in for posix_fadvise (absent on macOS), recording what was dropped.

    Files are recorded by (device, inode), which a rename keeps and which works
    whatever opened the descriptor.
    """
    calls: list[tuple[int, int]] = []

    def fake(fd, offset, length, advice):
        assert (offset, length, advice) == (0, 0, DONTNEED)  # the whole file
        st = os.fstat(fd)
        calls.append((st.st_dev, st.st_ino))

    monkeypatch.setattr(os, "posix_fadvise", fake, raising=False)
    monkeypatch.setattr(os, "POSIX_FADV_DONTNEED", DONTNEED, raising=False)
    return calls


@pytest.fixture
def synced(monkeypatch):
    """Record fsync calls without touching the disk."""
    calls: list[tuple[int, int]] = []

    def fake(fd):
        st = os.fstat(fd)
        calls.append((st.st_dev, st.st_ino))

    monkeypatch.setattr(os, "fsync", fake)
    return calls


def _fail_fsync(monkeypatch, code: int) -> None:
    def fail(_fd):
        raise OSError(code, os.strerror(code))

    monkeypatch.setattr(os, "fsync", fail)


class TestDropCached:
    def test_drops_the_whole_file_without_flushing(self, tmp_path, dropped, synced):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x" * 10)
        drop_cached(str(target))
        assert dropped == [_ident(target)]
        assert synced == []

    def test_flush_writes_the_file_out_first(self, tmp_path, monkeypatch):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        order: list[str] = []
        monkeypatch.setattr(os, "fsync", lambda fd: order.append("fsync"))
        monkeypatch.setattr(os, "posix_fadvise", lambda *a: order.append("fadvise"), raising=False)
        monkeypatch.setattr(os, "POSIX_FADV_DONTNEED", DONTNEED, raising=False)
        drop_cached(str(target), flush=True)
        assert order == ["fsync", "fadvise"]

    def test_a_failed_flush_raises(self, tmp_path, monkeypatch, dropped):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        _fail_fsync(monkeypatch, errno.EIO)
        with pytest.raises(OSError) as exc:
            drop_cached(str(target), flush=True)
        assert exc.value.errno == errno.EIO
        assert dropped == []

    @pytest.mark.parametrize("code", [errno.EINVAL, errno.ENOTSUP, errno.EROFS])
    def test_a_flush_the_filesystem_cannot_do_still_drops(
        self, tmp_path, monkeypatch, dropped, code
    ):
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        _fail_fsync(monkeypatch, code)
        drop_cached(str(target), flush=True)
        assert dropped == [_ident(target)]

    def test_missing_file_is_ignored(self, tmp_path, dropped):
        drop_cached(str(tmp_path / "gone.bin"))
        assert dropped == []

    def test_missing_file_to_flush_raises(self, tmp_path, dropped):
        with pytest.raises(FileNotFoundError):
            drop_cached(str(tmp_path / "gone.bin"), flush=True)

    def test_does_nothing_without_posix_fadvise(self, tmp_path, monkeypatch, synced):
        monkeypatch.delattr(os, "posix_fadvise", raising=False)
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        drop_cached(str(target))
        drop_cached(str(target), flush=True)  # still flushes
        assert synced == [_ident(target)]

    def test_a_refusing_filesystem_is_ignored(self, tmp_path, monkeypatch):
        def refuse(*_args):
            raise OSError("not supported")

        monkeypatch.setattr(os, "posix_fadvise", refuse, raising=False)
        monkeypatch.setattr(os, "POSIX_FADV_DONTNEED", DONTNEED, raising=False)
        target = tmp_path / "a.bin"
        target.write_bytes(b"x")
        drop_cached(str(target))  # does not raise


def _archive(path) -> zipfile.ZipFile:
    return zipfile.ZipFile(path, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6)


class TestArchiveCacheRelease:
    def test_a_large_file_is_released_as_it_is_copied(
        self, tmp_path, monkeypatch, dropped, synced
    ):
        monkeypatch.setattr(_os_cache, "CHUNK_BYTES", 100)
        source = tmp_path / "big.bin"
        payload = os.urandom(450)
        source.write_bytes(payload)
        out = tmp_path / "out.zip"

        with _archive(out) as zf:
            copier = ArchiveCacheRelease(zf, every=200, drop_from=100)
            copier.add_file(str(source), "big.bin")

        src, arc = _ident(source), _ident(out)
        # Every 200 bytes: the source read so far, then the archive (flushed
        # first); and the source once more at the end.
        assert dropped == [src, arc, src, arc, src]
        assert synced == [arc, arc]
        with zipfile.ZipFile(out) as zf:
            assert zf.testzip() is None
            assert zf.read("big.bin") == payload

    def test_a_small_file_is_left_cached(self, tmp_path, dropped):
        source = tmp_path / "cover.webp"
        source.write_bytes(b"x" * 50)
        with _archive(tmp_path / "out.zip") as zf:
            ArchiveCacheRelease(zf, drop_from=100).add_file(str(source), "cover.webp")
        assert dropped == []

    def test_defaults_come_from_the_module(self, tmp_path, monkeypatch, dropped, synced):
        monkeypatch.setattr(_os_cache, "DROP_FILES_FROM_BYTES", 1)
        monkeypatch.setattr(_os_cache, "RELEASE_EVERY_BYTES", 1)
        source = tmp_path / "a.bin"
        source.write_bytes(b"xy")
        out = tmp_path / "out.zip"
        with _archive(out) as zf:
            ArchiveCacheRelease(zf).add_file(str(source), "a.bin")
        assert _ident(source) in dropped
        assert synced == [_ident(out)]

    def test_entries_match_what_zipfile_write_makes(self, tmp_path):
        source = tmp_path / "text.txt"
        source.write_bytes(b"grimoire " * 5000)
        os.utime(source, (1_700_000_000, 1_700_000_000))
        ours, theirs = tmp_path / "ours.zip", tmp_path / "theirs.zip"
        with _archive(ours) as zf:
            ArchiveCacheRelease(zf).add_file(str(source), "text.txt")
        with _archive(theirs) as zf:
            zf.write(source, "text.txt")

        with zipfile.ZipFile(ours) as a, zipfile.ZipFile(theirs) as b:
            mine, ref = a.getinfo("text.txt"), b.getinfo("text.txt")
            for field in ("compress_type", "compress_size", "file_size", "CRC", "date_time"):
                assert getattr(mine, field) == getattr(ref, field), field
            assert mine.external_attr == ref.external_attr

    def test_a_file_that_cannot_be_opened_adds_nothing(self, tmp_path, monkeypatch):
        source = tmp_path / "locked.bin"
        source.write_bytes(b"x")

        def refuse(*_args, **_kwargs):
            raise PermissionError(errno.EACCES, "denied")

        monkeypatch.setattr(_os_cache, "open", refuse, raising=False)
        out = tmp_path / "out.zip"
        with _archive(out) as zf:
            with pytest.raises(PermissionError):
                ArchiveCacheRelease(zf).add_file(str(source), "locked.bin")
        with zipfile.ZipFile(out) as zf:
            assert zf.namelist() == []

    def test_a_vanished_file_adds_nothing(self, tmp_path):
        with _archive(tmp_path / "out.zip") as zf:
            with pytest.raises(FileNotFoundError):
                ArchiveCacheRelease(zf).add_file(str(tmp_path / "gone.bin"), "gone.bin")
            assert zf.namelist() == []

    def test_a_failure_partway_through_is_an_incomplete_copy(self, tmp_path, monkeypatch):
        monkeypatch.setattr(_os_cache, "CHUNK_BYTES", 10)
        source = tmp_path / "flaky.bin"
        source.write_bytes(b"x" * 100)
        _patch_failing_read(monkeypatch, after_reads=2)

        with _archive(tmp_path / "out.zip") as zf:
            with pytest.raises(IncompleteCopyError, match="flaky.bin"):
                ArchiveCacheRelease(zf).add_file(str(source), "flaky.bin")

    def test_release_on_a_closed_archive_is_harmless(self, tmp_path, dropped, synced):
        zf = _archive(tmp_path / "out.zip")
        copier = ArchiveCacheRelease(zf)
        zf.close()
        copier.release()
        assert dropped == [] and synced == []

    def test_a_failed_flush_raises(self, tmp_path, monkeypatch, dropped):
        _fail_fsync(monkeypatch, errno.EIO)
        with _archive(tmp_path / "out.zip") as zf:
            zf.writestr("a.txt", "a")
            with pytest.raises(OSError):
                ArchiveCacheRelease(zf).release()
        assert dropped == []


def _patch_failing_read(monkeypatch, after_reads: int, name: str = "flaky") -> None:
    """Make files whose name contains ``name`` fail on a read after ``after_reads``."""
    real_open = open

    class Flaky(io.FileIO):
        reads = 0

        def read(self, size=-1):
            self.reads += 1
            if self.reads > after_reads:
                raise OSError(errno.EIO, "Input/output error")
            return super().read(size)

    def fake_open(path, mode="r", *args, **kwargs):
        if name in os.fspath(path) and mode == "rb":
            return Flaky(path, "r")
        return real_open(path, mode, *args, **kwargs)

    monkeypatch.setattr(_os_cache, "open", fake_open, raising=False)


@pytest.fixture
def backup_dir(tmp_path, monkeypatch):
    target = tmp_path / "backups"
    target.mkdir()
    monkeypatch.setattr(backup_service._config, "BACKUP_DIR", str(target))
    monkeypatch.setattr(backup_service._config, "BACKUP_DIR_ENV", None)
    return target


@pytest.fixture
def assets(tmp_path, monkeypatch):
    """One asset directory holding a small and a large file."""
    folder = tmp_path / "uploads"
    folder.mkdir()
    (folder / "small.webp").write_bytes(b"s" * 10)
    (folder / "large.pdf").write_bytes(b"L" * 1000)
    monkeypatch.setattr(_os_cache, "DROP_FILES_FROM_BYTES", 500)
    monkeypatch.setattr(
        backup_service._archive, "ASSET_DIRS", ((str(folder), "campaign_uploads"),)
    )
    return folder


def _run_backup():
    from backend.config import SessionLocal

    db = SessionLocal()
    try:
        return backup_service.create_backup(db)
    finally:
        db.close()


class TestBackupReleasesItsCache:
    def test_archive_and_large_files_are_dropped(self, backup_dir, assets, dropped, synced):
        record = _run_backup()

        assert _ident(assets / "large.pdf") in dropped
        assert _ident(assets / "small.webp") not in dropped
        # The archive is flushed and dropped last, before its rename (which
        # keeps the inode).
        assert dropped[-1] == _ident(record.path)
        assert synced[-1] == _ident(record.path)
        with zipfile.ZipFile(record.path) as zf:
            assert zf.testzip() is None
            assert zf.read("campaign_uploads/large.pdf") == b"L" * 1000

    def test_a_failed_final_flush_fails_the_backup(self, backup_dir, assets, monkeypatch):
        _fail_fsync(monkeypatch, errno.EIO)
        with pytest.raises(OSError):
            _run_backup()
        assert os.listdir(backup_dir) == []

    def test_a_file_cut_off_partway_fails_the_backup(
        self, backup_dir, assets, monkeypatch, dropped
    ):
        (assets / "flaky.png").write_bytes(b"f" * 100)
        monkeypatch.setattr(_os_cache, "CHUNK_BYTES", 10)
        _patch_failing_read(monkeypatch, after_reads=1)
        with pytest.raises(IncompleteCopyError):
            _run_backup()
        assert os.listdir(backup_dir) == []

    def test_a_file_that_cannot_be_opened_is_skipped(
        self, backup_dir, assets, monkeypatch, dropped
    ):
        (assets / "locked.png").write_bytes(b"x")
        real_open = open

        def fake_open(path, mode="r", *args, **kwargs):
            if "locked" in os.fspath(path):
                raise PermissionError(errno.EACCES, "denied")
            return real_open(path, mode, *args, **kwargs)

        monkeypatch.setattr(_os_cache, "open", fake_open, raising=False)
        record = _run_backup()
        with zipfile.ZipFile(record.path) as zf:
            names = zf.namelist()
        assert "campaign_uploads/large.pdf" in names
        assert "campaign_uploads/locked.png" not in names
