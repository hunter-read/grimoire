"""Tests for revocable sessions and refresh tokens (issue #157)."""
import datetime

import jwt
import pytest

from backend.auth import ALGORITHM, SECRET_KEY, create_token
from backend.config import SessionLocal
from backend.models import AuthSession, User
from backend.sessions import (
    REFRESH_COOKIE_NAME,
    create_session,
    get_active_session,
    hash_refresh_token,
    list_user_sessions,
    purge_expired_sessions,
    revoke_session,
    revoke_user_sessions,
    rotate_session,
)


@pytest.fixture
def db():
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def _login(client, username="sessionuser", password="sessionpass123"):
    resp = client.post("/api/auth/login", json={"username": username, "password": password})
    assert resp.status_code == 200, resp.text
    return resp


@pytest.fixture(scope="session")
def session_user(client, admin_headers):
    """A dedicated user, so revoking its sessions can't disturb shared fixtures.

    Session-scoped like the other account fixtures: the account is created once
    and each test logs in fresh against it.
    """
    resp = client.post(
        "/api/users",
        json={"username": "sessionuser", "password": "sessionpass123", "role": "player"},
        headers=admin_headers,
    )
    assert resp.status_code == 201, resp.text
    return resp.json()


class TestTokenClaims:
    def test_access_token_carries_jti_iat_and_sid(self):
        token = create_token("user-1", "someone", "player", session_id="sess-1")
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        assert payload["sub"] == "user-1"
        assert payload["sid"] == "sess-1"
        assert payload["jti"]
        assert payload["iat"]

    def test_jti_is_unique_per_token(self):
        first = jwt.decode(create_token("u", "n", "player"), SECRET_KEY, algorithms=[ALGORITHM])
        second = jwt.decode(create_token("u", "n", "player"), SECRET_KEY, algorithms=[ALGORITHM])
        assert first["jti"] != second["jti"]

    def test_sid_omitted_when_no_session(self):
        payload = jwt.decode(create_token("u", "n", "player"), SECRET_KEY, algorithms=[ALGORITHM])
        assert "sid" not in payload

    def test_access_token_is_short_lived(self):
        """The whole point of the change: tokens no longer last 30 days."""
        payload = jwt.decode(
            create_token("u", "n", "player"), SECRET_KEY, algorithms=[ALGORITHM]
        )
        lifetime = payload["exp"] - payload["iat"]
        assert lifetime <= 24 * 60 * 60


class TestLoginIssuesSession:
    def test_login_sets_refresh_cookie(self, client, session_user):
        resp = _login(client)
        assert REFRESH_COOKIE_NAME in resp.cookies

    def test_refresh_token_never_appears_in_the_body(self, client, session_user):
        """The refresh token is cookie-only, so JS can never read it."""
        body = _login(client).json()
        assert set(body.keys()) <= {"token", "user", "campaign_id"}

    def test_login_creates_a_session_row(self, client, session_user, db):
        before = len(list_user_sessions(db, session_user["id"]))
        _login(client)
        assert len(list_user_sessions(db, session_user["id"])) == before + 1

    def test_session_records_the_user_agent(self, client, session_user, db):
        client.post(
            "/api/auth/login",
            json={"username": "sessionuser", "password": "sessionpass123"},
            headers={"User-Agent": "GrimoireTest/1.0"},
        )
        newest = list_user_sessions(db, session_user["id"])[0]
        assert newest.user_agent == "GrimoireTest/1.0"

    def test_access_token_sid_matches_a_real_session(self, client, session_user, db):
        token = _login(client).json()["token"]
        sid = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])["sid"]
        assert db.query(AuthSession).filter_by(id=sid).first() is not None


class TestRefreshEndpoint:
    def test_refresh_returns_a_new_token(self, client, session_user):
        _login(client)
        resp = client.post("/api/auth/refresh")
        assert resp.status_code == 200
        assert resp.json()["token"]
        assert resp.json()["user"]["username"] == "sessionuser"

    def test_refreshed_token_authenticates(self, client, session_user):
        _login(client)
        token = client.post("/api/auth/refresh").json()["token"]
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == "sessionuser"

    def test_refresh_rotates_the_token(self, client, session_user):
        original = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.post("/api/auth/refresh")
        assert client.cookies.get(REFRESH_COOKIE_NAME) != original

    def test_refresh_without_a_cookie_is_401(self, client):
        client.cookies.clear()
        assert client.post("/api/auth/refresh").status_code == 401

    def test_refresh_with_a_garbage_cookie_is_401(self, client):
        client.cookies.clear()
        resp = client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: "not-a-token"})
        assert resp.status_code == 401

    def test_refresh_keeps_working_across_several_rotations(self, client, session_user):
        _login(client)
        for _ in range(3):
            assert client.post("/api/auth/refresh").status_code == 200

    def test_refresh_reflects_a_role_change(self, client, session_user, admin_headers, db):
        """A refresh re-reads the user, so a role change lands without a re-login."""
        _login(client)
        client.patch(
            f"/api/users/{session_user['id']}", json={"role": "gm"}, headers=admin_headers
        )
        # The role change revoked the session, so this refresh must fail — the
        # user has to log in again and pick up the new role there.
        assert client.post("/api/auth/refresh").status_code == 401
        token = _login(client).json()["token"]
        assert jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])["role"] == "gm"
        # Put it back so later tests see the original role.
        client.patch(
            f"/api/users/{session_user['id']}", json={"role": "player"}, headers=admin_headers
        )


class TestRefreshTokenReuse:
    def test_reusing_a_rotated_token_fails(self, client, session_user):
        stolen = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.post("/api/auth/refresh")  # rotates; `stolen` is now spent

        client.cookies.clear()
        resp = client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: stolen})
        assert resp.status_code == 401

    def test_reuse_revokes_the_whole_session(self, client, session_user, db):
        """A replayed token means it leaked — the live token must die too."""
        stolen = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.post("/api/auth/refresh")
        live = client.cookies[REFRESH_COOKIE_NAME]

        client.cookies.clear()
        client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: stolen})

        client.cookies.clear()
        resp = client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: live})
        assert resp.status_code == 401


class TestLogout:
    def test_logout_revokes_the_session(self, client, session_user):
        refresh = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.post("/api/auth/logout")

        client.cookies.clear()
        resp = client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: refresh})
        assert resp.status_code == 401

    def test_logout_without_a_session_still_succeeds(self, client):
        client.cookies.clear()
        assert client.post("/api/auth/logout").status_code == 200

    def test_logout_marks_the_row_revoked(self, client, session_user, db):
        token = _login(client).json()["token"]
        sid = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])["sid"]
        client.post("/api/auth/logout")
        db.expire_all()
        assert db.query(AuthSession).filter_by(id=sid).first().revoked_at is not None


class TestSessionsEndpoints:
    def test_list_returns_the_current_session(self, client, session_user):
        token = _login(client).json()["token"]
        resp = client.get("/api/auth/sessions", headers={"Authorization": f"Bearer {token}"})
        assert resp.status_code == 200
        current = [s for s in resp.json() if s["current"]]
        assert len(current) == 1
        assert current[0]["origin"] == "password"

    def test_list_requires_auth(self, client):
        client.cookies.clear()
        assert client.get("/api/auth/sessions").status_code == 401

    def test_revoke_other_sessions_keeps_the_current_one(self, client, session_user, db):
        _login(client)  # a second device
        _login(client)  # a third
        token = _login(client).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}

        resp = client.delete("/api/auth/sessions/others", headers=headers)
        assert resp.status_code == 200
        assert resp.json()["revoked"] >= 2
        assert resp.json()["kept_current"] is True

        remaining = client.get("/api/auth/sessions", headers=headers).json()
        assert len(remaining) == 1
        assert remaining[0]["current"] is True

    def test_revoke_one_session(self, client, session_user):
        doomed = _login(client).json()["token"]
        doomed_sid = jwt.decode(doomed, SECRET_KEY, algorithms=[ALGORITHM])["sid"]

        keeper = _login(client).json()["token"]
        headers = {"Authorization": f"Bearer {keeper}"}
        resp = client.delete(f"/api/auth/sessions/{doomed_sid}", headers=headers)
        assert resp.status_code == 200

        ids = [s["id"] for s in client.get("/api/auth/sessions", headers=headers).json()]
        assert doomed_sid not in ids

    def test_cannot_revoke_another_users_session(self, client, session_user, admin_headers, db):
        """Session ids are bare UUIDs — the lookup must be scoped to the caller."""
        victim = _login(client).json()["token"]
        victim_sid = jwt.decode(victim, SECRET_KEY, algorithms=[ALGORITHM])["sid"]

        resp = client.delete(f"/api/auth/sessions/{victim_sid}", headers=admin_headers)
        assert resp.status_code == 404
        # And the victim's session still works.
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {victim}"})
        assert me.status_code == 200

    def test_revoke_unknown_session_is_404(self, client, session_user):
        token = _login(client).json()["token"]
        resp = client.delete(
            "/api/auth/sessions/does-not-exist", headers={"Authorization": f"Bearer {token}"}
        )
        assert resp.status_code == 404


class TestAccountChangesRevoke:
    def test_admin_password_reset_revokes_sessions(self, client, session_user, admin_headers):
        refresh = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.patch(
            f"/api/users/{session_user['id']}",
            json={"password": "brandnewpass123"},
            headers=admin_headers,
        )
        client.cookies.clear()
        assert (
            client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: refresh}).status_code
            == 401
        )
        # Restore the original password for the other tests in this module.
        client.patch(
            f"/api/users/{session_user['id']}",
            json={"password": "sessionpass123"},
            headers=admin_headers,
        )

    def test_role_change_revokes_sessions(self, client, session_user, admin_headers):
        refresh = _login(client).cookies[REFRESH_COOKIE_NAME]
        client.patch(
            f"/api/users/{session_user['id']}", json={"role": "gm"}, headers=admin_headers
        )
        client.cookies.clear()
        assert (
            client.post("/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: refresh}).status_code
            == 401
        )
        client.patch(
            f"/api/users/{session_user['id']}", json={"role": "player"}, headers=admin_headers
        )

    def test_unrelated_edit_does_not_revoke(self, client, session_user, admin_headers):
        """Only credential/role changes revoke — an email edit must not log you out."""
        _login(client)
        client.patch(
            f"/api/users/{session_user['id']}",
            json={"email": "session@example.com"},
            headers=admin_headers,
        )
        assert client.post("/api/auth/refresh").status_code == 200

    def test_self_password_change_keeps_current_session(self, client, session_user):
        token = _login(client).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        other_refresh = None

        # A second device, whose session should be the one that dies.
        other_refresh = _login(client).cookies[REFRESH_COOKIE_NAME]

        resp = client.patch(
            "/api/users/me/password",
            json={"current_password": "sessionpass123", "new_password": "changedpass123"},
            headers=headers,
        )
        assert resp.status_code == 200

        # The device that made the change is still authenticated.
        assert client.get("/api/auth/me", headers=headers).status_code == 200
        # The other device is not.
        client.cookies.clear()
        assert (
            client.post(
                "/api/auth/refresh", cookies={REFRESH_COOKIE_NAME: other_refresh}
            ).status_code
            == 401
        )

        # Restore for any later test.
        client.patch(
            "/api/users/me/password",
            json={"current_password": "changedpass123", "new_password": "sessionpass123"},
            headers=headers,
        )

    def test_deleting_a_user_removes_their_sessions(self, client, admin_headers, db):
        created = client.post(
            "/api/users",
            json={"username": "doomeduser", "password": "doomedpass123", "role": "player"},
            headers=admin_headers,
        ).json()
        client.post(
            "/api/auth/login", json={"username": "doomeduser", "password": "doomedpass123"}
        )
        assert list_user_sessions(db, created["id"])

        resp = client.delete(f"/api/users/{created['id']}", headers=admin_headers)
        assert resp.status_code in (200, 204)
        db.expire_all()
        assert db.query(AuthSession).filter_by(user_id=created["id"]).count() == 0


class TestSessionHelpers:
    def test_refresh_token_is_stored_hashed(self, client, session_user, db):
        """A database leak must not hand out usable sessions."""
        raw = _login(client).cookies[REFRESH_COOKIE_NAME]
        assert db.query(AuthSession).filter_by(refresh_token_hash=raw).first() is None
        assert (
            db.query(AuthSession).filter_by(refresh_token_hash=hash_refresh_token(raw)).first()
            is not None
        )

    def test_expired_session_is_not_active(self, db, session_user):
        session, token = create_session(db, session_user["id"])
        session.expires_at = datetime.datetime.utcnow() - datetime.timedelta(seconds=1)
        db.commit()
        assert get_active_session(db, token) is None

    def test_revoked_session_is_not_active(self, db, session_user):
        session, token = create_session(db, session_user["id"])
        revoke_session(db, session)
        assert get_active_session(db, token) is None

    def test_revoke_is_idempotent(self, db, session_user):
        session, _ = create_session(db, session_user["id"])
        revoke_session(db, session)
        first = session.revoked_at
        revoke_session(db, session)
        assert session.revoked_at == first

    def test_rotate_extends_the_idle_window(self, db, session_user):
        session, token = create_session(db, session_user["id"])
        original_expiry = session.expires_at
        session.expires_at = original_expiry - datetime.timedelta(days=5)
        db.commit()

        rotate_session(db, session)
        assert session.expires_at > original_expiry - datetime.timedelta(days=5)

    def test_revoke_user_sessions_counts_only_live_ones(self, db, admin_id):
        create_session(db, admin_id)
        create_session(db, admin_id)
        assert revoke_user_sessions(db, admin_id) >= 2
        assert revoke_user_sessions(db, admin_id) == 0

    def test_purge_removes_long_dead_sessions(self, db, session_user):
        session, _ = create_session(db, session_user["id"])
        session.expires_at = datetime.datetime.utcnow() - datetime.timedelta(days=30)
        db.commit()
        session_id = session.id

        purge_expired_sessions(db)
        assert db.query(AuthSession).filter_by(id=session_id).first() is None

    def test_purge_keeps_recently_revoked_sessions(self, db, session_user):
        """Recent revocations stay so token reuse right after logout is detectable."""
        session, _ = create_session(db, session_user["id"])
        revoke_session(db, session)
        session_id = session.id

        purge_expired_sessions(db)
        assert db.query(AuthSession).filter_by(id=session_id).first() is not None


class TestOIDCSessions:
    def test_oidc_login_creates_a_revocable_session(self, client, db, admin_headers):
        """OIDC logins must be revocable like any other (issue #157 constraint)."""
        user = db.query(User).filter_by(username="admin").first()
        session, token = create_session(db, user.id, origin="oidc")
        assert session.origin == "oidc"
        assert get_active_session(db, token) is not None

        revoke_session(db, session)
        assert get_active_session(db, token) is None
