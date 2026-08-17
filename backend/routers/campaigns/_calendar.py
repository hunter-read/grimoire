"""iCalendar (RFC 5545) feed generation for campaign schedules.

Hand-rolled rather than pulling in ``icalendar``: the output is a handful of
VEVENTs with no recurrence rules to compute and no parsing to do, so the
dependency would buy little over the code here. (VTIMEZONE components *are*
emitted — see ``build_vtimezone`` — but from the tz database directly.)

**Times are local, not UTC.** A schedule stores a local weekday and a local
clock, and events are published as ``DTSTART;TZID=<zone>:<local time>``. Storing
a UTC clock beside a local weekday is what published Sunday-night games as
Saturday: 19:30 America/Los_Angeles is 02:30 UTC the *following* day, so the
pair "Sunday, 02:30 UTC" describes Saturday evening. Keeping both halves local
removes the rollover by construction.

**Why the feed is read-only.** A subscribed ICS feed is fetched over plain HTTP
GET; the protocol has no write path back, so Accept/Tentative/Decline is inert
in Google/Apple/Outlook on subscribed events. Real RSVP requires either iMIP
(emailed METHOD:REQUEST invitations, replies parsed from an inbox) or Grimoire
acting as a CalDAV server — both far outside a schedule export. Instead the feed
is *personalised per user*: each event's summary and description reflect that
user's own availability, and carries a deep link to the campaign's schedule tab
where one click sets it. See ``docs/api.md``.
"""

import datetime
import zoneinfo
from typing import List, Optional, Tuple

# Fold long content lines per RFC 5545 §3.1: octet 76 max, continuations begin
# with a single space. Calendar parsers are strict about this.
_MAX_LINE = 75

# When a schedule has no time set, sessions are emitted as all-day events rather
# than guessing an hour the GM never chose.
_DEFAULT_DURATION_HOURS = 4


def _escape(value: str) -> str:
    """Escape a TEXT value per RFC 5545 §3.3.11."""
    return (
        value.replace("\\", "\\\\")
        .replace(";", "\\;")
        .replace(",", "\\,")
        .replace("\r\n", "\\n")
        .replace("\n", "\\n")
        .replace("\r", "\\n")
    )


def _fold(line: str) -> str:
    """Fold one content line to <=75 octets per continuation."""
    encoded = line.encode("utf-8")
    if len(encoded) <= _MAX_LINE:
        return line

    chunks: List[bytes] = []
    start = 0
    limit = _MAX_LINE
    while start < len(encoded):
        end = min(start + limit, len(encoded))
        # Never split a multi-byte character across a fold boundary: walk back to
        # the start of the character the boundary landed inside. Continuation
        # bytes match 0b10xxxxxx; stepping past the lead byte too is what keeps
        # `end` from settling on `start` and looping forever on a line of wide
        # characters (a 4-byte emoji at a 74-octet boundary hits this).
        if end < len(encoded):
            while end > start and (encoded[end] & 0xC0) == 0x80:
                end -= 1
        # A limit shorter than a single character would still make no progress;
        # emit the whole character and overrun the octet target rather than hang.
        if end == start:
            end = start + 1
            while end < len(encoded) and (encoded[end] & 0xC0) == 0x80:
                end += 1
        chunks.append(encoded[start:end])
        start = end
        limit = _MAX_LINE - 1  # continuation lines carry a leading space
    return "\r\n ".join(c.decode("utf-8") for c in chunks)


def _utc_stamp(dt: datetime.datetime) -> str:
    return dt.strftime("%Y%m%dT%H%M%SZ")


def _zone_or_none(tz_name: Optional[str]) -> Optional[zoneinfo.ZoneInfo]:
    """Resolve an IANA name, or None when it is absent or unknown to this host.

    Schedules validate the zone on write, but the tz database is the *server's*,
    so a name valid at save time can still be missing after a rebuild. Falling
    back beats raising inside a feed every client is polling.
    """
    if not tz_name:
        return None
    try:
        return zoneinfo.ZoneInfo(tz_name)
    except (zoneinfo.ZoneInfoNotFoundError, ValueError):
        return None


def _local_stamp(dt: datetime.datetime) -> str:
    """Format a local wall clock with no trailing Z — the value for a TZID form."""
    return dt.strftime("%Y%m%dT%H%M%S")


def _offset_str(offset: datetime.timedelta) -> str:
    """Render a UTC offset as the ``+HHMM`` / ``-HHMM`` ICS wants."""
    total = int(offset.total_seconds())
    sign = "-" if total < 0 else "+"
    total = abs(total)
    return f"{sign}{total // 3600:02d}{(total % 3600) // 60:02d}"


def _find_transitions(
    zone: zoneinfo.ZoneInfo, start_year: int, end_year: int
) -> List[datetime.datetime]:
    """Locate each UTC offset change in the range, to the second.

    ``zoneinfo`` exposes offsets but not the RRULEs a VTIMEZONE would like, so
    transitions are found by scanning day by day for an offset change and then
    binary-searching that day down to the exact instant. Zones with no DST
    simply yield nothing.
    """
    transitions: List[datetime.datetime] = []
    cursor = datetime.datetime(start_year, 1, 1, tzinfo=datetime.timezone.utc)
    end = datetime.datetime(end_year + 1, 1, 1, tzinfo=datetime.timezone.utc)
    step = datetime.timedelta(days=1)

    prev_offset = cursor.astimezone(zone).utcoffset()
    while cursor < end:
        nxt = cursor + step
        offset = nxt.astimezone(zone).utcoffset()
        if offset != prev_offset:
            # The change is somewhere in (cursor, nxt]; narrow to the second.
            lo, hi = cursor, nxt
            while (hi - lo) > datetime.timedelta(seconds=1):
                mid = lo + (hi - lo) / 2
                if mid.astimezone(zone).utcoffset() == prev_offset:
                    lo = mid
                else:
                    hi = mid
            transitions.append(hi)
            prev_offset = offset
        cursor = nxt
    return transitions


def build_vtimezone(tz_name: str, start_year: int, end_year: int) -> List[str]:
    """Build a VTIMEZONE for ``tz_name`` covering the given years.

    Emits one explicit STANDARD/DAYLIGHT subcomponent per observed transition
    rather than an RRULE. That is more verbose than a rule-based zone, but it is
    exact for the published window and needs no attempt to reverse-engineer a
    recurrence out of the tz database. Feeds only span a couple of years.
    """
    zone = zoneinfo.ZoneInfo(tz_name)
    lines = ["BEGIN:VTIMEZONE", f"TZID:{tz_name}"]

    transitions = _find_transitions(zone, start_year, end_year)

    if not transitions:
        # A zone with a fixed offset still needs one subcomponent to be valid.
        ref = datetime.datetime(start_year, 1, 1, tzinfo=datetime.timezone.utc).astimezone(zone)
        offset = _offset_str(ref.utcoffset() or datetime.timedelta())
        lines += [
            "BEGIN:STANDARD",
            f"DTSTART:{_local_stamp(datetime.datetime(start_year, 1, 1))}",
            f"TZOFFSETFROM:{offset}",
            f"TZOFFSETTO:{offset}",
            f"TZNAME:{ref.tzname() or tz_name}",
            "END:STANDARD",
        ]
    for moment in transitions:
        before = (moment - datetime.timedelta(seconds=1)).astimezone(zone)
        after = moment.astimezone(zone)
        # DTSTART in a VTIMEZONE is the local time the change takes effect,
        # expressed in the offset *being left*.
        local_start = moment.astimezone(zone).replace(tzinfo=None)
        is_daylight = bool(after.dst())
        lines += [
            "BEGIN:DAYLIGHT" if is_daylight else "BEGIN:STANDARD",
            f"DTSTART:{_local_stamp(local_start)}",
            f"TZOFFSETFROM:{_offset_str(before.utcoffset() or datetime.timedelta())}",
            f"TZOFFSETTO:{_offset_str(after.utcoffset() or datetime.timedelta())}",
            f"TZNAME:{after.tzname() or tz_name}",
            "END:DAYLIGHT" if is_daylight else "END:STANDARD",
        ]

    lines.append("END:VTIMEZONE")
    return lines


def build_event(
    *,
    uid: str,
    dtstamp: datetime.datetime,
    session_date: str,
    time_local: Optional[str],
    summary: str,
    description: str,
    url: str,
    cancelled: bool,
    timezone: Optional[str] = None,
    # Bumped from 0 when DTSTART moved to the TZID form. Subscribers cached the
    # old UTC-instant events at SEQUENCE:0, and clients are entitled to ignore
    # an update that does not increment it — without this the corrected weekday
    # would never reach a calendar that had already fetched the feed.
    sequence: int = 1,
) -> List[str]:
    """Build one VEVENT as a list of unfolded content lines."""
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_utc_stamp(dtstamp)}",
        f"SEQUENCE:{sequence}",
    ]

    day = datetime.date.fromisoformat(session_date)
    if time_local:
        hour, minute = (int(p) for p in time_local.split(":")[:2])
        # Both `session_date` and the time are local, so the pair is published as
        # a local wall clock. Collapsing it to a UTC instant is what moved
        # evening games onto the neighbouring day: 19:30 America/Los_Angeles is
        # 02:30Z the *next* day, and a client re-rendering that instant in the
        # viewer's zone shows Saturday night for a Sunday game. Naming the zone
        # instead keeps the weekday intact for every reader and lets the client
        # resolve DST from the VTIMEZONE.
        start_local = datetime.datetime(day.year, day.month, day.day, hour, minute)
        end_local = start_local + datetime.timedelta(hours=_DEFAULT_DURATION_HOURS)
        if timezone and _zone_or_none(timezone):
            lines.append(f"DTSTART;TZID={timezone}:{_local_stamp(start_local)}")
            lines.append(f"DTEND;TZID={timezone}:{_local_stamp(end_local)}")
        else:
            # No zone recorded, so the time is a *floating* local one: RFC 5545
            # §3.3.5 says a DATE-TIME with neither a TZID nor a trailing Z is
            # interpreted in the viewer's own zone. That is the best available
            # reading of "19:30" with no zone attached, and unlike the previous
            # UTC form it cannot shift the weekday.
            lines.append(f"DTSTART:{_local_stamp(start_local)}")
            lines.append(f"DTEND:{_local_stamp(end_local)}")
    else:
        # VALUE=DATE all-day event; DTEND is exclusive, so it is the next day.
        lines.append(f"DTSTART;VALUE=DATE:{day.strftime('%Y%m%d')}")
        lines.append(f"DTEND;VALUE=DATE:{(day + datetime.timedelta(days=1)).strftime('%Y%m%d')}")

    lines.append(f"SUMMARY:{_escape(summary)}")
    if description:
        lines.append(f"DESCRIPTION:{_escape(description)}")
    if url:
        lines.append(f"URL:{_escape(url)}")
    # A cancelled session keeps its UID and flips STATUS, so subscribers see the
    # existing event struck through rather than a silent disappearance.
    lines.append("STATUS:CANCELLED" if cancelled else "STATUS:CONFIRMED")
    lines.append("END:VEVENT")
    return lines


def _referenced_zones(events: List[List[str]]) -> List[str]:
    """Collect the TZIDs the events actually reference, in first-seen order."""
    found: List[str] = []
    for event in events:
        for line in event:
            if ";TZID=" not in line:
                continue
            tz_name = line.split(";TZID=", 1)[1].split(":", 1)[0]
            if tz_name and tz_name not in found:
                found.append(tz_name)
    return found


def _event_year_range(events: List[List[str]]) -> Tuple[int, int]:
    """The span of years the events cover, for sizing each VTIMEZONE."""
    years = []
    for event in events:
        for line in event:
            if not line.startswith(("DTSTART", "DTEND")):
                continue
            value = line.split(":", 1)[1] if ":" in line else ""
            if len(value) >= 4 and value[:4].isdigit():
                years.append(int(value[:4]))
    if not years:
        now = datetime.date.today().year
        return now, now
    return min(years), max(years)


def build_calendar(events: List[List[str]], *, name: str) -> str:
    """Wrap VEVENT blocks in a VCALENDAR and serialise with CRLF line endings.

    Any zone an event names via ``TZID`` gets a matching VTIMEZONE emitted ahead
    of the events. RFC 5545 requires the definition to travel with the feed —
    strict parsers reject a TZID they cannot resolve — and the zones are derived
    from the events themselves so a caller cannot forget to declare one.
    """
    lines = [
        "BEGIN:VCALENDAR",
        "VERSION:2.0",
        "PRODID:-//Grimoire//Campaign Schedule//EN",
        "CALSCALE:GREGORIAN",
        "METHOD:PUBLISH",
        f"X-WR-CALNAME:{_escape(name)}",
        f"NAME:{_escape(name)}",
        # Hint to subscribers on how often to re-poll. Advisory only; clients
        # routinely ignore it, which is fine — schedules move slowly.
        "REFRESH-INTERVAL;VALUE=DURATION:PT12H",
        "X-PUBLISHED-TTL:PT12H",
    ]

    start_year, end_year = _event_year_range(events)
    for tz_name in _referenced_zones(events):
        if _zone_or_none(tz_name) is None:
            continue
        lines.extend(build_vtimezone(tz_name, start_year, end_year))

    for event in events:
        lines.extend(event)
    lines.append("END:VCALENDAR")
    return "\r\n".join(_fold(line) for line in lines) + "\r\n"


def session_uid(campaign_id: str, session_date: str) -> str:
    """Stable UID for a session, so reschedules update rather than duplicate.

    Keyed on campaign + date rather than a row id because scheduled sessions are
    computed from the recurrence definition and have no row of their own until
    someone sets availability for them.
    """
    return f"grimoire-session-{campaign_id}-{session_date}@grimoire"
