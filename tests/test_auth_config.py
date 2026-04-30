"""Tests for the public auth-config endpoint, login enforcement, and the
custom-login-message HTML sanitizer."""
import pytest

from backend.routers.settings._helpers import sanitize_login_message


# ---------------------------------------------------------------------------
# /api/auth/config
# ---------------------------------------------------------------------------


class TestAuthConfig:
    def test_returns_defaults(self, client, admin_setup):
        resp = client.get("/api/auth/config")
        assert resp.status_code == 200
        body = resp.json()
        assert body["password_auth_enabled"] is True
        assert body["custom_login_message_enabled"] is False
        assert body["custom_login_message"] == ""

    def test_no_auth_required(self, client, admin_setup):
        # Endpoint must be reachable without a token (login screen needs it)
        resp = client.get("/api/auth/config")
        assert resp.status_code == 200

    def test_message_only_returned_when_enabled(self, client, admin_headers):
        # Set a message but leave the toggle off
        client.patch(
            "/api/settings",
            json={"custom_login_message": "<b>hello</b>"},
            headers=admin_headers,
        )
        resp = client.get("/api/auth/config")
        body = resp.json()
        assert body["custom_login_message_enabled"] is False
        assert body["custom_login_message"] == ""

        # Now enable
        client.patch(
            "/api/settings",
            json={"custom_login_message_enabled": True},
            headers=admin_headers,
        )
        resp = client.get("/api/auth/config")
        body = resp.json()
        assert body["custom_login_message_enabled"] is True
        assert "<b>hello</b>" in body["custom_login_message"]

        # Cleanup so we don't bleed state into other tests
        client.patch(
            "/api/settings",
            json={"custom_login_message_enabled": False, "custom_login_message": ""},
            headers=admin_headers,
        )


# ---------------------------------------------------------------------------
# /api/auth/login enforcement
# ---------------------------------------------------------------------------


class TestPasswordAuthDisabled:
    def test_login_blocked_when_disabled(self, client, admin_headers):
        # Disable password auth
        resp = client.patch(
            "/api/settings",
            json={"password_auth_enabled": False},
            headers=admin_headers,
        )
        assert resp.status_code == 200
        try:
            resp = client.post(
                "/api/auth/login",
                json={"username": "admin", "password": "adminpass123"},
            )
            assert resp.status_code == 403
            assert "disabled" in resp.json()["detail"].lower()
        finally:
            # Re-enable so other tests still work
            client.patch(
                "/api/settings",
                json={"password_auth_enabled": True},
                headers=admin_headers,
            )


# ---------------------------------------------------------------------------
# Settings env-lock behaviour
# ---------------------------------------------------------------------------


class TestEnvLock:
    def test_env_locked_flag_default_false(self, client, admin_headers):
        resp = client.get("/api/settings", headers=admin_headers)
        assert resp.status_code == 200
        # No env var set during tests, so lock should be off
        assert resp.json()["password_auth_env_locked"] is False

    def test_env_lock_blocks_patch(self, client, admin_headers, monkeypatch):
        # Patch the module-level constant to simulate the env override
        import backend.routers.settings.core as core
        import backend.routers.settings._helpers as helpers
        monkeypatch.setattr(core, "ALLOW_PASSWORD_AUTHENTICATION_ENV", True)
        monkeypatch.setattr(helpers, "ALLOW_PASSWORD_AUTHENTICATION_ENV", True)

        resp = client.patch(
            "/api/settings",
            json={"password_auth_enabled": False},
            headers=admin_headers,
        )
        assert resp.status_code == 400
        assert "ALLOW_PASSWORD_AUTHENTICATION" in resp.json()["detail"]

        # And /api/settings reports the lock
        resp = client.get("/api/settings", headers=admin_headers)
        body = resp.json()
        assert body["password_auth_env_locked"] is True
        assert body["password_auth_enabled"] is True


# ---------------------------------------------------------------------------
# HTML sanitizer
# ---------------------------------------------------------------------------


class TestSanitizeLoginMessage:
    def test_empty(self):
        assert sanitize_login_message("") == ""
        assert sanitize_login_message(None) == ""  # type: ignore[arg-type]

    def test_keeps_allowed_tags(self):
        html = "<b>bold</b> <i>italic</i> <s>strike</s> <p>para</p>"
        out = sanitize_login_message(html)
        assert "<b>bold</b>" in out
        assert "<i>italic</i>" in out
        assert "<s>strike</s>" in out
        assert "<p>para</p>" in out

    def test_keeps_lists(self):
        html = "<ul><li>a</li><li>b</li></ul><ol><li>1</li></ol>"
        out = sanitize_login_message(html)
        assert "<ul>" in out and "<li>a</li>" in out and "</ul>" in out
        assert "<ol>" in out and "<li>1</li>" in out

    def test_strips_script_tag_and_contents(self):
        html = "<b>ok</b><script>alert(1)</script>after"
        out = sanitize_login_message(html)
        assert "<script" not in out
        assert "alert(1)" not in out
        assert "<b>ok</b>" in out
        assert "after" in out

    def test_strips_style_tag(self):
        html = "<style>body{}</style><b>ok</b>"
        out = sanitize_login_message(html)
        assert "<style" not in out
        assert "body{}" not in out

    def test_drops_disallowed_tags_but_keeps_text(self):
        # <span> is not in the allowlist; tag is dropped, text kept
        html = "<span>hello</span>"
        out = sanitize_login_message(html)
        assert "<span" not in out
        assert "hello" in out

    def test_strips_event_handlers(self):
        html = '<b onclick="x()">x</b>'
        out = sanitize_login_message(html)
        assert "onclick" not in out
        assert "<b>x</b>" in out

    def test_rejects_javascript_href(self):
        html = '<a href="javascript:alert(1)">bad</a>'
        out = sanitize_login_message(html)
        assert "javascript:" not in out
        # The <a> tag remains, but without an href
        assert "href=" not in out

    def test_keeps_safe_link_and_adds_rel(self):
        html = '<a href="https://example.com">link</a>'
        out = sanitize_login_message(html)
        assert 'href="https://example.com"' in out
        assert "noopener" in out
        assert 'target="_blank"' in out

    def test_relative_link_allowed(self):
        html = '<a href="/help">help</a>'
        out = sanitize_login_message(html)
        assert 'href="/help"' in out

    def test_mailto_allowed(self):
        html = '<a href="mailto:a@b.co">mail</a>'
        out = sanitize_login_message(html)
        assert "mailto:a@b.co" in out
