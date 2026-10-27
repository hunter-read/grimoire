"""Shared status, stop flag and heartbeat for a named background job.

The library scan and the duplicate scan each run as one job at a time, which a
Stop button can cancel and which may have been started by another worker. Both
need the same machinery, and the two copies they used to carry had drifted
(issue #711): only the library scan had the stop file and the heartbeat thread,
so with several workers and no Valkey a duplicate scan could not be stopped.

Each job keeps its **own** keys. Sharing them would be a bug in both directions:
a job that starts replaces its whole status, which would erase the other mid-run,
and a Stop would cancel whichever job happened to be listening.

Every piece of state lives in Valkey when it is available and falls back to
something this process can hold when it is not:

    status     ``grimoire:<name>_status``, else an in-process dict
    stop flag  ``grimoire:<name>_stop``, else ``DATA_PATH/.<name>.stop``, which every
               worker can see (issue #651); an in-process flag only as a last resort
    heartbeat  ``grimoire:<name>_heartbeat``, else an in-process timestamp

and a run holds ``DATA_PATH/.<name>.lock``, which tells every worker that one is
running even when the status they can see is only their own.
"""
import fcntl
import json
import logging
import os
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from typing import Any, Iterator, Optional

from .. import config
from ..config import valkey_client, valkey_errors

logger = logging.getLogger("grimoire.jobs")

# How long a running job's heartbeat may go unrefreshed before it is treated as
# abandoned (issue #524). Comfortably longer than HEARTBEAT_INTERVAL_SECONDS, so
# a slow step is never mistaken for a dead process.
STALE_AFTER_SECONDS = 300
# How often a running job refreshes its heartbeat, independent of progress.
# Progress alone is too coarse: OCR of one long scanned book can go far longer
# than STALE_AFTER_SECONDS between status writes.
HEARTBEAT_INTERVAL_SECONDS = 30
# A stop flag older than this is ignored, so one a crash left behind cannot stop
# a later run that never clears it. Also the Valkey key's expiry.
STOP_TTL_SECONDS = 3600
# Valkey expiry for the status and heartbeat, so an abandoned job's keys do not
# live forever.
_STATE_TTL_SECONDS = 86400


def now() -> str:
    return datetime.now(timezone.utc).isoformat()


class Job:
    """One named job's shared state, safe to use from any worker.

    The status is a dict the job's own code fills in; ``default_status`` is its
    shape when nothing is running. ``status()`` always adds the ``heartbeat``.
    """

    def __init__(self, name: str, default_status: dict[str, Any]) -> None:
        self.name = name
        self.default_status = dict(default_status)
        self.status_key = f"grimoire:{name}_status"
        self.stop_key = f"grimoire:{name}_stop"
        # The heartbeat has its own key rather than living in the status blob.
        # The blob is written read-modify-write, so a second writer (the
        # heartbeat thread) racing the job's own updates could put back a stale
        # copy - including `running: true` over the job's final `running: false`.
        self.heartbeat_key = f"grimoire:{name}_heartbeat"
        self.stale_after_seconds = STALE_AFTER_SECONDS
        self.heartbeat_interval_seconds = HEARTBEAT_INTERVAL_SECONDS
        # In-process fallbacks when Valkey is unavailable.
        self._status: dict[str, Any] = dict(default_status)
        self._stop_requested = False
        self._heartbeat: Optional[str] = None

    # --- Run lock -------------------------------------------------------------

    def lock_path(self) -> str:
        return os.path.join(config.DATA_PATH, f".{self.name}.lock")

    @contextmanager
    def run_lock(self) -> Iterator[bool]:
        """Hold this job's lock while the block runs; False if another run holds it.

        A lock file that can't be opened at all yields True: the lock only makes
        a run visible to other workers, which is not worth refusing to run over.
        """
        try:
            lock = open(self.lock_path(), "a")
        except OSError as e:
            logger.warning("Couldn't open the %s lock file: %s", self.name, e)
            yield True
            return
        # Closing the file releases the lock, so a run that dies releases it too.
        with lock:
            try:
                fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError:
                yield False
                return
            yield True

    def lock_held(self) -> bool:
        """Whether some worker holds this job's lock, i.e. is running it (issue #651).

        Without Valkey the status is per-process, so a worker that is not running
        the job reports nothing running and would turn a Stop away. The lock is
        shared across processes, so it can tell.
        """
        try:
            with open(self.lock_path(), "a") as lock:
                try:
                    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except OSError:
                    return True
                fcntl.flock(lock, fcntl.LOCK_UN)
                return False
        except OSError:
            return False

    # --- Stop flag ------------------------------------------------------------

    def stop_file(self) -> str:
        return os.path.join(config.DATA_PATH, f".{self.name}.stop")

    def request_stop(self) -> None:
        if (client := valkey_client()) is not None:
            try:
                client.set(self.stop_key, "1", ex=STOP_TTL_SECONDS)
            except valkey_errors() as e:
                logger.warning("Valkey set(%s stop) failed, using the stop file: %s", self.name, e)
        try:
            with open(self.stop_file(), "w"):
                pass
        except OSError as e:
            # Last resort, and only then: a flag in this process would outlive
            # another worker's clear_stop() and stop that worker's next run early.
            logger.warning(
                "Couldn't write the %s stop file, using in-process flag: %s", self.name, e
            )
            self._stop_requested = True

    def clear_stop(self) -> None:
        self._stop_requested = False
        if (client := valkey_client()) is not None:
            try:
                client.delete(self.stop_key)
            except valkey_errors() as e:
                logger.warning(
                    "Valkey delete(%s stop) failed, using the stop file: %s", self.name, e
                )
        try:
            os.remove(self.stop_file())
        except FileNotFoundError:
            pass
        except OSError as e:
            logger.warning("Couldn't remove the %s stop file: %s", self.name, e)

    def _stop_file_set(self) -> bool:
        try:
            age = time.time() - os.stat(self.stop_file()).st_mtime
        except OSError:
            return False
        return age < STOP_TTL_SECONDS

    def is_stop_requested(self) -> bool:
        if (client := valkey_client()) is not None:
            try:
                return bool(client.exists(self.stop_key))
            except valkey_errors() as e:
                logger.warning(
                    "Valkey exists(%s stop) failed, using the stop file: %s", self.name, e
                )
        return self._stop_requested or self._stop_file_set()

    # --- Heartbeat ------------------------------------------------------------

    def beat(self) -> None:
        """Record that the run owning the status is still alive."""
        stamp = now()
        if (client := valkey_client()) is not None:
            try:
                client.set(self.heartbeat_key, stamp, ex=_STATE_TTL_SECONDS)
                return
            except valkey_errors() as e:
                logger.warning(
                    "Valkey set(%s heartbeat) failed, using in-process heartbeat: %s", self.name, e
                )
        self._heartbeat = stamp

    def heartbeat(self) -> Optional[str]:
        if (client := valkey_client()) is not None:
            try:
                raw = client.get(self.heartbeat_key)
                if raw:
                    return raw.decode() if isinstance(raw, bytes) else str(raw)
            except valkey_errors() as e:
                logger.warning(
                    "Valkey get(%s heartbeat) failed, using in-process heartbeat: %s", self.name, e
                )
        return self._heartbeat

    def start_heartbeat(self) -> threading.Event:
        """Keep the heartbeat fresh while a run lasts; set the returned event to stop.

        A daemon thread, so it dies with the process - which is exactly the case
        the heartbeat exists to detect. A run that ends normally stops it from
        its ``finally``.
        """
        done = threading.Event()

        def tick() -> None:
            while not done.wait(self.heartbeat_interval_seconds):
                try:
                    self.beat()
                except Exception:  # noqa: BLE001 - a dead ticker would fake a dead job
                    logger.exception("%s heartbeat failed", self.name)

        threading.Thread(target=tick, name=f"{self.name}-heartbeat", daemon=True).start()
        return done

    # --- Status ---------------------------------------------------------------

    def _read(self) -> dict[str, Any]:
        if (client := valkey_client()) is not None:
            try:
                raw = client.get(self.status_key)
                if raw:
                    loaded: dict[str, Any] = json.loads(raw)
                    return loaded
            except (*valkey_errors(), ValueError) as e:
                # ValueError covers a corrupt/non-JSON cached status blob.
                logger.warning(
                    "Valkey get(%s status) failed, using in-process status: %s", self.name, e
                )
        return dict(self._status)

    def status(self) -> dict[str, Any]:
        return {**self._read(), "heartbeat": self.heartbeat()}

    def update(self, updates: dict[str, Any]) -> None:
        # Every write is a sign of life, so the heartbeat starts with the run
        # rather than one heartbeat interval later.
        self.beat()
        if (client := valkey_client()) is not None:
            try:
                current = self._read()
                current.update(updates)
                client.set(self.status_key, json.dumps(current), ex=_STATE_TTL_SECONDS)
                return
            except valkey_errors() as e:
                logger.warning(
                    "Valkey set(%s status) failed, using in-process status: %s", self.name, e
                )
        self._status.update(updates)

    def is_stale(self, status: Optional[dict[str, Any]] = None) -> bool:
        """Whether a status claiming to run has actually been abandoned (issue #524).

        A run whose process died never reaches the ``finally`` that clears
        ``running``, and Valkey keeps that status for a day, refusing every later
        run. True when the heartbeat stopped advancing. A running status with no
        heartbeat at all is stale too: it was written by a build that predates
        the field, so it survived a restart and cannot be live.
        """
        current = self.status() if status is None else status
        if not current.get("running"):
            return False
        beat = current.get("heartbeat")
        if not beat:
            return True
        try:
            last = datetime.fromisoformat(beat)
        except (TypeError, ValueError):
            return True
        if last.tzinfo is None:
            last = last.replace(tzinfo=timezone.utc)
        return (datetime.now(timezone.utc) - last).total_seconds() > self.stale_after_seconds

    def force_clear(self, **fields: Any) -> dict[str, Any]:
        """Drop an abandoned run's status so the UI unblocks and a new run can start.

        Only for a run nothing is executing any more: a live one must be asked to
        stop via ``request_stop``, so it winds down at a safe checkpoint.
        ``fields`` are set over the defaults.
        """
        self.clear_stop()
        self.update({**self.default_status, **fields})
        return self.status()
