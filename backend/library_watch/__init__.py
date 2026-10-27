"""Watching the library for changes and rescanning by itself (issue #670).

With this on, a file added, renamed, moved, or deleted on disk shows up in the
library a few seconds later without anyone pressing Rescan, and a change inside
one shelf only rescans that shelf. It replaces the scheduled rescan as the
default way the library stays current; the schedule remains for servers that
would rather scan at a quiet hour (a slow NAS, or a table that plays at night).

* ``changes``  - which changes matter, and how much of the library they need
  rescanned (pure, no threads).
* ``settings`` - env pins over the admin's settings, and network-share detection.
* ``watcher``  - the observer, the quiet-period queue, and the supervisor.

Only the worker that runs the startup scan supervises a watcher (see
``main.lifespan``), so a multi-worker server watches once.
"""
from typing import Optional

from .watcher import ChangeQueue, LibraryWatcher, Supervisor  # noqa: F401

_supervisor: Optional[Supervisor] = None


def start(library_path: str) -> None:
    """Start supervising a watcher for ``library_path`` in this process."""
    global _supervisor
    from .. import config
    from ..config import SessionLocal
    from ..services.library_scan.runner import run_rescan_sync, scan_in_progress

    stop()
    _supervisor = Supervisor(
        library_path,
        SessionLocal,
        scan=lambda scope: run_rescan_sync(scope_path=scope),
        busy=scan_in_progress,
        delay=config.LIBRARY_WATCH_DELAY,
        poll_interval=config.LIBRARY_WATCH_POLL_INTERVAL,
    )
    _supervisor.start()


def poke() -> None:
    """Re-read the settings now, after an admin changed them in this process."""
    if _supervisor is not None:
        _supervisor.poke()


def stop() -> None:
    global _supervisor
    if _supervisor is not None:
        _supervisor.stop()
    _supervisor = None
