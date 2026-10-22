"""Watching the library for changes and rescanning by itself (issue #670)."""
import os
import tempfile
import threading
import time
from pathlib import Path
from typing import Optional

import pytest
from watchdog.events import (
    DirModifiedEvent,
    DirMovedEvent,
    FileClosedEvent,
    FileCreatedEvent,
    FileDeletedEvent,
    FileMovedEvent,
    FileOpenedEvent,
)

from backend import config
from backend.config import SessionLocal
from backend.library_watch import settings as watch_settings
from backend.library_watch.changes import (
    CREATED,
    DELETED,
    MODIFIED,
    MOVED,
    Change,
    is_relevant,
    plan_scan,
)
from backend.library_watch.watcher import (
    ChangeQueue,
    LibraryWatcher,
    Supervisor,
    describe_error,
)
from backend.models import AppSetting


def _exists(*_args) -> bool:
    return True


class TestIsRelevant:
    @pytest.mark.parametrize(
        "rel",
        [
            "books/D&D/core/phb.pdf",
            "maps/Dungeons/cave.png",
            "audio/ambience/rain.mp3",
            "books/Shelf/.publisher-container",
            "books/D&D/.nsfw",
            "books/.grimoireignore",
            ".grimoireignore",
            "books/D&D/tags.json",
        ],
    )
    def test_content_and_markers_count(self, rel):
        assert is_relevant(rel, False, CREATED)

    @pytest.mark.parametrize(
        "rel",
        [
            "README.txt",
            "other/thing.pdf",
            "books/D&D/core/.DS_Store",
            "books/D&D/@eaDir/phb.pdf@SynoEAStream",
            "books/D&D/.hidden/phb.pdf",
            "books/D&D/core/phb.pdf.part",
            "books/D&D/core/phb.pdf.crdownload",
            "books/D&D/core/phb.pdf~",
            "books/D&D/core/Thumbs.db",
            "books/D&D/core/phb.opf",
            "books/D&D/core/phb.cover.jpg",
            "../outside.pdf",
            "",
        ],
    )
    def test_noise_does_not(self, rel):
        assert not is_relevant(rel, False, CREATED)

    def test_folders_count_unless_only_modified(self):
        assert is_relevant("books/New System", True, CREATED)
        assert is_relevant("books/Old System", True, DELETED)
        assert not is_relevant("books/D&D", True, MODIFIED)
        assert not is_relevant("books/D&D/@eaDir", True, CREATED)
        assert not is_relevant("books/.Trash", True, CREATED)

    def test_collection_names_are_case_insensitive(self):
        assert is_relevant("Books/D&D/core/phb.pdf", False, CREATED)


class TestPlanScan:
    def test_changes_in_one_shelf_scan_that_shelf(self):
        changes = [
            Change("books/D&D/core/a.pdf", False, CREATED),
            Change("books/D&D/adventures/b.pdf", False, DELETED),
        ]
        assert plan_scan(changes, _exists) == "books/D&D"

    def test_a_file_moved_between_shelves_scans_everything(self):
        changes = [
            Change("books/A/core/a.pdf", False, DELETED),
            Change("books/B/core/a.pdf", False, CREATED),
        ]
        assert plan_scan(changes, _exists) is None

    def test_a_books_folder_change_scans_everything(self):
        """Only a full scan adopts a renamed system or prunes a vanished one."""
        assert plan_scan([Change("books/D&D/core", True, MOVED)], _exists) is None
        assert plan_scan([Change("books/Shelf/Edition", True, DELETED)], _exists) is None

    def test_folder_changes_outside_books_stay_scoped(self):
        assert plan_scan([Change("maps/Dungeons/caves", True, CREATED)], _exists) == (
            "maps/Dungeons"
        )

    def test_ignore_rules_and_collection_roots_scan_everything(self):
        assert plan_scan([Change("books/D&D/.grimoireignore", False, MODIFIED)], _exists) is None
        assert plan_scan([Change("maps/loose.png", False, CREATED)], _exists) is None
        assert plan_scan([Change(".grimoireignore", False, CREATED)], _exists) is None

    def test_a_vanished_shelf_scans_everything(self):
        changes = [Change("maps/Gone/a.png", False, DELETED)]
        assert plan_scan(changes, lambda *_: False) is None


class FakeClock:
    def __init__(self) -> None:
        self.now = 1000.0

    def __call__(self) -> float:
        return self.now


class TestChangeQueue:
    def test_waits_for_quiet(self):
        clock = FakeClock()
        queue = ChangeQueue(delay=10, max_wait=300, clock=clock)
        assert queue.wait_seconds() is None

        queue.add(Change("books/A/a.pdf", False, CREATED))
        assert queue.wait_seconds() == 10
        clock.now += 8
        queue.add(Change("books/A/b.pdf", False, CREATED))
        assert queue.wait_seconds() == 10, "a new change restarts the quiet period"
        clock.now += 10
        assert queue.wait_seconds() == 0

    def test_never_waits_past_the_cap(self):
        clock = FakeClock()
        queue = ChangeQueue(delay=10, max_wait=30, clock=clock)
        queue.add(Change("books/A/a.pdf", False, CREATED))
        for _ in range(5):
            clock.now += 8
            queue.add(Change("books/A/a.pdf", False, MODIFIED))
        assert queue.wait_seconds() == 0

    def test_take_empties_it(self):
        queue = ChangeQueue(delay=1, clock=FakeClock())
        queue.add(Change("books/A/a.pdf", False, CREATED))
        queue.add(Change("books/A/a.pdf", False, CREATED))
        assert len(queue) == 1
        assert [c.path for c in queue.take()] == ["books/A/a.pdf"]
        assert len(queue) == 0
        assert queue.wait_seconds() is None


class FakeObserver:
    def __init__(self, fail: Optional[BaseException] = None) -> None:
        self.fail = fail
        self.alive = False
        self.scheduled: list = []

    def schedule(self, handler, path, recursive=False):
        self.scheduled.append((handler, path, recursive))

    def start(self):
        if self.fail is not None:
            raise self.fail
        self.alive = True

    def stop(self):
        self.alive = False

    def join(self, timeout=None):
        pass

    def is_alive(self):
        return self.alive


def _library() -> Path:
    root = Path(tempfile.mkdtemp()) / "library"
    (root / "books" / "D&D" / "core").mkdir(parents=True)
    (root / "maps" / "Dungeons").mkdir(parents=True)
    return root


def _watcher(root: Path, scans: list, busy=lambda: False, **kw) -> LibraryWatcher:
    return LibraryWatcher(
        str(root),
        polling=False,
        poll_interval=1,
        delay=kw.pop("delay", 0.05),
        scan=scans.append,
        busy=busy,
        observer_factory=lambda polling, interval: FakeObserver(),
        **kw,
    )


class TestLibraryWatcherEvents:
    def test_events_become_changes(self):
        root = _library()
        watcher = _watcher(root, [])
        watcher.handle(FileCreatedEvent(str(root / "books/D&D/core/phb.pdf")))
        watcher.handle(FileClosedEvent(str(root / "books/D&D/core/phb.pdf")))
        watcher.handle(FileOpenedEvent(str(root / "books/D&D/core/other.pdf")))
        watcher.handle(DirModifiedEvent(str(root / "books/D&D/core")))
        watcher.handle(FileCreatedEvent(str(root / "books/D&D/core/.DS_Store")))
        assert {(c.path, c.kind) for c in watcher.queue.take()} == {
            ("books/D&D/core/phb.pdf", CREATED),
            ("books/D&D/core/phb.pdf", MODIFIED),
        }

    def test_a_move_records_both_ends(self):
        root = _library()
        watcher = _watcher(root, [])
        watcher.handle(
            DirMovedEvent(str(root / "books/Old"), str(root / "books/New"))
        )
        assert {c.path for c in watcher.queue.take()} == {"books/Old", "books/New"}

    def test_ignored_paths_are_skipped_and_rules_reload(self):
        root = _library()
        (root / "books" / ".grimoireignore").write_text("skipme/\n")
        watcher = _watcher(root, [])
        watcher.handle(FileCreatedEvent(str(root / "books/D&D/skipme/a.pdf")))
        assert len(watcher.queue) == 0

        (root / "books" / ".grimoireignore").write_text("")
        watcher.handle(FileClosedEvent(str(root / "books/.grimoireignore")))
        watcher.handle(FileCreatedEvent(str(root / "books/D&D/skipme/a.pdf")))
        assert {c.path for c in watcher.queue.take()} == {
            "books/.grimoireignore",
            "books/D&D/skipme/a.pdf",
        }

    def test_bytes_paths_are_decoded(self):
        root = _library()
        watcher = _watcher(root, [])
        watcher.handle(FileDeletedEvent(os.fsencode(str(root / "maps/Dungeons/cave.png"))))
        assert [c.path for c in watcher.queue.take()] == ["maps/Dungeons/cave.png"]


class TestLibraryWatcherScanning:
    def test_run_pending_scopes_the_scan(self):
        root = _library()
        scans: list = []
        watcher = _watcher(root, scans)
        watcher.handle(FileCreatedEvent(str(root / "maps/Dungeons/cave.png")))
        assert watcher.run_pending() == "maps/Dungeons"
        assert scans == ["maps/Dungeons"]
        assert watcher.run_pending() is None, "nothing left to scan"

    def test_a_requested_full_scan_scans_everything(self):
        root = _library()
        scans: list = []
        watcher = _watcher(root, scans)
        watcher.request_full_scan()
        assert watcher.run_pending() == ""
        assert scans == [None]

    def test_run_pending_falls_back_to_a_full_scan(self):
        root = _library()
        scans: list = []
        watcher = _watcher(root, scans)
        watcher.handle(FileMovedEvent(str(root / "books/A/x.pdf"), str(root / "books/B/x.pdf")))
        assert watcher.run_pending() == ""
        assert scans == [None]

    def test_a_failing_scan_does_not_end_the_watch(self):
        root = _library()

        def boom(scope):
            raise RuntimeError("disk on fire")

        watcher = LibraryWatcher(
            str(root),
            polling=False,
            poll_interval=1,
            delay=0.01,
            scan=boom,
            busy=lambda: False,
            observer_factory=lambda polling, interval: FakeObserver(),
        )
        watcher.handle(FileCreatedEvent(str(root / "maps/Dungeons/a.png")))
        assert watcher.run_pending() == "maps/Dungeons"

    def test_the_loop_scans_after_quiet_and_waits_out_a_running_scan(self):
        root = _library()
        scans: list = []
        busy = {"value": True}
        done = threading.Event()

        def scan(scope):
            scans.append(scope)
            done.set()

        watcher = LibraryWatcher(
            str(root),
            polling=False,
            poll_interval=1,
            delay=0.05,
            scan=scan,
            busy=lambda: busy["value"],
            observer_factory=lambda polling, interval: FakeObserver(),
        )
        watcher.start()
        try:
            assert watcher.is_alive()
            watcher.handle(FileCreatedEvent(str(root / "maps/Dungeons/a.png")))
            time.sleep(0.3)
            assert scans == [], "must not scan while another scan runs"
            busy["value"] = False
            assert done.wait(10)
            assert scans == ["maps/Dungeons"]
        finally:
            watcher.stop()
        assert not watcher.is_alive()


class TestRealObserver:
    """The watchdog observers themselves, against a real folder."""

    @pytest.mark.parametrize("polling", [False, True])
    def test_a_new_file_is_scanned(self, polling):
        root = _library()
        done = threading.Event()
        scans: list = []

        def scan(scope):
            scans.append(scope)
            done.set()

        watcher = LibraryWatcher(
            str(root),
            polling=polling,
            poll_interval=0.2,
            delay=0.2,
            scan=scan,
            busy=lambda: False,
        )
        watcher.start()
        try:
            time.sleep(0.5)  # let the observer take its first look
            (root / "maps" / "Dungeons" / "cave.png").write_bytes(b"png")
            assert done.wait(15), "the change was never noticed"
            assert scans[0] == "maps/Dungeons"
        finally:
            watcher.stop()


class TestSettings:
    def test_env_pins_win(self, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", False)
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", "poll")
        raw = {"library_watch_enabled": "true", "library_watch_mode": "events"}
        assert watch_settings.enabled(raw) is False
        assert watch_settings.mode(raw) == "poll"

    def test_defaults_and_stored_values(self, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", None)
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", None)
        assert watch_settings.enabled({}) is True
        assert watch_settings.mode({}) == "auto"
        assert watch_settings.enabled({"library_watch_enabled": "false"}) is False
        assert watch_settings.mode({"library_watch_mode": "events"}) == "events"
        assert watch_settings.mode({"library_watch_mode": "bogus"}) == "auto"

    def test_state_parsing(self):
        assert watch_settings.state({}) == {"state": "off", "detail": ""}
        assert watch_settings.state({"library_watch_state": "not json"})["state"] == "off"
        assert watch_settings.state(
            {"library_watch_state": '{"state": "polling", "detail": ""}'}
        ) == {"state": "polling", "detail": ""}

    def test_filesystem_type_takes_the_deepest_mount(self, tmp_path):
        mounts = tmp_path / "mounts"
        mounts.write_text(
            "overlay / overlay rw 0 0\n"
            "//nas/share /library cifs rw 0 0\n"
            "/dev/sda1 /library/local ext4 rw 0 0\n"
            "nas:/export /with\\040space nfs4 rw 0 0\n"
        )
        assert watch_settings.filesystem_type("/library/books", str(mounts)) == "cifs"
        assert watch_settings.filesystem_type("/library/local/x", str(mounts)) == "ext4"
        assert watch_settings.filesystem_type("/with space/books", str(mounts)) == "nfs4"
        assert watch_settings.filesystem_type("/data", str(mounts)) == "overlay"
        assert watch_settings.filesystem_type("/x", str(tmp_path / "absent")) is None

    @pytest.mark.parametrize(
        "mode,fs,expected",
        [
            ("poll", "ext4", True),
            ("events", "nfs4", False),
            ("auto", "cifs", True),
            ("auto", "fuse.rclone", True),
            ("auto", "ext4", False),
            ("auto", None, False),
        ],
    )
    def test_resolve_polling(self, mode, fs, expected):
        assert watch_settings.resolve_polling(mode, fs) is expected


class FakeWatcher:
    instances: list = []

    def __init__(self, library_path, *, polling, poll_interval, delay, scan, busy, fail=None):
        self.polling = polling
        self.started = False
        self.catch_up = False
        self.stopped = False
        self.fail = fail
        FakeWatcher.instances.append(self)

    def start(self):
        if self.fail:
            raise self.fail
        self.started = True

    def request_full_scan(self):
        self.catch_up = True

    def stop(self):
        self.stopped = True

    def is_alive(self):
        return self.started and not self.stopped


def _set_settings(**values) -> None:
    db = SessionLocal()
    try:
        for key, value in values.items():
            row = db.query(AppSetting).filter_by(key=key).first()
            if row is None:
                db.add(AppSetting(key=key, value=value))
            else:
                row.value = value
        db.commit()
    finally:
        db.close()


def _stored_state() -> dict:
    db = SessionLocal()
    try:
        return watch_settings.state({r.key: r.value for r in db.query(AppSetting).all()})
    finally:
        db.close()


@pytest.fixture
def supervised(monkeypatch):
    monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", None)
    monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", None)
    FakeWatcher.instances = []
    root = _library()
    fs_type = {"value": "ext4"}
    sup = Supervisor(
        str(root),
        SessionLocal,
        scan=lambda scope: None,
        busy=lambda: False,
        delay=1,
        poll_interval=60,
        watcher_factory=FakeWatcher,
        fs_type=lambda path: fs_type["value"],
    )
    yield sup, fs_type, root
    _set_settings(library_watch_enabled="true", library_watch_mode="auto")


class TestSupervisor:
    def test_starts_restarts_and_stops_with_the_settings(self, supervised):
        sup, fs_type, _root = supervised
        _set_settings(library_watch_enabled="true", library_watch_mode="auto")

        sup.sync()
        assert len(FakeWatcher.instances) == 1
        assert FakeWatcher.instances[0].polling is False
        assert _stored_state()["state"] == "watching"

        sup.sync()
        assert len(FakeWatcher.instances) == 1, "an unchanged setting keeps the watcher"

        fs_type["value"] = "nfs4"
        sup.sync()
        assert len(FakeWatcher.instances) == 2
        assert FakeWatcher.instances[0].stopped
        assert FakeWatcher.instances[1].polling is True
        assert _stored_state()["state"] == "polling"

        _set_settings(library_watch_enabled="false")
        sup.sync()
        assert FakeWatcher.instances[1].stopped
        assert sup.watcher is None
        assert _stored_state()["state"] == "off"

        _set_settings(library_watch_enabled="true")
        sup.sync()
        assert [w.catch_up for w in FakeWatcher.instances] == [False, True, True], (
            "only a watcher started with the process skips the catch-up scan"
        )

    def test_turned_on_after_starting_off_catches_up(self, supervised):
        sup, _fs, _root = supervised
        _set_settings(library_watch_enabled="false")
        sup.sync()
        assert FakeWatcher.instances == []
        _set_settings(library_watch_enabled="true")
        sup.sync()
        assert FakeWatcher.instances[0].catch_up is True

    def test_a_dead_watcher_is_restarted(self, supervised):
        sup, _fs, _root = supervised
        _set_settings(library_watch_enabled="true", library_watch_mode="events")
        sup.sync()
        FakeWatcher.instances[0].stopped = True  # the observer died
        sup.sync()
        assert len(FakeWatcher.instances) == 2
        assert FakeWatcher.instances[1].is_alive()

    def test_a_watcher_that_cannot_start_is_reported(self, supervised, monkeypatch):
        sup, _fs, _root = supervised
        _set_settings(library_watch_enabled="true", library_watch_mode="events")

        def failing(*args, **kwargs):
            return FakeWatcher(*args, fail=OSError(28, "No space left on device"), **kwargs)

        monkeypatch.setattr(sup, "_watcher_factory", failing)
        sup.sync()
        assert sup.watcher is None
        state = _stored_state()
        assert state["state"] == "unavailable"
        assert "max_user_watches" in state["detail"]

    def test_a_missing_library_is_reported(self, supervised):
        sup, _fs, root = supervised
        _set_settings(library_watch_enabled="true")
        sup.library_path = str(root / "nope")
        sup.sync()
        assert _stored_state() == {
            "state": "unavailable",
            "detail": "The library folder does not exist.",
        }

    def test_the_thread_runs_and_stops(self, supervised):
        sup, _fs, _root = supervised
        _set_settings(library_watch_enabled="true", library_watch_mode="auto")
        sup.start()
        try:
            deadline = time.time() + 5
            while not FakeWatcher.instances and time.time() < deadline:
                time.sleep(0.02)
            assert FakeWatcher.instances
            sup.poke()
        finally:
            sup.stop()
        assert FakeWatcher.instances[-1].stopped


def test_describe_error():
    assert "max_user_watches" in describe_error(OSError(28, "No space left on device"))
    assert describe_error(RuntimeError("boom")) == "boom"
    assert describe_error(RuntimeError()) == "RuntimeError"


class TestSettingsApi:
    def test_get_reports_the_watcher(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", None)
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", None)
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["library_watch_enabled"] is True
        assert body["library_watch_mode"] == "auto"
        assert body["library_watch_env_locked"] is False
        assert body["library_watch_mode_env_locked"] is False
        assert set(body["library_watch_state"]) == {"state", "detail"}
        assert body["library_watch_poll_interval"] == config.LIBRARY_WATCH_POLL_INTERVAL

    def test_patch_saves_both(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", None)
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", None)
        try:
            resp = client.patch(
                "/api/settings",
                headers=admin_headers,
                json={"library_watch_enabled": False, "library_watch_mode": "poll"},
            )
            assert resp.status_code == 200, resp.text
            assert resp.json()["library_watch_enabled"] is False
            assert resp.json()["library_watch_mode"] == "poll"
        finally:
            client.patch(
                "/api/settings",
                headers=admin_headers,
                json={"library_watch_enabled": True, "library_watch_mode": "auto"},
            )

    def test_patch_rejects_an_unknown_mode(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", None)
        resp = client.patch(
            "/api/settings", headers=admin_headers, json={"library_watch_mode": "sometimes"}
        )
        assert resp.status_code == 400

    def test_env_locks_refuse_changes(self, client, admin_headers, monkeypatch):
        monkeypatch.setattr(config, "LIBRARY_WATCH_ENV", True)
        monkeypatch.setattr(config, "LIBRARY_WATCH_MODE_ENV", "events")
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["library_watch_env_locked"] is True
        assert body["library_watch_mode_env_locked"] is True
        assert body["library_watch_mode"] == "events"
        assert (
            client.patch(
                "/api/settings", headers=admin_headers, json={"library_watch_enabled": False}
            ).status_code
            == 400
        )
        assert (
            client.patch(
                "/api/settings", headers=admin_headers, json={"library_watch_mode": "poll"}
            ).status_code
            == 400
        )

    def test_players_cannot_change_it(self, client, player_headers):
        resp = client.patch(
            "/api/settings", headers=player_headers, json={"library_watch_enabled": False}
        )
        assert resp.status_code == 403


class TestModuleEntryPoints:
    """``library_watch.start/poke/stop``, as ``main.lifespan`` calls them."""

    def test_start_poke_stop(self, monkeypatch):
        import backend.library_watch as library_watch

        made: list = []

        class RecordingSupervisor:
            def __init__(self, library_path, session_factory, **kwargs):
                self.library_path = library_path
                self.kwargs = kwargs
                self.calls: list = []
                made.append(self)

            def start(self):
                self.calls.append("start")

            def poke(self):
                self.calls.append("poke")

            def stop(self):
                self.calls.append("stop")

        monkeypatch.setattr(library_watch, "Supervisor", RecordingSupervisor)
        scanned: list = []
        monkeypatch.setattr(
            "backend.routers.library.run_rescan_sync",
            lambda scope_path=None: scanned.append(scope_path),
        )

        library_watch.poke()  # nothing running yet: a no-op
        library_watch.start("/library")
        library_watch.poke()
        library_watch.start("/library")  # a second start replaces the first
        library_watch.stop()
        library_watch.stop()  # and stopping twice is harmless

        assert made[0].calls == ["start", "poke", "stop"]
        assert made[1].calls == ["start", "stop"]
        assert made[0].kwargs["delay"] == config.LIBRARY_WATCH_DELAY
        assert made[0].kwargs["poll_interval"] == config.LIBRARY_WATCH_POLL_INTERVAL
        made[0].kwargs["scan"]("books/D&D")
        assert scanned == ["books/D&D"]
