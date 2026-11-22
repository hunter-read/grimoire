"""Upcoming session dates from a campaign's recurring schedule."""
import datetime
import re
from typing import List, Optional, Tuple

# The weeks a monthly schedule can fall on: the 1st to 4th, or -1 for the last.
MONTHLY_WEEKS = (1, 2, 3, 4, -1)

# How many weeks a rotating schedule's cycle may have: two (Friday one week,
# Saturday the next) up to four.
ROTATION_WEEKS = range(2, 5)

# How far from today a custom session date may be, either way, and how many a
# schedule may list. Ten years of weekly sessions fit in the count.
CUSTOM_DATE_WINDOW = datetime.timedelta(days=3653)
MAX_CUSTOM_DATES = 600

_ISO_DATE_RE = re.compile(r"\d{4}-\d{2}-\d{2}")
_CLOCK_RE = re.compile(r"(\d{1,2}):(\d{2})(?::\d{2})?")


def parse_iso_date(value: object) -> Optional[datetime.date]:
    """``value`` as a date when it is exactly ``YYYY-MM-DD``, else None.

    ``date.fromisoformat`` alone also takes ``20270102`` and week dates, which
    nothing else here would read the same way.
    """
    if not isinstance(value, str) or not _ISO_DATE_RE.fullmatch(value):
        return None
    try:
        return datetime.date.fromisoformat(value)
    except ValueError:
        return None


def in_custom_date_window(day: datetime.date, today: Optional[datetime.date] = None) -> bool:
    """Whether ``day`` is within ``CUSTOM_DATE_WINDOW`` of today."""
    today = today or datetime.date.today()
    try:
        return today - CUSTOM_DATE_WINDOW <= day <= today + CUSTOM_DATE_WINDOW
    except OverflowError:
        return False


def parse_clock(value: object) -> Optional[Tuple[int, int]]:
    """``(hour, minute)`` from an ``HH:MM`` (or ``HH:MM:SS``) clock, else None."""
    if not isinstance(value, str):
        return None
    m = _CLOCK_RE.fullmatch(value)
    if not m:
        return None
    hour, minute = int(m.group(1)), int(m.group(2))
    if hour > 23 or minute > 59:
        return None
    return hour, minute


def compute_next_sessions(definition: Optional[dict], n: int = 10) -> List[str]:
    """Return the next n session dates (YYYY-MM-DD) from today based on schedule.

    A value the schedule editor would refuse - a custom date that is not a date
    or is far from today, a month week outside ``MONTHLY_WEEKS`` - is skipped
    rather than raised on, so a row stored before those checks still reads.
    """
    if not definition:
        return []
    frequency = definition.get("frequency", "weekly")
    # Offset by one day so sessions don't disappear for users west of UTC before midnight.
    today = datetime.date.today() - datetime.timedelta(days=1)

    if frequency == "custom":
        custom_dates = definition.get("custom_dates") or []
        if not isinstance(custom_dates, list):
            return []
        parsed = (parse_iso_date(d) for d in custom_dates)
        future = sorted(
            {d.isoformat() for d in parsed if d and d >= today and in_custom_date_window(d)}
        )
        return future[:n]

    if frequency == "rotation":
        return _rotation_sessions(definition, today, n)

    days = definition.get("days", [])
    if not days:
        return []

    results: List[str] = []

    if frequency == "monthly":
        weekday = days[0]
        monthly_week = definition.get("monthly_week", 1)
        # A 5th week is readable too (months without one are skipped), though
        # the editor never offers it; anything else would overflow the date math.
        if monthly_week not in (*MONTHLY_WEEKS, 5) or not isinstance(weekday, int):
            return []
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


def week_monday(day: datetime.date) -> datetime.date:
    """The Monday of ``day``'s week."""
    return day - datetime.timedelta(days=day.weekday())


def _rotation_sessions(definition: dict, today: datetime.date, n: int) -> List[str]:
    """The next ``n`` dates of a rotating schedule, after ``today``.

    ``rotation`` lists the weekdays of each week in the cycle; the week holding
    ``rotation_reference`` is its first week. A week may be empty (a week off).
    A rotation the editor would refuse yields no dates.
    """
    rotation = definition.get("rotation")
    if not isinstance(rotation, list) or len(rotation) not in ROTATION_WEEKS:
        return []
    weeks: List[set[int]] = []
    for week in rotation:
        if not isinstance(week, list) or not all(
            isinstance(d, int) and 0 <= d <= 6 for d in week
        ):
            return []
        weeks.append(set(week))
    if not any(weeks):
        return []
    reference = parse_iso_date(definition.get("rotation_reference"))
    ref_monday = week_monday(reference or today)

    results: List[str] = []
    candidate = today
    # Every week of a non-empty cycle has a session within len(weeks) weeks, so
    # this bounds the search at the same two years the other kinds use.
    for _ in range(365 * 2):
        if len(results) >= n:
            break
        candidate += datetime.timedelta(days=1)
        index = ((week_monday(candidate) - ref_monday).days // 7) % len(weeks)
        if candidate.weekday() in weeks[index]:
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
