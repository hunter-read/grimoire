"""Tests for ENABLE_DEMO_MODE behavior.

Demo mode (1) blocks all self-service account actions for non-admin accounts
and (2) deletes every campaign owned by a non-admin account on an hourly
schedule. Admin accounts are unaffected.
"""
import uuid

import pytest
from sqlalchemy import text

from backend import demo
from backend.config import SessionLocal
from backend.models import Bookmark, Campaign
from backend.tests.conftest import make_book, make_campaign, make_game_system


@pytest.fixture
def demo_mode(monkeypatch):
    """Turn on demo mode for the duration of a test."""
    monkeypatch.setattr("backend.routers.users.me.ENABLE_DEMO_MODE", True)
    monkeypatch.setattr("backend.routers.settings.core.ENABLE_DEMO_MODE", True)


# ---------------------------------------------------------------------------
# Account actions blocked for non-admins
# ---------------------------------------------------------------------------


class TestAccountActionsBlocked:
    def test_player_cannot_change_preferences(self, client, player_headers, demo_mode):
        resp = client.patch(
            "/api/users/me/preferences",
            json={"display_name": "Hacker"},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_player_cannot_change_password(self, client, player_headers, demo_mode):
        resp = client.patch(
            "/api/users/me/password",
            json={"current_password": "playerpass123", "new_password": "newpassword123"},
            headers=player_headers,
        )
        assert resp.status_code == 403

    def test_player_cannot_delete_account(self, client, player_headers, demo_mode):
        resp = client.delete("/api/users/me", headers=player_headers)
        assert resp.status_code == 403

    def test_gm_blocked_too(self, client, gm_headers, demo_mode):
        resp = client.patch(
            "/api/users/me/preferences",
            json={"display_name": "Hacker"},
            headers=gm_headers,
        )
        assert resp.status_code == 403


# ---------------------------------------------------------------------------
# Admins are exempt
# ---------------------------------------------------------------------------


class TestAdminExempt:
    def test_admin_can_change_preferences(self, client, admin_headers, demo_mode):
        resp = client.patch(
            "/api/users/me/preferences",
            json={"display_name": "Admin Name"},
            headers=admin_headers,
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# When demo mode is off, actions are allowed
# ---------------------------------------------------------------------------


class TestDemoModeOff:
    def test_player_can_change_preferences(self, client, player_headers):
        resp = client.patch(
            "/api/users/me/preferences",
            json={"display_name": "Real Name"},
            headers=player_headers,
        )
        assert resp.status_code == 200


# ---------------------------------------------------------------------------
# UI settings flag
# ---------------------------------------------------------------------------


class TestUiSettingsFlag:
    def test_demo_mode_reported_when_on(self, client, player_headers, demo_mode):
        resp = client.get("/api/settings/ui", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["demo_mode"] is True

    def test_demo_mode_false_when_off(self, client, player_headers):
        resp = client.get("/api/settings/ui", headers=player_headers)
        assert resp.status_code == 200
        assert resp.json()["demo_mode"] is False


# ---------------------------------------------------------------------------
# Hourly campaign cleanup
# ---------------------------------------------------------------------------


class TestCampaignCleanup:
    def test_deletes_non_admin_campaigns_keeps_admin(self, admin_id, player_id, gm_id):
        player_campaign = make_campaign(player_id)
        gm_campaign = make_campaign(gm_id)
        admin_campaign = make_campaign(admin_id)

        removed = demo.cleanup_demo_data()
        assert removed >= 2

        db = SessionLocal()
        try:
            assert db.query(Campaign).filter_by(id=player_campaign.id).first() is None
            assert db.query(Campaign).filter_by(id=gm_campaign.id).first() is None
            assert db.query(Campaign).filter_by(id=admin_campaign.id).first() is not None
        finally:
            db.close()

    def test_resets_player_bookmarks_keeps_admin(self, admin_id, player_id):
        system = make_game_system()
        book = make_book(system.id)
        db = SessionLocal()
        try:
            db.add(Bookmark(user_id=player_id, book_id=book.id, page_number=1))
            db.add(Bookmark(user_id=admin_id, book_id=book.id, page_number=2))
            db.commit()
        finally:
            db.close()

        demo.cleanup_demo_data()

        db = SessionLocal()
        try:
            assert db.query(Bookmark).filter_by(user_id=player_id).count() == 0
            assert db.query(Bookmark).filter_by(user_id=admin_id).count() >= 1
        finally:
            db.close()

    def test_resets_player_session_notes(self, admin_id, gm_id, player_id):
        # A player note in a GM-owned campaign survives campaign deletion (the
        # campaign isn't deleted) but must still be reset.
        gm_campaign = make_campaign(gm_id)
        db = SessionLocal()
        try:
            session_id = "demo-session-" + uuid.uuid4().hex[:8]
            db.execute(
                text(
                    "INSERT INTO session_notes (id, campaign_id, title, session_date) "
                    "VALUES (:id, :cid, :title, :date)"
                ),
                {
                    "id": session_id,
                    "cid": gm_campaign.id,
                    "title": "Session 1",
                    "date": "2026-01-01",
                },
            )
            note_id = "demo-note-" + uuid.uuid4().hex[:8]
            db.execute(
                text(
                    "INSERT INTO player_session_notes (id, session_id, user_id, content) "
                    "VALUES (:id, :sid, :uid, :content)"
                ),
                {"id": note_id, "sid": session_id, "uid": player_id, "content": "secret"},
            )
            db.commit()
        finally:
            db.close()

        demo.cleanup_demo_data()

        db = SessionLocal()
        try:
            remaining = db.execute(
                text("SELECT COUNT(*) FROM player_session_notes WHERE user_id = :uid"),
                {"uid": player_id},
            ).scalar()
            assert remaining == 0
        finally:
            db.close()
