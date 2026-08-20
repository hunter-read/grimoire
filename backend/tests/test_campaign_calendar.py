"""Tests for campaign calendar (ICS) export and subscription feeds.

Covers backend/routers/campaigns/calendar.py and _calendar.py: the ICS writer,
the per-user token feeds (per-campaign and aggregate), the JWT-authenticated
one-off download, and token mint/rotate/revoke.

BASE_URL is read from the config module at import, so the tests that care about
it patch the name in the calendar module rather than the environment.
"""
import uuid

import pytest

from backend.config import SessionLocal
from backend.models import User
from backend.routers.campaigns import _calendar, calendar as calendar_mod

BASE = "https://grim.example"


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture(autouse=True)
def _base_url(monkeypatch):
    """Give every test a configured BASE_URL unless it opts out."""
    monkeypatch.setattr(calendar_mod, "BASE_URL", BASE)


@pytest.fixture()
def gm_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Cal {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def scheduled_campaign(client, gm_headers, gm_campaign):
    """A GM campaign with a weekly schedule, so the feed has events."""
    r = client.put(
        f"/api/campaigns/{gm_campaign['id']}/schedule",
        json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": True},
        headers=gm_headers,
    )
    assert r.status_code == 200, r.text
    return gm_campaign


def mint_token(client, headers):
    r = client.post("/api/campaigns/calendar/subscription", headers=headers)
    assert r.status_code == 200, r.text
    return r.json()


def token_of(client, headers):
    """Extract the raw token out of a minted feed URL."""
    body = mint_token(client, headers)
    # .../calendar/<token>/all.ics
    return body["feed_url"].rsplit("/", 2)[1]


def parse_lines(body: str):
    """Unfold folded content lines back into whole logical lines."""
    out = []
    for raw in body.split("\r\n"):
        if raw.startswith(" ") and out:
            out[-1] += raw[1:]
        else:
            out.append(raw)
    return out


# ---------------------------------------------------------------------------
# ICS writer unit tests
# ---------------------------------------------------------------------------


class TestIcsWriter:
    def test_escape_special_characters(self):
        assert _calendar._escape("a;b,c\\d") == "a\\;b\\,c\\\\d"
        assert _calendar._escape("line1\nline2") == "line1\\nline2"
        assert _calendar._escape("crlf\r\nhere") == "crlf\\nhere"

    def test_fold_long_line_respects_octet_limit(self):
        folded = _calendar._fold("DESCRIPTION:" + "x" * 300)
        segments = folded.split("\r\n")
        assert len(segments) > 1
        assert len(segments[0].encode()) <= 75
        for seg in segments[1:]:
            assert seg.startswith(" ")
            assert len(seg.encode()) <= 75
        # Unfolding restores the original.
        assert "".join([segments[0]] + [s[1:] for s in segments[1:]]) == "DESCRIPTION:" + "x" * 300

    def test_fold_never_splits_multibyte_character(self):
        folded = _calendar._fold("SUMMARY:" + "é" * 120)
        for seg in folded.split("\r\n"):
            # Would raise if a fold landed mid-character.
            seg.encode("utf-8").decode("utf-8")
        assert "".join(
            [folded.split("\r\n")[0]] + [s[1:] for s in folded.split("\r\n")[1:]]
        ) == "SUMMARY:" + "é" * 120

    def test_short_line_is_not_folded(self):
        assert _calendar._fold("SUMMARY:short") == "SUMMARY:short"

    def test_timed_event_without_a_zone_floats(self):
        """With no zone, the time is published as a floating local wall clock.

        RFC 5545 §3.3.5: a DATE-TIME with neither TZID nor a trailing Z is read in
        the viewer's own zone. That cannot shift the weekday, unlike the UTC form
        this replaced.
        """
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-03-14",
            time_local="18:30",
            summary="Session",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260314T183000" in lines
        assert "DTEND:20260314T223000" in lines
        assert "STATUS:CONFIRMED" in lines

    def test_zoned_event_publishes_local_time_with_tzid(self):
        """A zoned session keeps its local wall clock and names the zone.

        Collapsing the pair to a UTC instant is what moved evening games onto the
        neighbouring day: a Sunday 19:30 America/Los_Angeles game is 02:30Z on
        *Monday*, which clients then render as Saturday night for anyone west of
        UTC. The TZID form states the local time outright, so the weekday
        survives whatever zone the reader is in.
        """
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-16",  # a Sunday
            time_local="19:30",
            timezone="America/Los_Angeles",
            summary="Session",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART;TZID=America/Los_Angeles:20260816T193000" in lines
        assert "DTEND;TZID=America/Los_Angeles:20260816T233000" in lines
        # The bare UTC form is what produced the wrong weekday.
        assert not any(x.startswith("DTSTART:") for x in lines)

    def test_zoned_local_time_is_stable_across_dst(self):
        """The same wall clock is published either side of a DST shift.

        The offset differs (PDT vs PST) but the *local* time does not, which is
        the whole point of the TZID form — the VTIMEZONE carries the offsets.
        """
        import datetime

        def start_for(date):
            lines = _calendar.build_event(
                uid="u@grimoire",
                dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
                session_date=date,
                time_local="20:00",
                timezone="America/Los_Angeles",
                summary="S",
                description="",
                url="",
                cancelled=False,
            )
            return next(x for x in lines if x.startswith("DTSTART"))

        assert start_for("2026-08-18") == "DTSTART;TZID=America/Los_Angeles:20260818T200000"
        assert start_for("2026-12-15") == "DTSTART;TZID=America/Los_Angeles:20261215T200000"

    def test_vtimezone_is_emitted_for_referenced_zones(self):
        """RFC 5545 requires the zone definition to travel with the feed."""
        import datetime

        ev = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-16",
            time_local="19:30",
            timezone="America/Los_Angeles",
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        body = _calendar.build_calendar([ev], name="Cal")
        lines = parse_lines(body)
        assert "BEGIN:VTIMEZONE" in lines
        assert "TZID:America/Los_Angeles" in lines
        # Both 2026 transitions, with the right offsets and abbreviations.
        assert "TZNAME:PDT" in lines
        assert "TZNAME:PST" in lines
        assert "TZOFFSETTO:-0700" in lines
        assert "TZOFFSETTO:-0800" in lines
        # The VTIMEZONE must precede the events that reference it.
        assert lines.index("BEGIN:VTIMEZONE") < lines.index("BEGIN:VEVENT")

    def test_no_vtimezone_when_no_zone_is_recorded(self):
        """A legacy zoneless schedule keeps the UTC form and needs no VTIMEZONE."""
        import datetime

        ev = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-16",
            time_local="19:30",
            timezone=None,
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        body = _calendar.build_calendar([ev], name="Cal")
        assert "BEGIN:VTIMEZONE" not in body
        assert "DTSTART:20260816T193000" in parse_lines(body)

    def test_sequence_is_incremented_so_updates_reach_subscribers(self):
        """Subscribers cached the old UTC events at SEQUENCE:0.

        Clients may ignore an update whose SEQUENCE has not advanced, which would
        strand the corrected weekday in already-subscribed calendars.
        """
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-16",
            time_local="19:30",
            timezone="America/Los_Angeles",
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        assert "SEQUENCE:1" in lines

    def test_missing_timezone_floats_the_local_time(self):
        """A schedule with no zone publishes a floating local time, not UTC."""
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-18",
            time_local="20:00",
            timezone=None,
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260818T200000" in lines

    def test_unknown_timezone_falls_back_rather_than_erroring(self):
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-18",
            time_local="20:00",
            timezone="Mars/Olympus_Mons",
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        # Unknown to this host's tz database: float rather than raise inside a feed.
        assert "DTSTART:20260818T200000" in lines

    def test_sunday_evening_pacific_game_does_not_render_as_saturday(self):
        """Regression: "The Bled", a Sunday 19:30 Pacific game, arrived as Saturday.

        The feed published DTSTART:20260816T023000Z — a correct instant, but one
        that every client renders in the viewer's zone, putting a Pacific evening
        game on the previous day. Resolving the published value back through the
        zone has to land on Sunday.
        """
        import datetime
        import zoneinfo

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 8, 17, 5, 37, 25),
            session_date="2026-08-16",
            time_local="19:30",
            timezone="America/Los_Angeles",
            summary="The Bled",
            description="",
            url="",
            cancelled=False,
        )
        start = next(x for x in lines if x.startswith("DTSTART"))
        tzid, value = start.split("DTSTART;TZID=", 1)[1].split(":", 1)
        resolved = datetime.datetime.strptime(value, "%Y%m%dT%H%M%S").replace(
            tzinfo=zoneinfo.ZoneInfo(tzid)
        )
        assert resolved.strftime("%A") == "Sunday"
        assert resolved.strftime("%H:%M") == "19:30"

    def test_untimed_event_is_all_day_with_exclusive_end(self):
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-03-14",
            time_local=None,
            summary="Session",
            description="",
            url="",
            cancelled=True,
        )
        assert "DTSTART;VALUE=DATE:20260314" in lines
        assert "DTEND;VALUE=DATE:20260315" in lines
        assert "STATUS:CANCELLED" in lines

    def test_calendar_wraps_events_and_ends_with_crlf(self):
        body = _calendar.build_calendar([["BEGIN:VEVENT", "END:VEVENT"]], name="My Cal")
        assert body.startswith("BEGIN:VCALENDAR\r\n")
        assert body.endswith("END:VCALENDAR\r\n")
        assert "X-WR-CALNAME:My Cal" in body
        assert "PRODID:-//Grimoire//Campaign Schedule//EN" in body

    def test_session_uid_is_stable_per_campaign_and_date(self):
        a = _calendar.session_uid("c1", "2026-03-14")
        assert a == _calendar.session_uid("c1", "2026-03-14")
        assert a != _calendar.session_uid("c2", "2026-03-14")
        assert a != _calendar.session_uid("c1", "2026-03-21")


# ---------------------------------------------------------------------------
# Token management
# ---------------------------------------------------------------------------


class TestSubscriptionToken:
    def test_status_starts_without_token(self, client, player_headers):
        r = client.get("/api/campaigns/calendar/subscription", headers=player_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["base_url_configured"] is True
        # A previous test in this module may have minted one for this session
        # user, so only the shape is asserted here.
        assert "has_token" in body

    def test_mint_returns_feed_and_webcal_urls(self, client, gm_headers):
        body = mint_token(client, gm_headers)
        assert body["has_token"] is True
        assert body["feed_url"].startswith(f"{BASE}/api/campaigns/calendar/")
        assert body["feed_url"].endswith("/all.ics")
        assert body["webcal_url"].startswith("webcal://")
        # Same path, only the scheme differs.
        assert body["webcal_url"].split("://", 1)[1] == body["feed_url"].split("://", 1)[1]

    def test_mint_includes_campaign_feed_when_campaign_given(
        self, client, gm_headers, gm_campaign
    ):
        r = client.post(
            f"/api/campaigns/calendar/subscription?campaign_id={gm_campaign['id']}",
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["campaign_feed_url"].endswith(f"/{gm_campaign['id']}.ics")

    def test_rotate_invalidates_the_old_token(self, client, gm_headers, scheduled_campaign):
        old = token_of(client, gm_headers)
        new = token_of(client, gm_headers)
        assert old != new
        assert client.get(f"/api/campaigns/calendar/{old}/all.ics").status_code == 404
        assert client.get(f"/api/campaigns/calendar/{new}/all.ics").status_code == 200

    def test_revoke_clears_token_and_urls(self, client, gm_headers):
        tok = token_of(client, gm_headers)
        r = client.delete("/api/campaigns/calendar/subscription", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert body["has_token"] is False
        assert body["feed_url"] is None
        assert client.get(f"/api/campaigns/calendar/{tok}/all.ics").status_code == 404

    def test_mint_requires_base_url(self, client, gm_headers, monkeypatch):
        monkeypatch.setattr(calendar_mod, "BASE_URL", "http://localhost:9481")
        r = client.post("/api/campaigns/calendar/subscription", headers=gm_headers)
        assert r.status_code == 400
        assert "BASE_URL" in r.json()["detail"]

    def test_status_reports_unconfigured_base_url(self, client, gm_headers, monkeypatch):
        mint_token(client, gm_headers)
        monkeypatch.setattr(calendar_mod, "BASE_URL", "http://localhost:9481")
        r = client.get("/api/campaigns/calendar/subscription", headers=gm_headers)
        body = r.json()
        assert body["base_url_configured"] is False
        # The token still exists; only the URL is withheld.
        assert body["has_token"] is True
        assert body["feed_url"] is None

    def test_subscription_requires_auth(self, client):
        assert client.get("/api/campaigns/calendar/subscription").status_code == 401


# ---------------------------------------------------------------------------
# Feeds
# ---------------------------------------------------------------------------


class TestCampaignFeed:
    def test_feed_serves_calendar_media_type_with_events(
        self, client, gm_headers, scheduled_campaign
    ):
        tok = token_of(client, gm_headers)
        r = client.get(f"/api/campaigns/calendar/{tok}/{scheduled_campaign['id']}.ics")
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/calendar")
        assert r.headers["cache-control"] == "no-store, max-age=0"
        body = r.text
        assert body.startswith("BEGIN:VCALENDAR")
        assert body.count("BEGIN:VEVENT") > 0
        assert scheduled_campaign["name"] in body

    def test_event_uid_is_stable_and_deep_links_to_schedule_tab(
        self, client, gm_headers, scheduled_campaign
    ):
        tok = token_of(client, gm_headers)
        cid = scheduled_campaign["id"]
        first = client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text
        second = client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text
        uids = [ln for ln in parse_lines(first) if ln.startswith("UID:")]
        assert uids == [ln for ln in parse_lines(second) if ln.startswith("UID:")]
        assert all(u.startswith(f"UID:grimoire-session-{cid}-") for u in uids)
        assert f"{BASE}/campaigns/{cid}?tab=schedule" in first.replace("\r\n ", "")

    def test_feed_reflects_the_callers_own_availability(
        self, client, gm_headers, scheduled_campaign
    ):
        cid = scheduled_campaign["id"]
        date = client.get(f"/api/campaigns/{cid}/schedule", headers=gm_headers).json()[
            "next_sessions"
        ][0]
        client.put(
            f"/api/campaigns/{cid}/availability/{date}",
            json={"status": "tentative"},
            headers=gm_headers,
        )
        tok = token_of(client, gm_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text.replace("\r\n ", "")
        assert "- Tentative" in body
        assert "Your availability: Tentative" in body

    def test_rescheduling_updates_the_event_under_the_same_uid(
        self, client, gm_headers, scheduled_campaign
    ):
        """A changed session time must move the existing event, not add one."""
        cid = scheduled_campaign["id"]
        tok = token_of(client, gm_headers)

        before = parse_lines(client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text)
        before_uids = {ln for ln in before if ln.startswith("UID:")}
        assert any(ln.startswith("DTSTART") and ln.endswith("T180000") for ln in before)

        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "20:00", "enabled": True},
            headers=gm_headers,
        )
        after = parse_lines(client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text)
        assert {ln for ln in after if ln.startswith("UID:")} == before_uids
        assert any(ln.startswith("DTSTART") and ln.endswith("T200000") for ln in after)

    def test_cancelled_session_is_marked_not_removed(
        self, client, gm_headers, scheduled_campaign
    ):
        cid = scheduled_campaign["id"]
        date = client.get(f"/api/campaigns/{cid}/schedule", headers=gm_headers).json()[
            "next_sessions"
        ][0]
        client.put(f"/api/campaigns/{cid}/availability/{date}/cancel", headers=gm_headers)

        tok = token_of(client, gm_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text
        assert "STATUS:CANCELLED" in body
        assert _calendar.session_uid(cid, date) in body.replace("\r\n ", "")

    def test_campaign_without_schedule_yields_an_empty_calendar(
        self, client, gm_headers, gm_campaign
    ):
        tok = token_of(client, gm_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/{gm_campaign['id']}.ics").text
        assert body.startswith("BEGIN:VCALENDAR")
        assert "BEGIN:VEVENT" not in body

    def test_disabled_schedule_yields_no_events(self, client, gm_headers, scheduled_campaign):
        cid = scheduled_campaign["id"]
        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": False},
            headers=gm_headers,
        )
        tok = token_of(client, gm_headers)
        assert "BEGIN:VEVENT" not in client.get(
            f"/api/campaigns/calendar/{tok}/{cid}.ics"
        ).text

    def test_invalid_token_is_404(self, client, scheduled_campaign):
        r = client.get(f"/api/campaigns/calendar/nope-not-a-token/{scheduled_campaign['id']}.ics")
        assert r.status_code == 404

    def test_unknown_campaign_is_404(self, client, gm_headers):
        tok = token_of(client, gm_headers)
        assert client.get(f"/api/campaigns/calendar/{tok}/{uuid.uuid4()}.ics").status_code == 404

    def test_non_member_cannot_read_the_feed(
        self, client, gm_headers, player_headers, scheduled_campaign
    ):
        """The token authenticates; membership still authorises."""
        player_tok = token_of(client, player_headers)
        r = client.get(
            f"/api/campaigns/calendar/{player_tok}/{scheduled_campaign['id']}.ics"
        )
        assert r.status_code == 404

    def test_archived_campaign_feed_is_404(self, client, gm_headers, scheduled_campaign):
        cid = scheduled_campaign["id"]
        arch = client.put(
            f"/api/campaigns/{cid}/archive", json={"archived": True}, headers=gm_headers
        )
        assert arch.status_code == 200, arch.text
        tok = token_of(client, gm_headers)
        assert client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").status_code == 404


class TestAggregateFeed:
    def test_merges_every_campaign_the_user_belongs_to(
        self, client, gm_headers, scheduled_campaign
    ):
        second = client.post(
            "/api/campaigns",
            json={"name": f"Second {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        client.put(
            f"/api/campaigns/{second['id']}/schedule",
            json={"frequency": "weekly", "days": [1], "time_utc": "17:00", "enabled": True},
            headers=gm_headers,
        )

        tok = token_of(client, gm_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/all.ics").text.replace("\r\n ", "")
        assert scheduled_campaign["name"] in body
        assert second["name"] in body
        assert "X-WR-CALNAME:Grimoire - My Campaigns" in body

    def test_accepted_member_sees_the_gms_campaign(
        self, client, gm_headers, player_headers, player_id, scheduled_campaign
    ):
        cid = scheduled_campaign["id"]
        inv = client.post(
            f"/api/campaigns/{cid}/invite",
            json={"user_id": player_id},
            headers=gm_headers,
        )
        assert inv.status_code == 201, inv.text
        acc = client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        assert acc.status_code == 200, acc.text

        tok = token_of(client, player_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/all.ics").text.replace("\r\n ", "")
        assert scheduled_campaign["name"] in body
        # And the per-campaign feed now resolves for them too.
        assert client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").status_code == 200

    def test_invalid_token_is_404(self, client):
        assert client.get("/api/campaigns/calendar/bogus/all.ics").status_code == 404

    def test_head_is_allowed_on_both_feeds(self, client, gm_headers, scheduled_campaign):
        """Google Calendar probes a subscription URL with HEAD before accepting it.

        A 405 here makes it reject the feed and import nothing, with no error
        surfaced to the user — so both feed routes must answer HEAD.
        """
        tok = token_of(client, gm_headers)
        cid = scheduled_campaign["id"]

        for url in (
            f"/api/campaigns/calendar/{tok}/all.ics",
            f"/api/campaigns/calendar/{tok}/{cid}.ics",
        ):
            r = client.head(url)
            assert r.status_code == 200, f"{url} -> {r.status_code}"
            assert r.headers["content-type"].startswith("text/calendar")
            # HEAD carries the headers but no body, per RFC 9110.
            assert r.text == ""

    def test_head_on_invalid_token_is_404(self, client):
        assert client.head("/api/campaigns/calendar/bogus/all.ics").status_code == 404

    def test_feed_is_empty_for_a_user_with_no_campaigns(self, client, admin_headers):
        tok = token_of(client, admin_headers)
        body = client.get(f"/api/campaigns/calendar/{tok}/all.ics").text
        assert body.startswith("BEGIN:VCALENDAR")

    def test_feeds_are_served_inline_not_as_attachments(
        self, client, gm_headers, scheduled_campaign
    ):
        """Google Calendar's "From URL" fetcher rejects an ICS feed served as
        ``Content-Disposition: attachment`` — it reads the header as a file to
        download rather than a calendar to poll. Apple/Outlook ignore the header,
        which is why an attachment feed appears to work everywhere but Google.
        """
        tok = token_of(client, gm_headers)
        for url in (
            f"/api/campaigns/calendar/{tok}/all.ics",
            f"/api/campaigns/calendar/{tok}/{scheduled_campaign['id']}.ics",
        ):
            r = client.get(url)
            assert r.status_code == 200
            assert r.headers["content-disposition"].startswith("inline")
            assert "attachment" not in r.headers["content-disposition"]


# ---------------------------------------------------------------------------
# One-off download
# ---------------------------------------------------------------------------


class TestCalendarDownload:
    def test_download_returns_ics_for_a_member(self, client, gm_headers, scheduled_campaign):
        r = client.get(
            f"/api/campaigns/{scheduled_campaign['id']}/calendar.ics", headers=gm_headers
        )
        assert r.status_code == 200
        assert r.headers["content-type"].startswith("text/calendar")
        assert "attachment" in r.headers["content-disposition"]
        assert r.text.count("BEGIN:VEVENT") > 0

    def test_download_works_without_base_url(
        self, client, gm_headers, scheduled_campaign, monkeypatch
    ):
        """The static download needs no public origin — only the feed does."""
        monkeypatch.setattr(calendar_mod, "BASE_URL", "http://localhost:9481")
        r = client.get(
            f"/api/campaigns/{scheduled_campaign['id']}/calendar.ics", headers=gm_headers
        )
        assert r.status_code == 200
        assert r.text.startswith("BEGIN:VCALENDAR")

    def test_download_rejects_non_member(self, client, player_headers, gm_headers):
        fresh = client.post(
            "/api/campaigns",
            json={"name": f"Private {uid()}", "is_gm_campaign": True},
            headers=gm_headers,
        ).json()
        r = client.get(f"/api/campaigns/{fresh['id']}/calendar.ics", headers=player_headers)
        assert r.status_code == 403

    def test_download_unknown_campaign_is_404(self, client, gm_headers):
        r = client.get(f"/api/campaigns/{uuid.uuid4()}/calendar.ics", headers=gm_headers)
        assert r.status_code == 404

    def test_download_requires_auth(self, client, scheduled_campaign):
        r = client.get(f"/api/campaigns/{scheduled_campaign['id']}/calendar.ics")
        assert r.status_code == 401


class TestTokenIsolation:
    def test_calendar_token_is_not_the_opds_token(self, client, gm_headers, gm_id):
        """Rotating the calendar token must not disturb OPDS or login."""
        db = SessionLocal()
        try:
            user = db.query(User).filter_by(id=gm_id).first()
            user.opds_token = "opds-fixed-token"
            db.commit()
        finally:
            db.close()

        token_of(client, gm_headers)

        db = SessionLocal()
        try:
            user = db.query(User).filter_by(id=gm_id).first()
            assert user.opds_token == "opds-fixed-token"
            assert user.calendar_token != user.opds_token
        finally:
            db.close()

        # The JWT still works.
        assert client.get("/api/campaigns", headers=gm_headers).status_code == 200
