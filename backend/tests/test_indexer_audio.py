"""Tests for the audio-specific indexer helpers and scan path.

Covers the metadata reader, folder/embedded-artwork lookup, and the audio scan
loop in scan_library (the code added for the audio library feature).
"""
import os
import tempfile
import uuid
import wave

from PIL import Image

from backend.config import SessionLocal
from backend.models import Audio
from backend.indexer import (
    AUDIO_EXTS,
    _read_audio_metadata,
    _find_folder_artwork,
    _extract_embedded_art,
    _has_embedded_art,
    scan_library,
)


def _write_wav(path, seconds=1):
    with wave.open(path, "w") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(8000)
        w.writeframes(b"\x00\x00" * (8000 * seconds))


def _write_wav_with_id3(path, *, title="", artist="", album="", with_art=False):
    _write_wav(path)
    from mutagen.wave import WAVE
    from mutagen.id3 import TIT2, TPE1, TALB, APIC

    f = WAVE(path)
    f.add_tags()
    if title:
        f.tags.add(TIT2(encoding=3, text=title))
    if artist:
        f.tags.add(TPE1(encoding=3, text=artist))
    if album:
        f.tags.add(TALB(encoding=3, text=album))
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

    def test_audio_exts_cover_target_formats(self):
        for ext in (".mp3", ".ogg", ".opus", ".flac", ".wav", ".m4a", ".aac"):
            assert ext in AUDIO_EXTS
