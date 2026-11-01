"""Not starting the library scan again and again on a server that keeps dying in it.

The worker holding the scan lock scans the library as it starts. If something in
that scan kills the process - an out-of-memory kill, a native crash, uvicorn's
supervisor stopping a worker that stops answering - the replacement worker takes
the lock and starts the same scan over, and dies the same way: a loop that pins a
core and never finishes (issue #762). ``quarantine`` breaks the loop when the
culprit is a thumbnail; this breaks it whatever the culprit is.

``.startup-scan.json`` under DATA_PATH records that a startup scan is running.
Finishing it, or the server stopping normally, records that it is not. Finding
it still marked running at the next start means the last one died. After
``MAX_DEATHS`` of those in a row, startup skips the scan and says so, and tries
again only once ``RETRY_AFTER`` has passed since the last attempt. A scan
started from the admin page or by the schedule is never held back.
"""
import json
import os
import time
from typing import Any

from ... import config
from ...config import logger

STATE_FILE = ".startup-scan.json"
# Startup scans in a row that may die before startup stops starting one.
MAX_DEATHS = 3
# Seconds after the last attempt before a startup scan is tried again anyway.
RETRY_AFTER = 30 * 60

# Whether this process started the scan the state file says is running. A
# process that skipped it must not clear the record of the deaths on stopping.
_started_here = False


def _path() -> str:
    return os.path.join(config.DATA_PATH, STATE_FILE)


def _read() -> dict[str, Any]:
    try:
        with open(_path(), encoding="utf-8") as fh:
            data = json.load(fh)
    except FileNotFoundError:
        return {}
    except (OSError, ValueError) as e:
        logger.warning(f"Couldn't read {_path()}: {e}")
        return {}
    return data if isinstance(data, dict) else {}


def _write(state: dict[str, Any]) -> None:
    tmp = f"{_path()}.tmp"
    try:
        with open(tmp, "w", encoding="utf-8") as fh:
            json.dump(state, fh)
        os.replace(tmp, _path())
    except OSError as e:
        logger.warning(f"Couldn't save the startup scan state: {e}")


def begin() -> bool:
    """Whether to run the startup scan now. Records it as running when it is."""
    global _started_here
    state = _read()
    deaths = int(state.get("deaths", 0)) + 1 if state.get("running") else 0
    started = float(state.get("started", 0))
    if deaths >= MAX_DEATHS and time.time() - started < RETRY_AFTER:
        logger.error(
            f"The library scan stopped unexpectedly the last {deaths} times Grimoire "
            f"started, so it will not start on its own now. Start one with Rescan on "
            f"the admin page when ready; it will also try again at startup after "
            f"{RETRY_AFTER // 60} minutes. To find the file it stops on, set "
            f"LOG_LEVEL=debug: the last 'Scanning ...' line before it stops names it."
        )
        # Still marked running, and with the same start time, so the wait is
        # counted from the last real attempt.
        _write({"running": True, "started": started, "deaths": deaths - 1})
        return False
    if deaths:
        logger.warning(
            "The last library scan stopped unexpectedly as Grimoire started; "
            "starting it again."
        )
    _write({"running": True, "started": time.time(), "deaths": deaths})
    _started_here = True
    return True


def finish() -> None:
    """The startup scan ended, or the server is stopping on purpose: neither is a death."""
    global _started_here
    if not _started_here:
        return
    _started_here = False
    _write({"running": False})
