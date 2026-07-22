"""Unit tests for the background rescan scheduler.

These exercise the pure scheduling math and the thread lifecycle directly,
without going through the settings API (which is covered separately in
``test_settings_maintenance.py``).
"""
import threading
from datetime import datetime, timedelta
from unittest.mock import MagicMock, patch

from backend import scheduler


# ---------------------------------------------------------------------------
# _seconds_until_next
# ---------------------------------------------------------------------------


class TestSecondsUntilNext:
    def test_daily_rolls_to_tomorrow_when_time_passed(self):
        # Freeze "now" to 10:00 and ask for a 09:00 daily slot → next is
        # tomorrow 09:00, i.e. ~23h away.
        now = datetime(2026, 7, 22, 10, 0, 0)
        with patch("backend.scheduler.datetime") as mock_dt:
            mock_dt.utcnow.return_value = now
            secs = scheduler._seconds_until_next(9, 0, None)
        assert secs == (timedelta(days=1) - timedelta(hours=1)).total_seconds()

    def test_daily_later_today(self):
        now = datetime(2026, 7, 22, 8, 0, 0)
        with patch("backend.scheduler.datetime") as mock_dt:
            mock_dt.utcnow.return_value = now
            secs = scheduler._seconds_until_next(9, 30, None)
        assert secs == timedelta(hours=1, minutes=30).total_seconds()

    def test_weekly_advances_to_target_weekday(self):
        # 2026-07-22 is a Wednesday (weekday 2). Target Friday (4) → 2 days.
        now = datetime(2026, 7, 22, 8, 0, 0)
        with patch("backend.scheduler.datetime") as mock_dt:
            mock_dt.utcnow.return_value = now
            secs = scheduler._seconds_until_next(8, 0, 4)
        assert secs == timedelta(days=2).total_seconds()

    def test_weekly_same_day_but_time_passed_rolls_a_week(self):
        # Wednesday 10:00, target Wednesday (2) 09:00 → next week, ~7d minus 1h.
        now = datetime(2026, 7, 22, 10, 0, 0)
        with patch("backend.scheduler.datetime") as mock_dt:
            mock_dt.utcnow.return_value = now
            secs = scheduler._seconds_until_next(9, 0, 2)
        assert secs == (timedelta(days=7) - timedelta(hours=1)).total_seconds()

    def test_floor_of_one_second(self):
        # Target is exactly now → clamped to a minimum of 1 second.
        now = datetime(2026, 7, 22, 9, 0, 0)
        with patch("backend.scheduler.datetime") as mock_dt:
            mock_dt.utcnow.return_value = now
            secs = scheduler._seconds_until_next(9, 0, None)
        assert secs == timedelta(days=1).total_seconds()


# ---------------------------------------------------------------------------
# _run — one loop iteration
# ---------------------------------------------------------------------------


class TestRun:
    def test_runs_rescan_then_cleanup_then_stops(self):
        rescan = MagicMock()
        cleanup = MagicMock()
        # wait() returns False the first time (fire the rescan) then True
        # (stop() was signalled) so the loop exits after one iteration.
        with patch.object(scheduler, "_stop_event") as ev:
            ev.wait.side_effect = [False, True]
            scheduler._run("hourly", 2, 0, None, rescan, cleanup)
        rescan.assert_called_once_with()
        cleanup.assert_called_once_with()

    def test_skips_cleanup_when_none(self):
        rescan = MagicMock()
        with patch.object(scheduler, "_stop_event") as ev:
            ev.wait.side_effect = [False, True]
            scheduler._run("daily", 2, 0, None, rescan, None)
        rescan.assert_called_once_with()

    def test_stops_immediately_when_signalled(self):
        rescan = MagicMock()
        with patch.object(scheduler, "_stop_event") as ev:
            ev.wait.return_value = True  # stop() already set
            scheduler._run("hourly", 2, 0, None, rescan, None)
        rescan.assert_not_called()

    def test_rescan_exception_is_swallowed_and_cleanup_still_runs(self):
        rescan = MagicMock(side_effect=RuntimeError("boom"))
        cleanup = MagicMock()
        with patch.object(scheduler, "_stop_event") as ev:
            ev.wait.side_effect = [False, True]
            scheduler._run("daily", 2, 0, None, rescan, cleanup)
        rescan.assert_called_once_with()
        cleanup.assert_called_once_with()

    def test_cleanup_exception_is_swallowed(self):
        rescan = MagicMock()
        cleanup = MagicMock(side_effect=RuntimeError("boom"))
        with patch.object(scheduler, "_stop_event") as ev:
            ev.wait.side_effect = [False, True]
            # Should not raise.
            scheduler._run("daily", 2, 0, None, rescan, cleanup)
        cleanup.assert_called_once_with()

    def test_non_hourly_uses_seconds_until_next(self):
        rescan = MagicMock()
        with patch.object(scheduler, "_stop_event") as ev, patch.object(
            scheduler, "_seconds_until_next", return_value=42.0
        ) as sun:
            ev.wait.side_effect = [False, True]
            scheduler._run("daily", 3, 30, None, rescan, None)
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
