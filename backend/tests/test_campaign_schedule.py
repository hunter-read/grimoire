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
