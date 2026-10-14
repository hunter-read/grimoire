"""Tests for reading audiobook chapter markers (issue #564).

The two ``.m4b`` fixtures were made with ffmpeg from the same three chapters:
``audiobook.m4b`` carries both a Nero ``chpl`` list and a QuickTime chapter
track (ffmpeg's default), ``audiobook_quicktime_chapters.m4b`` only the chapter
track (``-movflags disable_chpl``), which is how Apple tools write them.
"""
import os
import shutil
import struct
import tempfile

from mutagen.id3 import CHAP, ID3, TIT2

from backend.indexer import chapters as chapters_mod
from backend.indexer import read_chapters

FIXTURES = os.path.join(os.path.dirname(__file__), "fixtures", "audio")
BOTH = os.path.join(FIXTURES, "audiobook.m4b")
QUICKTIME_ONLY = os.path.join(FIXTURES, "audiobook_quicktime_chapters.m4b")

EXPECTED = [
    {"start": 0.0, "title": "Prologue"},
    {"start": 0.4, "title": "Chapter 1 — The Crimson Throne"},
    {"start": 0.8, "title": "Epilogue"},
]


def _write_mp3_with_chapters(path, chapters):
    """A bare ID3 tag with CHAP frames - enough for the chapter reader."""
    open(path, "wb").close()
    tags = ID3()
    for i, (start_ms, title) in enumerate(chapters):
        sub = [TIT2(encoding=3, text=[title])] if title else []
        tags.add(
            CHAP(
                element_id=f"ch{i}",
                start_time=start_ms,
                end_time=start_ms + 1000,
                sub_frames=sub,
            )
        )
    tags.save(path)


class TestReadChaptersMp4:
    def test_reads_nero_chpl(self):
        # chpl starts are 100 ns units regardless of the movie timescale.
        assert read_chapters(BOTH) == EXPECTED

    def test_reads_quicktime_chapter_track(self):
        assert read_chapters(QUICKTIME_ONLY) == EXPECTED

    def test_falls_back_to_chapter_track_when_chpl_empty(self, monkeypatch):
        monkeypatch.setattr(chapters_mod, "_parse_chpl", lambda data: [])
        assert read_chapters(BOTH) == EXPECTED

    def test_m4a_without_chapters_is_empty(self, monkeypatch):
        # Same container, no chapter track referenced: nothing to read.
        monkeypatch.setattr(chapters_mod, "_tref_chap_ids", lambda tref: [])
        assert read_chapters(QUICKTIME_ONLY) == []

    def test_truncated_file_is_empty(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "broken.m4b")
        with open(BOTH, "rb") as src, open(path, "wb") as dst:
            dst.write(src.read()[:200])
        assert read_chapters(path) == []

    def test_mp4_without_moov_is_empty(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "bare.m4b")
        with open(path, "wb") as fh:
            fh.write(struct.pack(">I4s4sI", 16, b"ftyp", b"M4B ", 0))
        assert read_chapters(path) == []


class TestReadChaptersId3:
    def test_reads_chap_frames_in_start_order(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "book.mp3")
        _write_mp3_with_chapters(path, [(2500, "Two"), (0, "One")])
        assert read_chapters(path) == [
            {"start": 0.0, "title": "One"},
            {"start": 2.5, "title": "Two"},
        ]

    def test_untitled_chapter_has_blank_title(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "book.mp3")
        _write_mp3_with_chapters(path, [(0, "")])
        assert read_chapters(path) == [{"start": 0.0, "title": ""}]


class TestReadChaptersOtherInput:
    def test_unrecognised_format_is_empty(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "notes.txt")
        with open(path, "w") as fh:
            fh.write("not audio at all")
        assert read_chapters(path) == []

    def test_missing_file_is_empty(self):
        assert read_chapters("/tmp/definitely-missing-audiobook.m4b") == []

    def test_copy_keeps_chapters(self):
        # Reads depend only on content, never on the file name.
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "renamed.m4a")
        shutil.copy(QUICKTIME_ONLY, path)
        assert read_chapters(path) == EXPECTED


class TestParsers:
    def test_chpl_version_zero_has_no_reserved_bytes(self):
        title = "Intro".encode()
        data = b"\x00\x00\x00\x00" + bytes([1]) + struct.pack(">Q", 30_000_000)
        data += bytes([len(title)]) + title
        assert chapters_mod._parse_chpl(data) == [{"start": 3.0, "title": "Intro"}]

    def test_tref_skips_other_references(self):
        tref = struct.pack(">I4sI", 12, b"sync", 9) + struct.pack(">I4sII", 16, b"chap", 2, 3)
        assert chapters_mod._tref_chap_ids(tref) == [2, 3]

    def test_tref_stops_on_bad_box_size(self):
        assert chapters_mod._tref_chap_ids(struct.pack(">I4s", 4, b"chap")) == []

    def test_uniform_sample_sizes(self):
        stsz = struct.pack(">III", 0, 7, 3)
        assert chapters_mod._sample_sizes(stsz) == [7, 7, 7]

    def test_samples_per_chunk_follow_stsc_runs(self):
        runs = [(1, 2, 1), (3, 1, 1)]
        assert [chapters_mod._samples_in_chunk(runs, n) for n in (1, 2, 3, 4)] == [2, 2, 1, 1]

    def test_utf16_text_sample(self):
        tmp = tempfile.mkdtemp()
        path = os.path.join(tmp, "sample.bin")
        text = "﻿Kapitel".encode("utf-16-be")
        with open(path, "wb") as fh:
            fh.write(struct.pack(">H", len(text)) + text)
        with open(path, "rb") as fh:
            assert chapters_mod._read_text_sample(fh, 0, 2 + len(text)) == "Kapitel"

    def test_oversized_text_sample_is_skipped(self):
        with open(BOTH, "rb") as fh:
            assert chapters_mod._read_text_sample(fh, 0, 1_000_000) == ""

    def test_normalise_drops_negative_starts_and_caps_count(self, monkeypatch):
        monkeypatch.setattr(chapters_mod, "MAX_CHAPTERS", 2)
        raw = [
            {"start": -1, "title": "bad"},
            {"start": 3, "title": " c "},
            {"start": 1, "title": "a"},
            {"start": 2, "title": "b"},
        ]
        assert chapters_mod._normalise(raw) == [
            {"start": 1.0, "title": "a"},
            {"start": 2.0, "title": "b"},
        ]
