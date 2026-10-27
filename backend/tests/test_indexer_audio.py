"""Tests for the audio-specific indexer helpers and scan path.

Covers the metadata reader, folder/embedded-artwork lookup, and the audio scan
loop in scan_library (the code added for the audio library feature).
"""
import os
import shutil
import tempfile
import uuid
import wave
import zipfile

from PIL import Image

from backend.config import SessionLocal
from backend.models import Audio
from backend.indexer._db import DatabaseBusyError
from backend.indexer import (
    AUDIO_EXTS,
    _leading_number,
    _read_audio_metadata,
    _find_folder_artwork,
    _extract_embedded_art,
    _has_embedded_art,
    scan_library,
)

M4B_FIXTURE = os.path.join(os.path.dirname(__file__), "fixtures", "audio", "audiobook.m4b")


def _write_wav(path, seconds=1):
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * (8000 * seconds))


def _write_wav_with_id3(
    path, *, title="", artist="", album="", track="", disc="", with_art=False
):
    _write_wav(path)
    from mutagen.wave import WAVE
    from mutagen.id3 import TIT2, TPE1, TALB, TPOS, TRCK, APIC

    f = WAVE(path)
    f.add_tags()
    if title:
        f.tags.add(TIT2(encoding=3, text=title))
    if artist:
        f.tags.add(TPE1(encoding=3, text=artist))
    if album:
        f.tags.add(TALB(encoding=3, text=album))
    if track:
        f.tags.add(TRCK(encoding=3, text=track))
    if disc:
        f.tags.add(TPOS(encoding=3, text=disc))
    if with_art:
        png = b"\x89PNG\r\n\x1a\n" + b"x" * 32
        f.tags.add(APIC(encoding=3, mime="image/png", type=3, desc="cover", data=png))
    f.save()


class TestReadAudioMetadata:
    def test_reads_duration_from_wav(self):
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "tone.wav")
        _write_wav(wav, seconds=2)
        meta = _read_audio_metadata(wav)
        assert round(meta["duration"]) == 2
        assert meta["embedded_art"] is False

    def test_detects_embedded_art(self):
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "art.wav")
        _write_wav_with_id3(wav, with_art=True)
        meta = _read_audio_metadata(wav)
        assert meta["embedded_art"] is True

    def test_unreadable_file_returns_blank_metadata(self):
        meta = _read_audio_metadata("/tmp/does-not-exist-xyz.mp3")
        assert meta["duration"] == 0.0
        assert meta["title"] == ""
        assert meta["embedded_art"] is False
        assert meta["track_number"] == 0

    def test_reads_id3_tags_from_wav(self):
        """WAV's ID3 tags are read by frame - easy mode only wraps MP3's (issue #494)."""
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "tagged.wav")
        _write_wav_with_id3(
            wav, title="Die Sümpfe", artist="Sphärenklang", album="Thorwal", track="3/12", disc="2"
        )
        meta = _read_audio_metadata(wav)
        assert meta["title"] == "Die Sümpfe"
        assert meta["artist"] == "Sphärenklang"
        assert meta["album"] == "Thorwal"
        assert meta["track_number"] == 3
        assert meta["disc_number"] == 2

    def test_untagged_wav_has_no_track_number(self):
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "plain.wav")
        _write_wav_with_id3(wav, title="Only a title")
        meta = _read_audio_metadata(wav)
        assert (meta["track_number"], meta["disc_number"]) == (0, 0)


class TestLeadingNumber:
    def test_parses_position_forms(self):
        assert _leading_number("3/12") == 3
        assert _leading_number("03") == 3
        assert _leading_number(" 7 ") == 7

    def test_unreadable_is_zero(self):
        assert _leading_number("") == 0
        assert _leading_number("A-side") == 0
        assert _leading_number(None) == 0


class TestM4bAudiobook:
    """`.m4b` is the same MP4 container as `.m4a` (issue #564)."""

    def test_reads_duration_and_tags(self):
        info = _read_audio_metadata(M4B_FIXTURE)
        assert info["duration"] > 0.9
        assert info["title"] == "Test Audiobook"
        assert info["artist"] == "Test Narrator"
        assert info["album"] == "Test Adventure Path"
        assert info["embedded_art"] is True

    def test_extracts_png_cover_atom(self):
        data, mime = _extract_embedded_art(M4B_FIXTURE)
        assert mime == "image/png"
        assert data.startswith(b"\x89PNG")


class TestFolderArtwork:
    def test_finds_cover_image(self):
        tmp = tempfile.mkdtemp()
        Image.new("RGB", (8, 8), (1, 2, 3)).save(os.path.join(tmp, "cover.jpg"))
        assert _find_folder_artwork(tmp).endswith("cover.jpg")

    def test_finds_folder_image(self):
        tmp = tempfile.mkdtemp()
        Image.new("RGB", (8, 8), (1, 2, 3)).save(os.path.join(tmp, "folder.png"))
        assert _find_folder_artwork(tmp).endswith("folder.png")

    def test_returns_none_when_no_cover(self):
        tmp = tempfile.mkdtemp()
        Image.new("RGB", (8, 8), (1, 2, 3)).save(os.path.join(tmp, "random.png"))
        assert _find_folder_artwork(tmp) is None

    def test_missing_dir_returns_none(self):
        assert _find_folder_artwork("/tmp/no-such-dir-xyz") is None


class TestEmbeddedArt:
    def test_extracts_apic_art(self):
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "art.wav")
        _write_wav_with_id3(wav, with_art=True)
        data, mime = _extract_embedded_art(wav)
        assert data and mime == "image/png"
        assert _has_embedded_art(wav) is True

    def test_no_art_returns_none(self):
        tmp = tempfile.mkdtemp()
        wav = os.path.join(tmp, "plain.wav")
        _write_wav(wav)
        assert _extract_embedded_art(wav) is None
        assert _has_embedded_art(wav) is False

    def test_bad_file_returns_none(self):
        assert _extract_embedded_art("/tmp/no-such-xyz.flac") is None


class TestAudioScanLoop:
    def _mk_lib(self):
        tmp = tempfile.mkdtemp()
        lib = os.path.join(tmp, "library")
        os.makedirs(os.path.join(lib, "audio", "Ambient"))
        return tmp, lib

    def test_scan_registers_audio_with_metadata_and_artwork(self):
        tmp, lib = self._mk_lib()
        adir = os.path.join(lib, "audio", "Ambient")
        wav = os.path.join(adir, "tavern.wav")
        _write_wav_with_id3(wav, title="Tavern Night", artist="Bard", album="Inn")
        Image.new("RGB", (8, 8), (1, 2, 3)).save(os.path.join(adir, "cover.jpg"))

        db = SessionLocal()
        try:
            stats = scan_library(lib, tempfile.mkdtemp(), db)
            assert stats["new_audio"] >= 1
            row = (
                db.query(Audio)
                .filter(Audio.filepath == wav)
                .first()
            )
            assert row is not None
            assert row.duration > 0
            assert row.has_artwork is True
        finally:
            db.close()

    def test_rescan_skips_already_indexed_audio(self):
        tmp, lib = self._mk_lib()
        wav = os.path.join(lib, "audio", "Ambient", f"loop-{uuid.uuid4().hex[:6]}.wav")
        _write_wav(wav)
        data = tempfile.mkdtemp()
        db = SessionLocal()
        try:
            first = scan_library(lib, data, db)
            assert first["new_audio"] >= 1
            second = scan_library(lib, data, db)
            # The track is already registered, so the second pass adds nothing.
            assert second["new_audio"] == 0
        finally:
            db.close()

    def test_scan_stores_track_and_disc_numbers(self):
        tmp, lib = self._mk_lib()
        wav = os.path.join(lib, "audio", "Ambient", "01 - whatever.wav")
        _write_wav_with_id3(wav, title="Harodien", track="4/9", disc="1/2")
        db = SessionLocal()
        try:
            scan_library(lib, tempfile.mkdtemp(), db)
            row = db.query(Audio).filter(Audio.filepath == wav).first()
            assert (row.track_number, row.disc_number) == (4, 1)
            assert row.title == "Harodien"
        finally:
            db.close()

    def test_rescan_backfills_track_numbers_once(self):
        """A row registered before track numbers were read gets them on rescan."""
        tmp, lib = self._mk_lib()
        adir = os.path.join(lib, "audio", "Ambient")
        tagged = os.path.join(adir, "tagged.wav")
        plain = os.path.join(adir, "plain.wav")
        archive = os.path.join(adir, "pack.zip")
        _write_wav_with_id3(tagged, track="2", title="Tagged", artist="Bard")
        _write_wav(plain)
        with zipfile.ZipFile(archive, "w") as z:
            z.writestr("inner.wav", b"")
        data = tempfile.mkdtemp()
        db = SessionLocal()
        try:
            scan_library(lib, data, db)
            paths = (tagged, plain, archive)
            # Put the rows back as a pre-upgrade scan left them.
            db.query(Audio).filter(Audio.filepath.in_(paths)).update(
                {"track_number": None, "disc_number": None, "title": ""},
                synchronize_session=False,
            )
            # A value already stored is kept, not replaced by the tag.
            db.query(Audio).filter(Audio.filepath == tagged).update(
                {"artist": "Edited"}, synchronize_session=False
            )
            db.commit()

            scan_library(lib, data, db)
            db.expire_all()
            rows = {r.filepath: r for r in db.query(Audio).filter(Audio.filepath.in_(paths))}
            assert (rows[tagged].track_number, rows[tagged].disc_number) == (2, 0)
            assert (rows[tagged].title, rows[tagged].artist) == ("Tagged", "Edited")
            assert (rows[plain].track_number, rows[plain].disc_number) == (0, 0)
            assert (rows[archive].track_number, rows[archive].disc_number) == (0, 0)
        finally:
            db.close()

    def test_audio_exts_cover_target_formats(self):
        for ext in (".mp3", ".ogg", ".opus", ".flac", ".wav", ".m4a", ".m4b", ".aac"):
            assert ext in AUDIO_EXTS

    def test_scan_registers_m4b_audiobook(self):
        tmp, lib = self._mk_lib()
        path = os.path.join(lib, "audio", "Ambient", f"book-{uuid.uuid4().hex[:6]}.m4b")
        shutil.copy(M4B_FIXTURE, path)
        db = SessionLocal()
        try:
            stats = scan_library(lib, tempfile.mkdtemp(), db)
            assert stats["new_audio"] >= 1
            row = db.query(Audio).filter(Audio.filepath == path).first()
            assert row is not None
            assert row.title == "Test Audiobook"
            assert row.duration > 0
            assert row.has_artwork is True
        finally:
            db.close()


class TestAudioScanFailures:
    """The audio walk skips or rolls back one track and carries on with the rest."""

    def _lib(self):
        lib = os.path.join(tempfile.mkdtemp(), "library")
        adir = os.path.join(lib, "audio", f"Set-{uuid.uuid4().hex[:6]}")
        os.makedirs(adir)
        return lib, adir

    def _locked_on(self, monkeypatch, prefix, needle):
        """Make the DB step whose label starts with ``prefix`` find the database locked for ``needle``."""
        from backend.indexer import media

        real = media._db_call

        def fake(fn, label):
            if label.startswith(prefix) and needle in label:
                raise DatabaseBusyError(label)
            return real(fn, label)

        monkeypatch.setattr(media, "_db_call", fake)

    def _row(self, db, path):
        return db.query(Audio).filter(Audio.filepath == path).first()

    def test_query_hang_skips_the_track(self, monkeypatch):
        lib, adir = self._lib()
        wav = os.path.join(adir, "hang.wav")
        _write_wav(wav)
        self._locked_on(monkeypatch, "query audio", wav)
        db = SessionLocal()
        try:
            stats = scan_library(lib, tempfile.mkdtemp(), db)
            assert stats["errors"] >= 1
            assert self._row(db, wav) is None
        finally:
            db.close()

    def test_commit_hang_rolls_back_the_insert(self, monkeypatch):
        lib, adir = self._lib()
        wav = os.path.join(adir, "stuck.wav")
        _write_wav(wav)
        self._locked_on(monkeypatch, "commit audio", wav)
        db = SessionLocal()
        try:
            stats = scan_library(lib, tempfile.mkdtemp(), db)
            assert stats["errors"] >= 1
            assert self._row(db, wav) is None
        finally:
            db.close()

    def test_backfill_commit_hang_leaves_the_row_to_retry(self, monkeypatch):
        lib, adir = self._lib()
        wav = os.path.join(adir, "later.wav")
        _write_wav_with_id3(wav, track="5")
        data = tempfile.mkdtemp()
        db = SessionLocal()
        try:
            scan_library(lib, data, db)
            db.query(Audio).filter(Audio.filepath == wav).update(
                {"track_number": None}, synchronize_session=False
            )
            db.commit()
            self._locked_on(monkeypatch, "commit audio", wav)
            stats = scan_library(lib, data, db)
            assert stats["errors"] >= 1
            db.expire_all()
            # Rolled back, so the next scan tries again.
            assert self._row(db, wav).track_number is None
        finally:
            db.close()

    def test_duplicate_insert_is_skipped(self, monkeypatch):
        from sqlalchemy.exc import IntegrityError
        from backend.indexer import media

        lib, adir = self._lib()
        wav = os.path.join(adir, "twice.wav")
        _write_wav(wav)
        real = media._db_call

        def fake(fn, label):
            if label.startswith("commit audio") and wav in label:
                raise IntegrityError("INSERT", {}, Exception("UNIQUE constraint failed"))
            return real(fn, label)

        monkeypatch.setattr(media, "_db_call", fake)
        db = SessionLocal()
        try:
            stats = scan_library(lib, tempfile.mkdtemp(), db)
            assert stats["errors"] == 0
            assert self._row(db, wav) is None
        finally:
            db.close()

    def test_unstattable_file_is_skipped(self, monkeypatch):
        from backend.indexer import media

        lib, adir = self._lib()
        wav = os.path.join(adir, "vanishing.wav")
        _write_wav(wav)
        real = media.file_signature
        monkeypatch.setattr(media, "file_signature", lambda p: None if p == wav else real(p))
        db = SessionLocal()
        try:
            scan_library(lib, tempfile.mkdtemp(), db)
            assert self._row(db, wav) is None
        finally:
            db.close()

    def test_ignored_track_is_not_registered(self):
        lib, adir = self._lib()
        kept = os.path.join(adir, "kept.wav")
        skipped = os.path.join(adir, "skipped.wav")
        _write_wav(kept)
        _write_wav(skipped)
        with open(os.path.join(lib, ".grimoireignore"), "w") as f:
            f.write("skipped.wav\n")
        db = SessionLocal()
        try:
            scan_library(lib, tempfile.mkdtemp(), db)
            assert self._row(db, kept) is not None
            assert self._row(db, skipped) is None
        finally:
            db.close()
