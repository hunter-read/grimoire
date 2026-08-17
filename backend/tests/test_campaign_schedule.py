"""Endpoint tests for campaign schedule and availability.

Covers backend/routers/campaigns/schedule.py: get/upsert/delete schedule and
get/set availability plus cancel_session_date, including the auth and validation
guard branches. (The recurrence math itself is unit-tested in
test_campaign_schedule_helpers.py.)
"""
import uuid

import pytest


def uid():
    return uuid.uuid4().hex[:8]


@pytest.fixture()
def gm_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Sched {uid()}", "is_gm_campaign": True},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


@pytest.fixture()
def plain_campaign(client, gm_headers):
    resp = client.post(
        "/api/campaigns",
        json={"name": f"Plain {uid()}", "is_gm_campaign": False},
        headers=gm_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestSchedule:
    def test_get_schedule_empty(self, client, gm_headers, gm_campaign):
        r = client.get(f"/api/campaigns/{gm_campaign['id']}/schedule", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert body == {"definition": None, "enabled": False, "next_sessions": []}

    def test_upsert_and_get_weekly_schedule(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        body = r.json()
        assert body["enabled"] is True
        assert body["definition"]["frequency"] == "weekly"
        assert len(body["next_sessions"]) > 0

        # Get reflects the stored definition and computes upcoming sessions.
        g = client.get(f"/api/campaigns/{cid}/schedule", headers=gm_headers)
        assert g.json()["definition"]["days"] == [5]

    def test_timezone_is_stored_on_the_definition(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={
                "frequency": "weekly",
                "days": [1],
                "time_utc": "20:00",
                "timezone": "America/Los_Angeles",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["definition"]["timezone"] == "America/Los_Angeles"

    def test_invalid_timezone_is_rejected(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={
                "frequency": "weekly",
                "days": [1],
                "time_utc": "20:00",
                "timezone": "Mars/Olympus_Mons",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 400

    def test_upsert_biweekly_monthly_custom_and_update(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        # biweekly fills a reference date
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "biweekly", "days": [2], "time_utc": "19:00", "enabled": True},
            headers=gm_headers,
        )
        assert "biweekly_reference" in r.json()["definition"]
        # monthly fills monthly_week; updating the existing row takes the else-branch
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={
                "frequency": "monthly",
                "days": [0],
                "time_utc": "20:00",
                "monthly_week": 2,
                "enabled": False,
            },
            headers=gm_headers,
        )
        assert r.json()["definition"]["monthly_week"] == 2
        assert r.json()["enabled"] is False
        # disabled schedule yields no next_sessions
        assert r.json()["next_sessions"] == []
        # custom sorts + dedups the supplied dates
        r = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={
                "frequency": "custom",
                "days": [],
                "time_utc": "21:00",
                "custom_dates": ["2026-02-02", "2026-01-01", "2026-01-01"],
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.json()["definition"]["custom_dates"] == ["2026-01-01", "2026-02-02"]

    def test_upsert_rejects_bad_frequency_and_days(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        bad_freq = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "hourly", "days": [1], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        assert bad_freq.status_code == 400
        bad_days = client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [9], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        assert bad_days.status_code == 400

    def test_upsert_rejects_non_gm_campaign(self, client, gm_headers, plain_campaign):
        r = client.put(
            f"/api/campaigns/{plain_campaign['id']}/schedule",
            json={"frequency": "weekly", "days": [1], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        assert r.status_code == 400

    def test_delete_schedule(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        d = client.delete(f"/api/campaigns/{cid}/schedule", headers=gm_headers)
        assert d.status_code == 204
        # Idempotent: deleting again is a no-op (schedule already gone).
        d2 = client.delete(f"/api/campaigns/{cid}/schedule", headers=gm_headers)
        assert d2.status_code == 204

    def test_non_member_cannot_view_schedule(self, client, player_headers, gm_campaign):
        r = client.get(f"/api/campaigns/{gm_campaign['id']}/schedule", headers=player_headers)
        assert r.status_code == 403


class TestAvailability:
    def test_get_availability_reports_owner_row(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        r = client.get(f"/api/campaigns/{cid}/availability", headers=gm_headers)
        assert r.status_code == 200
        body = r.json()
        assert len(body["next_sessions"]) > 0
        # The GM owner appears as a participant row.
        assert any(row["is_owner"] for row in body["rows"])

    def test_set_availability_and_reflect_in_get(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={"frequency": "weekly", "days": [5], "time_utc": "18:00", "enabled": True},
            headers=gm_headers,
        )
        date = client.get(f"/api/campaigns/{cid}/availability", headers=gm_headers).json()[
            "next_sessions"
        ][0]
        r = client.put(
            f"/api/campaigns/{cid}/availability/{date}",
            json={"status": "available"},
            headers=gm_headers,
        )
        assert r.status_code == 200
        assert r.json()["status"] == "available"
        # Update the existing row (tentative) — exercises the update branch.
        r2 = client.put(
            f"/api/campaigns/{cid}/availability/{date}",
            json={"status": "tentative"},
            headers=gm_headers,
        )
        assert r2.json()["status"] == "tentative"

    def test_set_availability_validation(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        bad_status = client.put(
            f"/api/campaigns/{cid}/availability/2026-01-01",
            json={"status": "maybe"},
            headers=gm_headers,
        )
        assert bad_status.status_code == 400
        bad_date = client.put(
            f"/api/campaigns/{cid}/availability/not-a-date",
            json={"status": "available"},
            headers=gm_headers,
        )
        assert bad_date.status_code == 400

    def test_non_gm_cannot_cancel_via_set(self, client, gm_headers, player_headers, player_id, gm_campaign):
        cid = gm_campaign["id"]
        client.post(
            f"/api/campaigns/{cid}/invite", json={"user_id": player_id}, headers=gm_headers
        )
        client.patch(
            f"/api/campaigns/{cid}/members/{player_id}",
            json={"status": "accepted"},
            headers=player_headers,
        )
        r = client.put(
            f"/api/campaigns/{cid}/availability/2026-01-01",
            json={"status": "available", "is_cancelled": True},
            headers=player_headers,
        )
        assert r.status_code == 403

    def test_cancel_session_date_toggles(self, client, gm_headers, gm_campaign):
        cid = gm_campaign["id"]
        r = client.put(
            f"/api/campaigns/{cid}/availability/2026-03-03/cancel", headers=gm_headers
        )
        assert r.status_code == 200
        assert r.json()["is_cancelled"] is True
        # Toggle back.
        r2 = client.put(
            f"/api/campaigns/{cid}/availability/2026-03-03/cancel", headers=gm_headers
        )
        assert r2.json()["is_cancelled"] is False

    def test_cancel_session_date_rejects_non_gm_and_bad_date(
        self, client, gm_headers, player_headers, gm_campaign
    ):
        cid = gm_campaign["id"]
        not_gm = client.put(
            f"/api/campaigns/{cid}/availability/2026-03-03/cancel", headers=player_headers
        )
        assert not_gm.status_code == 403
        bad_date = client.put(
            f"/api/campaigns/{cid}/availability/nope/cancel", headers=gm_headers
        )
        assert bad_date.status_code == 400


class TestLocalTimeModel:
    """The stored pair is local throughout: a local weekday and a local clock.

    Storing a UTC clock beside a local weekday is what published Sunday-night
    games as Saturday — 19:30 America/Los_Angeles is 02:30 UTC the *following*
    day, and only the clock survived the browser's conversion.
    """

    def test_local_time_is_stored_verbatim(self, client, gm_headers, gm_campaign):
        r = client.put(
            f"/api/campaigns/{gm_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_local": "19:30",
                "timezone": "America/Los_Angeles",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        definition = r.json()["definition"]
        # No conversion, and no rollover to lose.
        assert definition["time_local"] == "19:30"
        assert definition["days"] == [6]
        assert definition["timezone"] == "America/Los_Angeles"
        assert definition["time_model"] == "local"
        assert "time_utc" not in definition

    def test_legacy_utc_payload_is_converted_on_write(self, client, gm_headers, gm_campaign):
        """An older frontend still posts a UTC clock; it is converted, not stored raw."""
        r = client.put(
            f"/api/campaigns/{gm_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_utc": "02:30",
                "timezone": "America/Los_Angeles",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        definition = r.json()["definition"]
        # 02:30Z is 19:30 Pacific.
        assert definition["time_local"] == "19:30"
        assert "time_utc" not in definition

    def test_legacy_utc_payload_without_zone_is_kept_as_is(
        self, client, gm_headers, gm_campaign
    ):
        """With no zone there is nothing to convert against, so the clock passes through."""
        r = client.put(
            f"/api/campaigns/{gm_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_utc": "18:00",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["definition"]["time_local"] == "18:00"

    def test_sunday_evening_pacific_feed_lands_on_sunday(
        self, client, gm_headers, gm_campaign
    ):
        """End to end: the reported bug. A Sunday 19:30 Pacific game must read Sunday."""
        import datetime
        import zoneinfo

        cid = gm_campaign["id"]
        client.put(
            f"/api/campaigns/{cid}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_local": "19:30",
                "timezone": "America/Los_Angeles",
                "enabled": True,
            },
            headers=gm_headers,
        )
        body = client.get(f"/api/campaigns/{cid}/calendar.ics", headers=gm_headers).text
        # Only the events' DTSTARTs — a VTIMEZONE's transition DTSTARTs also
        # start with "DTSTART" but carry no TZID.
        starts = [
            ln
            for ln in body.replace("\r\n ", "").split("\r\n")
            if ln.startswith("DTSTART;TZID=")
        ]
        assert starts, body
        for line in starts:
            tzid, value = line.split("DTSTART;TZID=", 1)[1].split(":", 1)
            resolved = datetime.datetime.strptime(value, "%Y%m%dT%H%M%S").replace(
                tzinfo=zoneinfo.ZoneInfo(tzid)
            )
            assert resolved.strftime("%A") == "Sunday", line
            assert resolved.strftime("%H:%M") == "19:30", line


class TestScheduleTimeMigration:
    """The startup migration that moves stored UTC clocks to local ones.

    Exercised directly against a throwaway SQLite database rather than through
    the app, so the pre-migration shape can be written verbatim.
    """

    def _migrate(self, rows):
        """Write `rows` as campaign_schedules definitions, migrate, return them."""
        import json
        import sqlite3
        import tempfile

        from sqlalchemy import create_engine, text

        from backend.models.db import _migrate_schedule_times_to_local

        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            path = f.name
        conn = sqlite3.connect(path)
        conn.execute("CREATE TABLE campaign_schedules (id TEXT PRIMARY KEY, definition TEXT)")
        for i, definition in enumerate(rows):
            conn.execute(
                "INSERT INTO campaign_schedules (id, definition) VALUES (?, ?)",
                (str(i), json.dumps(definition)),
            )
        conn.commit()
        conn.close()

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as c:
            _migrate_schedule_times_to_local(c)
        with engine.connect() as c:
            out = [
                json.loads(r[0])
                for r in c.execute(
                    text("SELECT definition FROM campaign_schedules ORDER BY CAST(id AS INT)")
                ).fetchall()
            ]
        engine.dispose()
        return out

    def test_evening_utc_clock_becomes_local_and_keeps_the_weekday(self):
        """The reported bug, as stored: Sunday + 02:30Z, a 19:30 Pacific game.

        Only the clock was corrupted — the browser converted 19:30 local to 02:30
        UTC and dropped the day it rolled into, while `days` kept the Sunday the
        GM picked and the UI displayed. Recovering the clock restores the intended
        pair; the weekday must not move.
        """
        (out,) = self._migrate(
            [
                {
                    "days": [6],  # Sunday, per the old (wrong) pairing
                    "frequency": "weekly",
                    "time_utc": "02:30",
                    "timezone": "America/Los_Angeles",
                }
            ]
        )
        assert out["time_local"] == "19:30"
        # Sunday stays Sunday: the weekday was never the corrupted half.
        assert out["days"] == [6]
        assert out["time_model"] == "local"
        assert "time_utc" not in out

    def test_daytime_utc_clock_keeps_its_weekday(self):
        """A time that does not cross midnight locally leaves `days` alone."""
        (out,) = self._migrate(
            [
                {
                    "days": [2],
                    "frequency": "weekly",
                    "time_utc": "20:00",
                    "timezone": "Europe/London",
                }
            ]
        )
        assert out["days"] == [2]
        assert out["time_model"] == "local"

    def test_zoneless_schedule_keeps_its_clock(self):
        """With no zone there is nothing to undo the original shift with."""
        (out,) = self._migrate(
            [{"days": [1], "frequency": "weekly", "time_utc": "18:00", "timezone": None}]
        )
        assert out["time_local"] == "18:00"
        assert out["days"] == [1]
        assert out["time_model"] == "local"

    def test_all_day_schedule_migrates_without_a_time(self):
        (out,) = self._migrate(
            [{"days": [3], "frequency": "weekly", "time_utc": None, "timezone": "UTC"}]
        )
        assert out["time_local"] is None
        assert out["time_model"] == "local"

    def test_migration_is_idempotent(self):
        """Re-running must not convert an already-local row a second time."""
        rows = [
            {
                "days": [6],
                "frequency": "weekly",
                "time_utc": "02:30",
                "timezone": "America/Los_Angeles",
            }
        ]
        once = self._migrate(rows)
        twice = self._migrate(once)
        assert once == twice

    def test_custom_dates_are_left_alone(self):
        """Explicit dates are the GM's local dates; only the clock is repaired."""
        (out,) = self._migrate(
            [
                {
                    "days": [],
                    "frequency": "custom",
                    "custom_dates": ["2026-08-23", "2026-08-30"],
                    "time_utc": "02:30",
                    "timezone": "America/Los_Angeles",
                }
            ]
        )
        assert out["custom_dates"] == ["2026-08-23", "2026-08-30"]
        assert out["time_local"] == "19:30"

    def test_unknown_zone_is_tolerated(self):
        """A zone missing from this host's tz database must not abort startup."""
        (out,) = self._migrate(
            [
                {
                    "days": [1],
                    "frequency": "weekly",
                    "time_utc": "18:00",
                    "timezone": "Mars/Olympus_Mons",
                }
            ]
        )
        assert out["time_local"] == "18:00"
        assert out["time_model"] == "local"


class TestStaleBundleRepair:
    """A cached old frontend can write an already-UTC clock into `time_local`.

    That is the worst shape to land in: the marker says "local", so the migration
    skips the row, and the new UI no longer converts for display — so the wrong
    time shows *and* publishes with nothing to reveal the error.
    """

    def test_write_path_rejects_a_utc_clock_labelled_local(
        self, client, gm_headers, gm_campaign
    ):
        """Both fields carrying the same non-local value means it is really UTC."""
        r = client.put(
            f"/api/campaigns/{gm_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_local": "02:30",
                "time_utc": "02:30",
                "timezone": "America/Los_Angeles",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["definition"]["time_local"] == "19:30"

    def test_write_path_keeps_a_genuine_local_time_that_matches(
        self, client, gm_headers, gm_campaign
    ):
        """A time whose local and UTC readings coincide must not be re-converted."""
        r = client.put(
            f"/api/campaigns/{gm_campaign['id']}/schedule",
            json={
                "frequency": "weekly",
                "days": [6],
                "time_local": "18:00",
                "time_utc": "18:00",
                "timezone": "UTC",
                "enabled": True,
            },
            headers=gm_headers,
        )
        assert r.status_code == 200, r.text
        assert r.json()["definition"]["time_local"] == "18:00"

    def test_migration_repairs_a_stale_local_row(self):
        """The already-marked row is repaired, not skipped."""
        import json
        import sqlite3
        import tempfile

        from sqlalchemy import create_engine, text

        from backend.models.db import _migrate_schedule_times_to_local

        stored = {
            "days": [6],
            "frequency": "weekly",
            "time_local": "02:30",
            "time_utc": "02:30",
            "timezone": "America/Los_Angeles",
            "time_model": "local",
        }
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            path = f.name
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE campaign_schedules (id TEXT PRIMARY KEY, definition JSON)")
        c.execute("INSERT INTO campaign_schedules VALUES ('1', ?)", (json.dumps(stored),))
        c.commit()
        c.close()

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            _migrate_schedule_times_to_local(conn)
        with engine.connect() as conn:
            out = json.loads(
                conn.execute(text("SELECT definition FROM campaign_schedules")).fetchone()[0]
            )
        engine.dispose()
        assert out["time_local"] == "19:30"
        assert "time_utc" not in out

    def test_migration_leaves_a_genuine_local_row_alone(self):
        """A properly saved local row has no `time_utc` and must not be touched."""
        import json
        import sqlite3
        import tempfile

        from sqlalchemy import create_engine, text

        from backend.models.db import _migrate_schedule_times_to_local

        stored = {
            "days": [6],
            "frequency": "weekly",
            "time_local": "19:30",
            "timezone": "America/Los_Angeles",
            "time_model": "local",
        }
        with tempfile.NamedTemporaryFile(suffix=".db", delete=False) as f:
            path = f.name
        c = sqlite3.connect(path)
        c.execute("CREATE TABLE campaign_schedules (id TEXT PRIMARY KEY, definition JSON)")
        c.execute("INSERT INTO campaign_schedules VALUES ('1', ?)", (json.dumps(stored),))
        c.commit()
        c.close()

        engine = create_engine(f"sqlite:///{path}")
        with engine.connect() as conn:
            _migrate_schedule_times_to_local(conn)
        with engine.connect() as conn:
            out = json.loads(
                conn.execute(text("SELECT definition FROM campaign_schedules")).fetchone()[0]
            )
        engine.dispose()
        assert out["time_local"] == "19:30"
