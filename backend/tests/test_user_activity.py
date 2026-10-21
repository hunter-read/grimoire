"""Last sign-in / last activity and per-user log lines (issue #576)."""
import datetime
import logging
import uuid

from fastapi import Depends, FastAPI, WebSocket
from fastapi.testclient import TestClient

from backend import config
from backend.auth import CurrentUser, create_token, get_current_user
from backend.config import SessionLocal
from backend.log_context import LogUserMiddleware, current_log_user, set_log_user
from backend.models import User
from backend.services import user_activity
from backend.services.user_activity import ACTIVITY_THROTTLE


def _new_user(client, admin_headers, role="player"):
    """Create an account and return (username, password, id)."""
    username = f"act-{uuid.uuid4().hex[:8]}"
    password = "activitypass123"
    resp = client.post(
        "/api/users",
        json={"username": username, "password": password, "role": role},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return username, password, resp.json()["id"]


def _row(user_id):
    db = SessionLocal()
    try:
        return db.query(User).filter_by(id=user_id).one()
    finally:
        db.close()


def _set_times(user_id, **values):
    db = SessionLocal()
    try:
        db.query(User).filter_by(id=user_id).update(values)
        db.commit()
    finally:
        db.close()


def _listed(client, admin_headers, user_id):
    users = client.get("/api/users", headers=admin_headers).json()
    return next(u for u in users if u["id"] == user_id)


class TestLastActivity:
    def test_new_account_has_never_signed_in(self, client, admin_headers):
        _, _, user_id = _new_user(client, admin_headers)
        listed = _listed(client, admin_headers, user_id)
        assert listed["last_login_at"] is None
        assert listed["last_active_at"] is None

    def test_sign_in_stamps_both(self, client, admin_headers):
        username, password, user_id = _new_user(client, admin_headers)
        resp = client.post("/api/auth/login", json={"username": username, "password": password})
        assert resp.status_code == 200
        listed = _listed(client, admin_headers, user_id)
        assert listed["last_login_at"] is not None
        assert listed["last_active_at"] == listed["last_login_at"]

    def test_refresh_moves_last_active_but_not_last_login(self, client, admin_headers):
        username, password, user_id = _new_user(client, admin_headers)
        client.post("/api/auth/login", json={"username": username, "password": password})
        long_ago = datetime.datetime(2026, 1, 1)
        _set_times(user_id, last_login_at=long_ago, last_active_at=long_ago)

        assert client.post("/api/auth/refresh").status_code == 200
        row = _row(user_id)
        assert row.last_login_at == long_ago
        assert row.last_active_at > long_ago

    def test_refresh_within_the_throttle_does_not_write(self, client, admin_headers):
        username, password, user_id = _new_user(client, admin_headers)
        client.post("/api/auth/login", json={"username": username, "password": password})
        recent = user_activity._utcnow() - datetime.timedelta(minutes=1)
        _set_times(user_id, last_active_at=recent)

        assert client.post("/api/auth/refresh").status_code == 200
        assert _row(user_id).last_active_at == recent

    def test_api_key_use_counts_as_activity(self, client, admin_headers, admin_id):
        resp = client.post(
            "/api/api-keys",
            json={"name": f"act-{uuid.uuid4().hex[:6]}", "permissions": {"stats": "read"}},
            headers=admin_headers,
        )
        assert resp.status_code == 201, resp.text
        key = resp.json()["key"]
        _set_times(admin_id, last_active_at=None)

        assert client.get("/api/stats", headers={"X-API-Key": key}).status_code == 200
        assert _row(admin_id).last_active_at is not None


class TestRecordActivity:
    def test_throttle_boundary(self, client, admin_headers):
        _, _, user_id = _new_user(client, admin_headers)
        now = datetime.datetime(2026, 6, 1, 12, 0)
        db = SessionLocal()
        try:
            user_activity.record_activity(db, user_id, now)
            db.commit()
            # Within the window: untouched.
            user_activity.record_activity(db, user_id, now + ACTIVITY_THROTTLE / 2)
            db.commit()
            assert _row(user_id).last_active_at == now
            # At the window's edge: written.
            later = now + ACTIVITY_THROTTLE
            user_activity.record_activity(db, user_id, later)
            db.commit()
            assert _row(user_id).last_active_at == later
        finally:
            db.close()


class TestLogAttribution:
    def test_sign_in_is_logged_under_the_user(self, client, admin_headers):
        username, password, _ = _new_user(client, admin_headers)
        client.post("/api/auth/login", json={"username": username, "password": password})

        body = client.get(f"/api/logs?user={username}", headers=admin_headers).json()
        assert body["user"] == username
        assert username in body["users"]
        assert body["total"] == len(body["entries"]) >= 1
        assert all(e["user"] == username for e in body["entries"])
        assert any(e["message"] == "Signed in (password)" for e in body["entries"])

    def test_unknown_user_filter_returns_nothing(self, client, admin_headers):
        body = client.get("/api/logs?user=nobody-at-all", headers=admin_headers).json()
        assert body["entries"] == []
        assert body["total"] == 0

    def test_lines_outside_a_request_have_no_user(self):
        set_log_user("someone")  # no request slot: ignored
        assert current_log_user() is None
        logging.getLogger("grimoire.test").warning("background line %s", uuid.uuid4().hex)
        entries, _ = config._memory_handler.get_entries(limit=1)
        assert entries[-1]["user"] is None

    def test_handler_lines_carry_the_authenticated_user(self):
        """The user set by a sync auth dependency (run in a worker thread) still
        reaches lines the handler logs afterwards."""
        app = FastAPI()
        app.add_middleware(LogUserMiddleware)
        marker = uuid.uuid4().hex

        @app.get("/probe")
        def probe(user: CurrentUser = Depends(get_current_user)):
            logging.getLogger("grimoire.test").info("probe %s", marker)
            return {"seen": current_log_user()}

        token = create_token("probe-id", "probe-user", "player")
        with TestClient(app) as c:
            resp = c.get("/probe", headers={"Authorization": f"Bearer {token}"})
        assert resp.json() == {"seen": "probe-user"}
        entries, _ = config._memory_handler.get_entries(user="probe-user")
        assert any(e["message"] == f"probe {marker}" for e in entries)
        assert "probe-user" in config._memory_handler.get_users()

    def test_websocket_scope_passes_through(self):
        app = FastAPI()
        app.add_middleware(LogUserMiddleware)

        @app.websocket("/ws")
        async def ws(websocket: WebSocket):
            await websocket.accept()
            await websocket.send_json({"seen": current_log_user()})
            await websocket.close()

        with TestClient(app) as c, c.websocket_connect("/ws") as sock:
            assert sock.receive_json() == {"seen": None}
