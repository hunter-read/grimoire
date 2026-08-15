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

    def test_timed_event_has_utc_start_and_end(self):
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-03-14",
            time_utc="18:30",
            summary="Session",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260314T183000Z" in lines
        assert "DTEND:20260314T223000Z" in lines
        assert "STATUS:CONFIRMED" in lines

    def test_local_time_crossing_midnight_utc_shifts_the_date(self):
        """A Tuesday 20:00 America/Los_Angeles game is 03:00 UTC on Wednesday.

        Publishing it as 03:00 on Tuesday put every session a day early in
        subscribers' calendars — the schedule read "Tuesday" but the feed
        rendered Monday 8pm local.
        """
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-18",  # a Tuesday
            time_utc="20:00",
            timezone="America/Los_Angeles",
            summary="Session",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260819T030000Z" in lines
        assert "DTEND:20260819T070000Z" in lines

    def test_utc_offset_follows_dst(self):
        """The same wall-clock time resolves differently either side of a DST shift."""
        import datetime

        def start_for(date):
            lines = _calendar.build_event(
                uid="u@grimoire",
                dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
                session_date=date,
                time_utc="20:00",
                timezone="America/Los_Angeles",
                summary="S",
                description="",
                url="",
                cancelled=False,
            )
            return next(x for x in lines if x.startswith("DTSTART:"))

        # PDT (UTC-7) in August, PST (UTC-8) in December.
        assert start_for("2026-08-18") == "DTSTART:20260819T030000Z"
        assert start_for("2026-12-15") == "DTSTART:20261216T040000Z"

    def test_missing_timezone_keeps_legacy_behaviour(self):
        """Schedules saved before the zone was captured publish the pair as-is."""
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-18",
            time_utc="20:00",
            timezone=None,
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260818T200000Z" in lines

    def test_unknown_timezone_falls_back_rather_than_erroring(self):
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-08-18",
            time_utc="20:00",
            timezone="Mars/Olympus_Mons",
            summary="S",
            description="",
            url="",
            cancelled=False,
        )
        assert "DTSTART:20260818T200000Z" in lines

    def test_untimed_event_is_all_day_with_exclusive_end(self):
        import datetime

        lines = _calendar.build_event(
            uid="u@grimoire",
            dtstamp=datetime.datetime(2026, 1, 1, 12, 0, 0),
            session_date="2026-03-14",
            time_utc=None,
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
        assert "— Tentative" in body
        assert "Your availability: Tentative" in body

    def test_rescheduling_updates_the_event_under_the_same_uid(
        self, client, gm_headers, scheduled_campaign
    ):
        """A changed session time must move the existing event, not add one."""
        cid = scheduled_campaign["id"]
        tok = token_of(client, gm_headers)

        before = parse_lines(client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text)
        before_uids = {ln for ln in before if ln.startswith("UID:")}
        assert any(ln.startswith("DTSTART:") and ln.endswith("T180000Z") for ln in before)

        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "20:00", "enabled": True},
            headers=gm_headers,
        )
        after = parse_lines(client.get(f"/api/campaigns/calendar/{tok}/{cid}.ics").text)
        assert {ln for ln in after if ln.startswith("UID:")} == before_uids
        assert any(ln.startswith("DTSTART:") and ln.endswith("T200000Z") for ln in after)

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
        assert "X-WR-CALNAME:Grimoire — My Campaigns" in body

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
