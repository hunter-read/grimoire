"""Unit tests for the pure schedule/snippet helpers in the campaigns package.

These functions are otherwise only exercised indirectly through the schedule
endpoints; testing them directly covers the monthly/biweekly/custom branches
and the date arithmetic in nth_weekday_of_month.
"""
import datetime

from backend.routers.campaigns._helpers import (
    compute_next_sessions,
    nth_weekday_of_month,
    extract_snippet,
    strip_gm_secrets,
)


class TestComputeNextSessions:
    def test_weekly_returns_requested_count_on_given_weekdays(self):
        # Mondays (0) and Thursdays (3).
        result = compute_next_sessions({"frequency": "weekly", "days": [0, 3]}, n=4)
        assert len(result) == 4
        for iso in result:
            wd = datetime.date.fromisoformat(iso).weekday()
            assert wd in (0, 3)
        # Strictly increasing.
        assert result == sorted(result)

    def test_no_days_returns_empty(self):
        assert compute_next_sessions({"frequency": "weekly", "days": []}) == []

    def test_custom_dates_only_future_and_sorted(self):
        yesterday = (datetime.date.today() - datetime.timedelta(days=5)).isoformat()
        soon = (datetime.date.today() + datetime.timedelta(days=3)).isoformat()
        later = (datetime.date.today() + datetime.timedelta(days=30)).isoformat()
        result = compute_next_sessions(
            {"frequency": "custom", "custom_dates": [later, yesterday, soon]}, n=10
        )
        assert result == [soon, later]

    def test_custom_with_no_dates(self):
        assert compute_next_sessions({"frequency": "custom", "custom_dates": []}) == []

    def test_biweekly_with_reference_keeps_alternating_weeks(self):
        # Reference anchored well in the past so alternation is deterministic.
        ref = (datetime.date.today() - datetime.timedelta(weeks=6)).isoformat()
        result = compute_next_sessions(
            {"frequency": "biweekly", "days": [2], "biweekly_reference": ref}, n=3
        )
        assert len(result) == 3
        dates = [datetime.date.fromisoformat(d) for d in result]
        # Each successive session is two weeks apart (same weekday, biweekly).
        for a, b in zip(dates, dates[1:]):
            assert (b - a).days == 14

    def test_biweekly_with_bad_reference_falls_back(self):
        # An unparseable reference must not raise; it falls back to this week.
        result = compute_next_sessions(
            {"frequency": "biweekly", "days": [4], "biweekly_reference": "not-a-date"},
            n=2,
        )
        assert len(result) == 2

    def test_monthly_nth_weekday(self):
        # 2nd Tuesday (weekday 1, week 2) of each month.
        result = compute_next_sessions(
            {"frequency": "monthly", "days": [1], "monthly_week": 2}, n=3
        )
        assert len(result) == 3
        for iso in result:
            d = datetime.date.fromisoformat(iso)
            assert d.weekday() == 1
            # A 2nd occurrence always lands on day 8-14.
            assert 8 <= d.day <= 14

    def test_monthly_last_weekday(self):
        result = compute_next_sessions(
            {"frequency": "monthly", "days": [4], "monthly_week": -1}, n=2
        )
        assert len(result) == 2
        for iso in result:
            d = datetime.date.fromisoformat(iso)
            assert d.weekday() == 4
            # The last occurrence has no same weekday 7 days later in the month.
            assert (d + datetime.timedelta(days=7)).month != d.month


class TestNthWeekdayOfMonth:
    def test_first_monday_of_january_2026(self):
        # 2026-01-01 is a Thursday; the first Monday is the 5th.
        d = nth_weekday_of_month(2026, 1, 0, 1)
        assert d == datetime.date(2026, 1, 5)

    def test_last_friday_of_february_2026(self):
        d = nth_weekday_of_month(2026, 2, 4, -1)
        assert d == datetime.date(2026, 2, 27)

    def test_fifth_occurrence_overflows_to_none(self):
        # There is no 5th Monday in Feb 2026.
        assert nth_weekday_of_month(2026, 2, 0, 5) is None


class TestExtractSnippet:
    def test_centres_on_first_match(self):
        content = "alpha beta gamma delta epsilon zeta"
        snippet = extract_snippet(content, "gamma", window=10)
        assert "gamma" in snippet
        assert snippet.startswith("…")
        assert snippet.endswith("…")

    def test_no_match_returns_head_with_ellipsis(self):
        content = "x" * 200
        snippet = extract_snippet(content, "missing", window=50)
        assert snippet == "x" * 50 + "…"

    def test_no_match_short_content_no_ellipsis(self):
        snippet = extract_snippet("short", "missing", window=50)
        assert snippet == "short"

    def test_match_near_start_has_no_leading_ellipsis(self):
        snippet = extract_snippet("gamma tail here", "gamma", window=100)
        assert not snippet.startswith("…")


class TestStripGmSecrets:
    def test_removes_paired_spans(self):
        assert strip_gm_secrets("visible ||hidden|| tail") == "visible  tail"

    def test_leaves_unterminated_marker(self):
        assert strip_gm_secrets("open ||dangling") == "open ||dangling"

    def test_none_body_returns_empty(self):
        assert strip_gm_secrets(None) == ""
