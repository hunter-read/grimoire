"""Rules for new passwords (backend/passwords.py)."""
import pytest

from backend import passwords
from backend.auth import hash_password


class TestRules:
    def test_length(self):
        assert passwords.problem("a" * 11 + "Z", minimum=12) is None
        assert "at least 12" in passwords.problem("short-pw", minimum=12)

    @pytest.mark.parametrize("common", ["password123", "Password1234", "qwertyuiop123", "iloveyou"])
    def test_common_passwords_are_refused_at_any_length(self, common):
        assert "common" in passwords.problem(common, minimum=1)

    def test_an_uncommon_passphrase_is_fine(self):
        assert passwords.problem("lantern harbor crossing", minimum=12) is None

    def test_relaxed_minimum_is_logged(self, monkeypatch, caplog):
        monkeypatch.setattr(passwords, "PASSWORD_MIN_LENGTH", 6)
        with caplog.at_level("WARNING", logger="grimoire.passwords"):
            passwords.warn_if_relaxed()
        assert "PASSWORD_MIN_LENGTH" in caplog.text


class TestEndpoints:
    def test_status_reports_the_minimums(self, client):
        body = client.get("/api/auth/status").json()
        assert body["password_min_length"] == passwords.PASSWORD_MIN_LENGTH
        assert body["share_link_password_min_length"] == passwords.SHARE_LINK_PASSWORD_MIN_LENGTH

    def test_new_account_password_follows_the_rules(self, client, admin_headers):
        for weak in ("eleven-char", "password123"):
            r = client.post(
                "/api/users",
                json={"username": "rules-check", "password": weak, "role": "player"},
                headers=admin_headers,
            )
            assert r.status_code == 422, weak

    def test_existing_passwords_still_sign_in(self, client):
        """Rules apply when a password is set; one set earlier keeps working."""
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        user = User(username="older-rules", hashed_password=hash_password("oldpw123"), role="player")
        db.add(user)
        db.commit()
        try:
            r = client.post("/api/auth/login", json={"username": "older-rules", "password": "oldpw123"})
            assert r.status_code == 200
        finally:
            from backend.sessions import delete_user_sessions

            delete_user_sessions(db, user.id)
            db.delete(user)
            db.commit()
            db.close()
