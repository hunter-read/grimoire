"""Unit tests for the background rescan scheduler.

These exercise the pure scheduling math and the thread lifecycle directly,
without going through the settings API (which is covered separately in
``test_settings_maintenance.py``).
"""
import threading
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

import pytest

from backend import scheduler


# ---------------------------------------------------------------------------
# _seconds_until_next
# ---------------------------------------------------------------------------


class TestSecondsUntilNext:
    def test_daily_rolls_to_tomorrow_when_time_passed(self):
        # Freeze "now" to 10:00 and ask for a 09:00 daily slot → next is
        # tomorrow 09:00, i.e. ~23h away.
        now = datetime(2026, 7, 22, 10, 0, 0)
        with patch("backend.scheduler.utcnow_naive", return_value=now):
            secs = scheduler._seconds_until_next(9, 0, None)
        assert secs == (timedelta(days=1) - timedelta(hours=1)).total_seconds()

    def test_daily_later_today(self):
        now = datetime(2026, 7, 22, 8, 0, 0)
        with patch("backend.scheduler.utcnow_naive", return_value=now):
            secs = scheduler._seconds_until_next(9, 30, None)
        assert secs == timedelta(hours=1, minutes=30).total_seconds()

    def test_weekly_advances_to_target_weekday(self):
        # 2026-07-22 is a Wednesday (weekday 2). Target Friday (4) → 2 days.
        now = datetime(2026, 7, 22, 8, 0, 0)
        with patch("backend.scheduler.utcnow_naive", return_value=now):
            secs = scheduler._seconds_until_next(8, 0, 4)
        assert secs == timedelta(days=2).total_seconds()

    def test_weekly_same_day_but_time_passed_rolls_a_week(self):
        # Wednesday 10:00, target Wednesday (2) 09:00 → next week, ~7d minus 1h.
        now = datetime(2026, 7, 22, 10, 0, 0)
        with patch("backend.scheduler.utcnow_naive", return_value=now):
            secs = scheduler._seconds_until_next(9, 0, 2)
        assert secs == (timedelta(days=7) - timedelta(hours=1)).total_seconds()

    def test_floor_of_one_second(self):
        # Target is exactly now → clamped to a minimum of 1 second.
        now = datetime(2026, 7, 22, 9, 0, 0)
        with patch("backend.scheduler.utcnow_naive", return_value=now):
            secs = scheduler._seconds_until_next(9, 0, None)
        assert secs == timedelta(days=1).total_seconds()


# ---------------------------------------------------------------------------
# _run — one loop iteration
# ---------------------------------------------------------------------------


def _event(waits=None, stopped=False):
    """A stand-in stop event: ``wait()`` answers from ``waits`` in turn."""
    ev = MagicMock()
    ev.is_set.return_value = stopped
    if waits is not None:
        ev.wait.side_effect = waits
    return ev


class TestRun:
    def test_runs_rescan_then_cleanup_then_stops(self):
        rescan = MagicMock()
        cleanup = MagicMock()
        # wait() returns False the first time (fire the rescan) then True
        # (stop() was signalled) so the loop exits after one iteration.
        scheduler._run("hourly", 2, 0, None, rescan, cleanup, _event([False, True]))
        rescan.assert_called_once_with()
        cleanup.assert_called_once_with()

    def test_skips_cleanup_when_none(self):
        rescan = MagicMock()
        scheduler._run("daily", 2, 0, None, rescan, None, _event([False, True]))
        rescan.assert_called_once_with()

    def test_stops_immediately_when_signalled(self):
        rescan = MagicMock()
        scheduler._run("hourly", 2, 0, None, rescan, None, _event([True]))
        rescan.assert_not_called()

    def test_does_not_start_when_already_stopped(self):
        ev = _event(stopped=True)
        rescan = MagicMock()
        scheduler._run("hourly", 2, 0, None, rescan, None, ev)
        ev.wait.assert_not_called()
        rescan.assert_not_called()

    def test_a_stop_during_the_scan_skips_the_cleanup(self):
        ev = _event([False])
        cleanup = MagicMock()

        def rescan():
            ev.is_set.return_value = True  # stop() arrives mid-scan

        scheduler._run("hourly", 2, 0, None, rescan, cleanup, ev)
        cleanup.assert_not_called()
        assert ev.wait.call_count == 1

    def test_rescan_exception_is_swallowed_and_cleanup_still_runs(self):
        rescan = MagicMock(side_effect=RuntimeError("boom"))
        cleanup = MagicMock()
        scheduler._run("daily", 2, 0, None, rescan, cleanup, _event([False, True]))
        rescan.assert_called_once_with()
        cleanup.assert_called_once_with()

    def test_cleanup_exception_is_swallowed(self):
        rescan = MagicMock()
        cleanup = MagicMock(side_effect=RuntimeError("boom"))
        # Should not raise.
        scheduler._run("daily", 2, 0, None, rescan, cleanup, _event([False, True]))
        cleanup.assert_called_once_with()

    def test_non_hourly_uses_seconds_until_next(self):
        rescan = MagicMock()
        ev = _event([False, True])
        with patch.object(scheduler, "_seconds_until_next", return_value=42.0) as sun:
            scheduler._run("daily", 3, 30, None, rescan, None, ev)
        # Interval is recomputed at the top of each loop iteration.
        sun.assert_called_with(3, 30, None)
        # First wait() call uses the computed interval.
        assert ev.wait.call_args_list[0].args[0] == 42.0


# ---------------------------------------------------------------------------
# start / stop lifecycle
# ---------------------------------------------------------------------------


class TestStartStop:
    def teardown_method(self):
        scheduler.stop()

    def _start_without_running(self, *args, **kwargs):
        # Patch Thread so start() doesn't spin a real background thread; we only
        # want to verify wiring and the logging branches.
        with patch("backend.scheduler.threading.Thread") as MockThread:
            scheduler.start(*args, **kwargs)
        return MockThread

    def test_start_hourly(self):
        rescan = MagicMock()
        MockThread = self._start_without_running("hourly", 0, 0, 0, rescan)
        MockThread.assert_called_once()
        # weekday coerced to None for non-weekly.
        assert MockThread.call_args.kwargs["args"][3] is None

    def test_start_weekly_passes_weekday(self):
        rescan = MagicMock()
        MockThread = self._start_without_running("weekly", 5, 15, 3, rescan)
        assert MockThread.call_args.kwargs["args"][3] == 3

    def test_start_daily(self):
        rescan = MagicMock()
        MockThread = self._start_without_running("daily", 2, 0, 0, rescan)
        assert MockThread.call_args.kwargs["args"][3] is None

    def test_start_replaces_existing_thread(self):
        rescan = MagicMock()
        with patch("backend.scheduler.threading.Thread") as MockThread, patch.object(
            scheduler, "stop", wraps=scheduler.stop
        ) as spy_stop:
            scheduler.start("hourly", 0, 0, 0, rescan)
            scheduler.start("hourly", 0, 0, 0, rescan)
        # Each start() spins up a new thread and stops any prior one first.
        assert MockThread.call_count == 2
        assert MockThread.return_value.start.call_count == 2
        assert spy_stop.call_count == 2

    def test_stop_joins_running_thread(self):
        started = threading.Event()
        release = threading.Event()

        def _rescan():
            started.set()
            release.wait(timeout=5)

        # Real thread that blocks until we let stop() interrupt via the event.
        scheduler.start("hourly", 0, 0, 0, _rescan)
        with patch.object(scheduler._thread, "join") as mock_join:
            scheduler.stop()
        mock_join.assert_called_once()
        assert scheduler._thread is None

    def test_stop_is_noop_when_not_running(self):
        scheduler._thread = None
        scheduler.stop()  # must not raise
        assert scheduler._thread is None


# ---------------------------------------------------------------------------
# stop() while a scan outlasts the join (issue #786)
# ---------------------------------------------------------------------------


def _scheduler_threads():
    return [t for t in threading.enumerate() if t.name == "grimoire-scheduler" and t.is_alive()]


class TestStopDuringALongScan:
    """A scan longer than stop()'s wait used to outlive the stop request.

    stop() cleared the shared event once its join timed out, so the thread came
    out of the scan seeing no stop, looped on, and ran beside the next start()'s.
    """

    @pytest.fixture(autouse=True)
    def quick(self, monkeypatch):
        # Fire almost at once, and give up on the join long before the scan ends.
        monkeypatch.setattr(scheduler, "_seconds_until_next", lambda *_a: 0.01)
        monkeypatch.setattr(scheduler, "JOIN_TIMEOUT", 0.1)
        yield
        scheduler.stop()

    def _start_a_long_scan(self, cleanup=None):
        started = threading.Event()
        release = threading.Event()
        rescan = MagicMock(side_effect=lambda: (started.set(), release.wait(10)))
        scheduler.start("daily", 2, 0, 0, rescan, cleanup)
        assert started.wait(5)
        return scheduler._thread, rescan, release

    def test_a_restart_leaves_exactly_one_thread(self):
        old, old_rescan, release = self._start_a_long_scan()
        scheduler.stop()
        assert old.is_alive(), "the scan should still be running past the join"

        # The new schedule waits an hour, so it stays quiet for the test.
        scheduler.start("hourly", 0, 0, 0, MagicMock())
        release.set()
        old.join(5)

        assert not old.is_alive()
        assert _scheduler_threads() == [scheduler._thread]
        old_rescan.assert_called_once_with()

    def test_turning_the_schedule_off_mid_scan_ends_the_thread(self):
        cleanup = MagicMock()
        old, rescan, release = self._start_a_long_scan(cleanup)
        scheduler.stop()
        release.set()
        old.join(5)

        assert not old.is_alive()
        assert _scheduler_threads() == []
        rescan.assert_called_once_with()
        cleanup.assert_not_called()
