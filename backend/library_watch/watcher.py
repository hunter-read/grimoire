"""The watcher threads: notice changes, wait for quiet, then scan.

Three pieces, innermost first:

* :class:`ChangeQueue` collects relevant changes and decides when they are
  ready. A copy of a whole folder is hundreds of events over minutes; scanning
  on the first would index half a folder and then rescan for the rest. So it
  waits until the library has been quiet for ``delay`` seconds - but never more
  than ``max_wait`` after the first change, so a library that is always being
  written to (a download client saving into it) is still scanned.
* :class:`LibraryWatcher` runs a ``watchdog`` observer over the library -
  native filesystem events, or polling for network shares - feeds the queue,
  and runs the scan when it is ready. It never runs alongside another scan:
  while one is going it waits, keeping what it has collected, and scans after.
* :class:`Supervisor` keeps a watcher running to match the settings. It
  re-reads them every half minute (or at once when the settings change in this
  process), restarts a watcher whose observer has died, and records what it is
  doing so the admin UI can show it.
"""
import errno
import logging
import os
import threading
import time
from typing import Any, Callable, Optional

from sqlalchemy.orm import Session

from ..library_ignore import IGNORE_FILENAME, IgnoreMatcher
from . import settings as watch_settings
from .changes import CREATED, DELETED, MODIFIED, MOVED, Change, is_relevant, plan_scan

logger = logging.getLogger("grimoire.watch")

# Never wait longer than this after the first change, however busy the library.
MAX_WAIT_SECONDS = 300
# How often a waiting watcher checks whether a running scan has finished.
BUSY_RETRY_SECONDS = 5
# How often the supervisor re-reads the settings and checks on its watcher.
SUPERVISE_SECONDS = 30

# watchdog's event types, mapped onto what a scan cares about. A file closed
# after writing is the end of a modification; opens and read-only closes are not
# changes at all.
_KINDS = {
    "created": CREATED,
    "deleted": DELETED,
    "moved": MOVED,
    "modified": MODIFIED,
    "closed": MODIFIED,
}


class ChangeQueue:
    """Relevant changes waiting to be scanned, and when they will be ready."""

    def __init__(
        self,
        delay: float,
        max_wait: float = MAX_WAIT_SECONDS,
        clock: Callable[[], float] = time.monotonic,
    ) -> None:
        self.delay = delay
        self.max_wait = max_wait
        self._clock = clock
        self._lock = threading.Lock()
        self._changes: set[Change] = set()
        self._first: Optional[float] = None
        self._last: Optional[float] = None

    def add(self, change: Change) -> None:
        now = self._clock()
        with self._lock:
            self._changes.add(change)
            if self._first is None:
                self._first = now
            self._last = now

    def wait_seconds(self) -> Optional[float]:
        """Seconds until the changes are ready: None when there are none, 0 when ready."""
        with self._lock:
            if self._first is None or self._last is None:
                return None
            now = self._clock()
            quiet = self._last + self.delay - now
            capped = self._first + self.max_wait - now
            return max(0.0, min(quiet, capped))

    def take(self) -> list[Change]:
        with self._lock:
            changes = sorted(self._changes, key=lambda c: (c.path, c.kind))
            self._changes.clear()
            self._first = self._last = None
            return changes

    def __len__(self) -> int:
        with self._lock:
            return len(self._changes)


class LibraryWatcher:
    """Watch one library and scan what changes in it. See the module docstring."""

    def __init__(
        self,
        library_path: str,
        *,
        polling: bool,
        poll_interval: float,
        delay: float,
        scan: Callable[[Optional[str]], None],
        busy: Callable[[], bool],
        max_wait: float = MAX_WAIT_SECONDS,
        observer_factory: Optional[Callable[[bool, float], Any]] = None,
    ) -> None:
        self.library_path = os.path.abspath(library_path)
        # Some observers report resolved paths (macOS's FSEvents gives
        # /private/var/... for a library under /var/...), so events are matched
        # against both spellings of the root.
        self._real_root = os.path.realpath(self.library_path)
        self.polling = polling
        self.poll_interval = poll_interval
        self.queue = ChangeQueue(delay, max_wait)
        self._scan = scan
        self._busy = busy
        self._observer_factory = observer_factory or _make_observer
        self._observer: Any = None
        self._thread: Optional[threading.Thread] = None
        self._wake = threading.Event()
        self._stopping = False
        self._ignore = IgnoreMatcher(self.library_path)

    # --- lifecycle -------------------------------------------------------

    def start(self) -> None:
        """Start observing. Raises when the observer cannot start (see ``describe_error``)."""
        from watchdog.events import FileSystemEventHandler

        watcher = self

        class _Handler(FileSystemEventHandler):
            def on_any_event(self, event: Any) -> None:
                watcher.handle(event)

        observer = self._observer_factory(self.polling, self.poll_interval)
        observer.schedule(_Handler(), self.library_path, recursive=True)
        observer.start()
        self._observer = observer
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="grimoire-library-watch"
        )
        self._thread.start()

    def stop(self) -> None:
        self._stopping = True
        self._wake.set()
        if self._observer is not None:
            try:
                self._observer.stop()
                self._observer.join(timeout=5)
            except Exception as e:  # noqa: BLE001 - stopping must not raise
                logger.debug("Error stopping the library watcher: %s", e)
        if self._thread is not None and self._thread is not threading.current_thread():
            self._thread.join(timeout=5)

    def is_alive(self) -> bool:
        observer_ok = self._observer is not None and self._observer.is_alive()
        return observer_ok and self._thread is not None and self._thread.is_alive()

    # --- events ----------------------------------------------------------

    def handle(self, event: Any) -> None:
        """Turn one watchdog event into queued changes, dropping noise."""
        kind = _KINDS.get(getattr(event, "event_type", ""))
        if kind is None:
            return
        is_dir = bool(getattr(event, "is_directory", False))
        paths = [event.src_path]
        if kind == MOVED and getattr(event, "dest_path", None):
            paths.append(event.dest_path)
        for raw in paths:
            path = os.fsdecode(raw)
            rel = self._relative(path)
            if not is_relevant(rel, is_dir, kind):
                continue
            if os.path.basename(path) == IGNORE_FILENAME:
                # Rules changed: forget the cached ones before matching again.
                self._ignore = IgnoreMatcher(self.library_path)
            elif self._ignore.is_ignored(path, is_dir=is_dir):
                continue
            self.queue.add(Change(rel, is_dir, kind))
            self._wake.set()

    def _relative(self, path: str) -> str:
        rel = os.path.relpath(path, self.library_path)
        if rel.startswith("..") and self._real_root != self.library_path:
            real = os.path.relpath(path, self._real_root)
            if not real.startswith(".."):
                rel = real
        return rel.replace(os.sep, "/")

    def request_full_scan(self) -> None:
        """Queue a scan of the whole library, for changes nobody was watching for."""
        self.queue.add(Change(".", True, CREATED))
        self._wake.set()

    # --- scanning --------------------------------------------------------

    def _folder_exists(self, collection: str, folder: str) -> bool:
        return os.path.isdir(os.path.join(self.library_path, collection, folder))

    def _loop(self) -> None:
        while not self._stopping:
            wait = self.queue.wait_seconds()
            if wait is None:
                self._wake.wait()
                self._wake.clear()
                continue
            if wait > 0:
                self._wake.wait(wait)
                self._wake.clear()
                continue
            if self._busy():
                # Keep collecting; the changes are scanned once the running
                # scan is done, which may well have picked some of them up.
                self._wake.wait(BUSY_RETRY_SECONDS)
                self._wake.clear()
                continue
            self.run_pending()

    def run_pending(self) -> Optional[str]:
        """Scan whatever is queued now. Returns the scope used ("" for a full scan)."""
        changes = self.queue.take()
        if not changes:
            return None
        scope = plan_scan(changes, self._folder_exists)
        where = scope or "the whole library"
        logger.info(
            "Noticed %d change(s) in the library - rescanning %s.", len(changes), where
        )
        try:
            self._scan(scope)
        except Exception as e:  # noqa: BLE001 - a failed scan must not end the watch
            logger.error("Automatic rescan failed: %s", e)
        return scope or ""


def _make_observer(polling: bool, poll_interval: float) -> Any:
    if polling:
        from watchdog.observers.polling import PollingObserver

        return PollingObserver(timeout=poll_interval)
    from watchdog.observers import Observer

    return Observer()


def describe_error(e: BaseException) -> str:
    """What to tell an admin whose watcher would not start."""
    if isinstance(e, OSError) and e.errno in (errno.ENOSPC, errno.EMFILE):
        return (
            "The system's limit on watched folders was reached. Raise "
            "fs.inotify.max_user_watches on the host, or set the watch mode to poll."
        )
    return str(e) or e.__class__.__name__


class Supervisor:
    """Keep a :class:`LibraryWatcher` running to match the settings."""

    def __init__(
        self,
        library_path: str,
        session_factory: Callable[[], Session],
        *,
        scan: Callable[[Optional[str]], None],
        busy: Callable[[], bool],
        delay: float,
        poll_interval: float,
        interval: float = SUPERVISE_SECONDS,
        watcher_factory: Optional[Callable[..., LibraryWatcher]] = None,
        fs_type: Optional[Callable[[str], Optional[str]]] = None,
    ) -> None:
        self.library_path = library_path
        self._session_factory = session_factory
        self._scan = scan
        self._busy = busy
        self._delay = delay
        self._poll_interval = poll_interval
        self._interval = interval
        self._watcher_factory = watcher_factory or LibraryWatcher
        self._fs_type = fs_type or watch_settings.filesystem_type
        self._poke = threading.Event()
        self._stopping = False
        self._thread: Optional[threading.Thread] = None
        self.watcher: Optional[LibraryWatcher] = None
        # (enabled, polling) the running watcher was started for.
        self._running_for: Optional[tuple[bool, bool]] = None
        # Whether sync() has run before. A watcher started on the first one
        # starts with the process, alongside the startup scan (or after
        # STARTUP_SCAN=false chose to skip it). One started later follows a
        # stretch nobody was watching - turned off, or an observer that died -
        # so it begins by catching up on whatever changed meanwhile.
        self._synced_before = False
        # None until the first sync, so that sync always records - a state
        # left in the database by the previous run must not stand.
        self.state: Optional[dict] = None

    def start(self) -> None:
        self._thread = threading.Thread(
            target=self._loop, daemon=True, name="grimoire-library-watch-supervisor"
        )
        self._thread.start()

    def poke(self) -> None:
        self._poke.set()

    def stop(self) -> None:
        self._stopping = True
        self._poke.set()
        if self._thread is not None:
            self._thread.join(timeout=10)
        self._stop_watcher()

    def _loop(self) -> None:
        while not self._stopping:
            try:
                self.sync()
            except Exception as e:  # noqa: BLE001 - keep supervising
                logger.error("Library watcher supervisor error: %s", e)
            self._poke.wait(self._interval)
            self._poke.clear()

    def _stop_watcher(self) -> None:
        if self.watcher is not None:
            self.watcher.stop()
        self.watcher = None
        self._running_for = None

    def sync(self) -> None:
        """Start, stop, or restart the watcher so it matches the settings."""
        catch_up, self._synced_before = self._synced_before, True
        db = self._session_factory()
        try:
            raw = watch_settings.read(db)
            want = watch_settings.enabled(raw)
            polling = watch_settings.resolve_polling(
                watch_settings.mode(raw), self._fs_type(self.library_path)
            )
            healthy = self.watcher is not None and self.watcher.is_alive()
            if want and healthy and self._running_for == (True, polling):
                return
            if not want and self.watcher is None:
                self._record(db, {"state": "off", "detail": ""})
                return

            self._stop_watcher()
            if not want:
                logger.info("Stopped watching the library for changes.")
                self._record(db, {"state": "off", "detail": ""})
                return
            if not os.path.isdir(self.library_path):
                self._record(
                    db, {"state": "unavailable", "detail": "The library folder does not exist."}
                )
                return
            watcher = self._watcher_factory(
                self.library_path,
                polling=polling,
                poll_interval=self._poll_interval,
                delay=self._delay,
                scan=self._scan,
                busy=self._busy,
            )
            try:
                watcher.start()
            except Exception as e:  # noqa: BLE001 - reported, then retried next round
                detail = describe_error(e)
                logger.warning("Could not watch the library for changes: %s", detail)
                watcher.stop()
                self._record(db, {"state": "unavailable", "detail": detail})
                return
            self.watcher = watcher
            self._running_for = (True, polling)
            if catch_up:
                watcher.request_full_scan()
            if polling:
                logger.info(
                    "Watching the library for changes, checking every %ds.",
                    int(self._poll_interval),
                )
                self._record(db, {"state": "polling", "detail": ""})
            else:
                logger.info("Watching the library for changes.")
                self._record(db, {"state": "watching", "detail": ""})
        finally:
            db.close()

    def _record(self, db: Session, state: dict) -> None:
        if state == self.state:
            return
        self.state = state
        try:
            watch_settings.save_state(db, state)
        except Exception as e:  # noqa: BLE001 - status is informational
            logger.debug("Could not record the library watcher state: %s", e)
            db.rollback()
