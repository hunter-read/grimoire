"""Skipping a thumbnail that keeps killing the scan (issue #762).

A thumbnail still made in the server process can take it down, and the restarted
server's startup scan then meets the same file again. ``quarantine`` notes each
one in flight; a note left behind is a strike, and two strikes in a row skip
that file's thumbnail until it changes on disk.
"""
import json
import logging
import os
import threading

import pytest

from backend import config
from backend.indexer import quarantine, thumbnails


@pytest.fixture
def data_dir(tmp_path, monkeypatch):
    monkeypatch.setattr(config, "DATA_PATH", str(tmp_path))
    yield tmp_path
    quarantine.abandon()


@pytest.fixture
def image(tmp_path):
    path = tmp_path / "library" / "maps" / "huge.png"
    path.parent.mkdir(parents=True)
    path.write_bytes(b"\x89PNG not really")
    return str(path)


def _inflight(data_dir):
    return data_dir / quarantine.INFLIGHT_FILE


def _entries(data_dir):
    path = data_dir / quarantine.QUARANTINE_FILE
    return json.loads(path.read_text()) if path.exists() else {}


def _die_on(data_dir, filepath):
    """What a scan killed mid-thumbnail leaves behind."""
    _inflight(data_dir).write_text(json.dumps({"path": filepath}))


class TestRecording:
    def test_nothing_is_noted_outside_a_scan(self, data_dir, image):
        with quarantine.making_thumbnail(image):
            assert not _inflight(data_dir).exists()
        assert quarantine.skip_thumbnail(image) is False

    def test_the_file_is_noted_while_its_thumbnail_is_made(self, data_dir, image):
        quarantine.begin_scan()
        with quarantine.making_thumbnail(image):
            assert json.loads(_inflight(data_dir).read_text()) == {"path": image}
        assert not _inflight(data_dir).exists()
        quarantine.end_scan()

    def test_an_error_is_not_a_death(self, data_dir, image):
        quarantine.begin_scan()
        with pytest.raises(RuntimeError):
            with quarantine.making_thumbnail(image):
                raise RuntimeError("bad image")
        assert not _inflight(data_dir).exists()
        quarantine.end_scan()

    def test_another_thread_is_not_recorded(self, data_dir, image):
        quarantine.begin_scan()
        seen = []

        def other():
            with quarantine.making_thumbnail(image):
                seen.append(_inflight(data_dir).exists())

        thread = threading.Thread(target=other)
        thread.start()
        thread.join()
        assert seen == [False]
        quarantine.end_scan()

    def test_end_scan_from_another_thread_is_ignored(self, data_dir, image):
        quarantine.begin_scan()
        thread = threading.Thread(target=quarantine.end_scan)
        thread.start()
        thread.join()
        assert quarantine._recording()
        quarantine.end_scan()
        assert not quarantine._recording()

    def test_abandon_stops_recording_and_clears_the_note(self, data_dir, image):
        quarantine.begin_scan()
        _die_on(data_dir, image)
        quarantine.abandon()
        assert not _inflight(data_dir).exists()
        with quarantine.making_thumbnail(image):
            assert not _inflight(data_dir).exists()


class TestStrikes:
    def test_one_death_is_a_warning_not_a_skip(self, data_dir, image, caplog):
        _die_on(data_dir, image)
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            quarantine.begin_scan()
        assert "If it stops there again" in caplog.text
        assert _entries(data_dir)[image]["strikes"] == 1
        assert not _inflight(data_dir).exists()
        assert quarantine.skip_thumbnail(image) is False
        quarantine.end_scan()

    def test_two_deaths_in_a_row_skip_the_thumbnail(self, data_dir, image, caplog):
        _die_on(data_dir, image)
        quarantine.begin_scan()
        _die_on(data_dir, image)
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            quarantine.begin_scan()
            assert quarantine.skip_thumbnail(image) is True
            assert quarantine.skip_thumbnail(image) is True
        assert "2 times in a row" in caplog.text
        assert caplog.text.count("Skipping the thumbnail") == 1
        quarantine.end_scan()

    def test_a_changed_file_is_tried_again(self, data_dir, image):
        _die_on(data_dir, image)
        quarantine.begin_scan()
        _die_on(data_dir, image)
        quarantine.begin_scan()
        with open(image, "ab") as fh:
            fh.write(b"repaired")
        assert quarantine.skip_thumbnail(image) is False
        # A death on the changed file starts the count again.
        _die_on(data_dir, image)
        quarantine.begin_scan()
        assert _entries(data_dir)[image]["strikes"] == 1
        quarantine.end_scan()

    def test_a_thumbnail_made_without_dying_clears_the_strike(self, data_dir, image):
        _die_on(data_dir, image)
        quarantine.begin_scan()
        with quarantine.making_thumbnail(image):
            pass
        quarantine.end_scan()
        assert _entries(data_dir) == {}
        assert not (data_dir / quarantine.QUARANTINE_FILE).exists()

    def test_a_file_gone_from_disk_gets_a_strike_without_a_signature(self, data_dir):
        _die_on(data_dir, "/nowhere/gone.png")
        quarantine.begin_scan()
        quarantine.end_scan()
        assert _entries(data_dir)["/nowhere/gone.png"] == {
            "strikes": 1, "mtime": None, "size": None,
        }

    def test_unreadable_state_files_are_ignored(self, data_dir, image, caplog):
        _inflight(data_dir).write_text("{not json")
        (data_dir / quarantine.QUARANTINE_FILE).write_text("[1, 2]")
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            quarantine.begin_scan()
        assert "Couldn't read" in caplog.text
        assert quarantine.skip_thumbnail(image) is False
        quarantine.end_scan()

    def test_a_quarantine_that_cannot_be_saved_is_logged(self, data_dir, image, monkeypatch, caplog):
        _die_on(data_dir, image)

        def refuse(*_args):
            raise OSError("read-only")

        monkeypatch.setattr(quarantine, "_write_json", refuse)
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            quarantine.begin_scan()
            with quarantine.making_thumbnail(image):
                pass
        assert "Couldn't save the scan quarantine" in caplog.text
        quarantine.end_scan()

    def test_a_note_that_cannot_be_removed_is_logged(self, data_dir, monkeypatch, caplog):
        def refuse(_path):
            raise PermissionError("nope")

        monkeypatch.setattr(os, "remove", refuse)
        with caplog.at_level(logging.WARNING, logger="grimoire.indexer"):
            quarantine._remove(str(_inflight(data_dir)))
        assert "Couldn't remove" in caplog.text


class TestGenerateThumbnail:
    def test_a_quarantined_image_is_not_opened(self, data_dir, image, monkeypatch):
        _die_on(data_dir, image)
        quarantine.begin_scan()
        _die_on(data_dir, image)
        quarantine.begin_scan()
        calls = []
        monkeypatch.setattr(thumbnails, "_thumbnail_in_thread", lambda *a: calls.append(a))
        assert thumbnails.generate_thumbnail(image, str(data_dir / "out.webp")) is False
        assert calls == []
        quarantine.end_scan()

    def test_an_image_is_noted_while_it_renders(self, data_dir, image, monkeypatch):
        quarantine.begin_scan()
        seen = []

        def render(*_args):
            seen.append(json.loads(_inflight(data_dir).read_text())["path"])
            return True

        monkeypatch.setattr(thumbnails, "_thumbnail_in_thread", render)
        assert thumbnails.generate_thumbnail(image, str(data_dir / "out.webp")) is True
        assert seen == [image]
        assert not _inflight(data_dir).exists()
        quarantine.end_scan()
