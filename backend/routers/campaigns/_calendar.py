"""iCalendar (RFC 5545) feed generation for campaign schedules.

Hand-rolled rather than pulling in ``icalendar``: the output is a handful of
VEVENTs with no recurrence rules, timezone components, or parsing to do, so the
dependency would buy little over the ~80 lines here.

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
from typing import List, Optional

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


def build_event(
    *,
    uid: str,
    dtstamp: datetime.datetime,
    session_date: str,
    time_utc: Optional[str],
    summary: str,
    description: str,
    url: str,
    cancelled: bool,
    sequence: int = 0,
) -> List[str]:
    """Build one VEVENT as a list of unfolded content lines."""
    lines = [
        "BEGIN:VEVENT",
        f"UID:{uid}",
        f"DTSTAMP:{_utc_stamp(dtstamp)}",
        f"SEQUENCE:{sequence}",
    ]

    day = datetime.date.fromisoformat(session_date)
    if time_utc:
        hour, minute = (int(p) for p in time_utc.split(":")[:2])
        start = datetime.datetime(day.year, day.month, day.day, hour, minute)
        end = start + datetime.timedelta(hours=_DEFAULT_DURATION_HOURS)
        lines.append(f"DTSTART:{_utc_stamp(start)}")
        lines.append(f"DTEND:{_utc_stamp(end)}")
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


def build_calendar(events: List[List[str]], *, name: str) -> str:
    """Wrap VEVENT blocks in a VCALENDAR and serialise with CRLF line endings."""
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
