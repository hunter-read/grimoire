"""Upcoming session dates from a campaign's recurring schedule."""
import datetime
from typing import List, Optional


def compute_next_sessions(definition: Optional[dict], n: int = 10) -> List[str]:
    """Return the next n session dates (YYYY-MM-DD) from today based on schedule."""
    if not definition:
        return []
    frequency = definition.get("frequency", "weekly")
    # Offset by one day so sessions don't disappear for users west of UTC before midnight.
    today = datetime.date.today() - datetime.timedelta(days=1)

    if frequency == "custom":
        custom_dates = definition.get("custom_dates", [])
        future = sorted(d for d in custom_dates if d >= today.isoformat())
        return future[:n]

    days = definition.get("days", [])
    if not days:
        return []

    results: List[str] = []

    if frequency == "monthly":
        weekday = days[0]
        monthly_week = definition.get("monthly_week", 1)
        year, month = today.year, today.month
        for _ in range(24):
            if len(results) >= n:
                break
            d = nth_weekday_of_month(year, month, weekday, monthly_week)
            if d and d >= today:
                results.append(d.isoformat())
            month += 1
            if month > 12:
                month = 1
                year += 1
        return results

    reference = definition.get("biweekly_reference")
    if frequency == "biweekly" and reference:
        try:
            ref_date = datetime.date.fromisoformat(reference)
            ref_monday = ref_date - datetime.timedelta(days=ref_date.weekday())
        except ValueError:
            ref_monday = today - datetime.timedelta(days=today.weekday())
    else:
        ref_monday = None

    candidate = today
    max_search = 365 * 2
    searched = 0
    while len(results) < n and searched < max_search:
        searched += 1
        candidate += datetime.timedelta(days=1)
        if candidate.weekday() not in days:
            continue
        if frequency == "biweekly" and ref_monday:
            week_monday = candidate - datetime.timedelta(days=candidate.weekday())
            delta_weeks = (week_monday - ref_monday).days // 7
            if delta_weeks % 2 != 0:
                continue
        results.append(candidate.isoformat())

    return results


def nth_weekday_of_month(year: int, month: int, weekday: int, n: int) -> Optional[datetime.date]:
    """Return the nth occurrence (1-based, -1=last) of weekday (0=Mon) in year/month."""
    first_day = datetime.date(year, month, 1)
    first_wd = first_day.weekday()
    diff = (weekday - first_wd) % 7
    first_occurrence = first_day + datetime.timedelta(days=diff)
    if n == -1:
        last = first_occurrence
        while (last + datetime.timedelta(weeks=1)).month == month:
            last += datetime.timedelta(weeks=1)
        return last
    occurrence = first_occurrence + datetime.timedelta(weeks=n - 1)
    if occurrence.month != month:
        return None
    return occurrence
