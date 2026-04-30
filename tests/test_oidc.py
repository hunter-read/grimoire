"""Tests for OIDC settings, helpers, discovery endpoint, and user resolution."""
import pytest
from unittest.mock import patch, MagicMock

import httpx

from backend.routers.oidc import (
    _role_from_groups,
    _permissions_from_claim,
    _resolve_user,
    _OIDCError,
)
from backend.routers.settings._helpers import (
    oidc_effective,
    oidc_is_configured,
    oidc_redirect_uri,
)


# ---------------------------------------------------------------------------
# Settings GET/PATCH
# ---------------------------------------------------------------------------


class TestOIDCSettings:
    def test_get_returns_oidc_defaults(self, client, admin_headers):
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_enabled"] is False
        assert body["oidc_match_by"] == "none"
        assert body["oidc_signing_alg"] == "RS256"
        assert body["oidc_button_text"] == "Sign in with SSO"
        assert body["oidc_client_secret_set"] is False
        assert body["oidc_client_secret_length"] == 0
        # Redirect URI is always exposed
        assert body["oidc_redirect_uri"].endswith("/api/auth/openid/callback")

    def test_patch_oidc_string_fields(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_issuer_url": "https://idp.example.com/realm",
                "oidc_client_id": "grimoire",
                "oidc_groups_claim": "groups",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["oidc_issuer_url"] == "https://idp.example.com/realm"
        assert body["oidc_client_id"] == "grimoire"
        assert body["oidc_groups_claim"] == "groups"
        # Cleanup
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_issuer_url": "", "oidc_client_id": "", "oidc_groups_claim": ""},
        )

    def test_match_by_validation(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_match_by": "bogus"},
        )
        assert resp.status_code == 400
        assert "match_by" in resp.json()["detail"].lower()

    def test_signing_alg_validation(self, client, admin_headers):
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_signing_alg": "MD5"},
        )
        assert resp.status_code == 400

    def test_client_secret_set_clear_mask(self, client, admin_headers):
        # Set
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_client_secret": "super-secret-value"},
        )
        body = resp.json()
        assert body["oidc_client_secret_set"] is True
        assert body["oidc_client_secret_length"] == len("super-secret-value")
        # GET never returns the actual value
        assert "oidc_client_secret" not in body or body.get("oidc_client_secret") in ("", None)

        # Empty string is a no-op (form re-submit)
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_client_secret": ""},
        )
        body = resp.json()
        assert body["oidc_client_secret_set"] is True

        # Sentinel clears it
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_client_secret": "__CLEAR__"},
        )
        body = resp.json()
        assert body["oidc_client_secret_set"] is False
        assert body["oidc_client_secret_length"] == 0

    def test_env_lock_blocks_individual_fields(self, client, admin_headers, monkeypatch):
        import backend.routers.settings.core as core
        import backend.routers.settings._helpers as helpers
        # Pin only the issuer URL via env
        env = dict(core.OIDC_ENV)
        env["oidc_issuer_url"] = "https://locked.example.com"
        monkeypatch.setattr(core, "OIDC_ENV", env)
        monkeypatch.setattr(helpers, "OIDC_ENV", env)

        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_issuer_url": "https://other.example.com"},
        )
        assert resp.status_code == 400
        assert "environment variable" in resp.json()["detail"].lower()

        # GET reflects the lock and the env value
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_issuer_url"] == "https://locked.example.com"
        assert body["oidc_issuer_url_env_locked"] is True

        # Other fields still patchable
        resp = client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_button_text": "Login"},
        )
        assert resp.status_code == 200
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_button_text": "Sign in with SSO"},
        )


# ---------------------------------------------------------------------------
# Discovery
# ---------------------------------------------------------------------------


class TestDiscovery:
    def test_discover_requires_admin(self, client, gm_headers):
        resp = client.post(
            "/api/auth/openid/discover",
            headers=gm_headers,
            json={"issuer_url": "https://idp.example.com"},
        )
        assert resp.status_code == 403

    def test_discover_validates_issuer(self, client, admin_headers):
        resp = client.post(
            "/api/auth/openid/discover",
            headers=admin_headers,
            json={"issuer_url": "ftp://nope"},
        )
        assert resp.status_code == 400

        resp = client.post(
            "/api/auth/openid/discover",
            headers=admin_headers,
            json={"issuer_url": ""},
        )
        assert resp.status_code == 400

    def test_discover_fetches_and_returns_subset(self, client, admin_headers):
        fake_doc = {
            "issuer": "https://idp.example.com/realm",
            "authorization_endpoint": "https://idp.example.com/realm/auth",
            "token_endpoint": "https://idp.example.com/realm/token",
            "userinfo_endpoint": "https://idp.example.com/realm/userinfo",
            "jwks_uri": "https://idp.example.com/realm/jwks",
            "end_session_endpoint": "https://idp.example.com/realm/logout",
            "id_token_signing_alg_values_supported": ["RS256", "ES256"],
            "extra": "not-returned",
        }

        class FakeResp:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return fake_doc

        with patch("backend.routers.oidc.httpx.get", return_value=FakeResp()):
            resp = client.post(
                "/api/auth/openid/discover",
                headers=admin_headers,
                json={"issuer_url": "https://idp.example.com/realm"},
            )
        assert resp.status_code == 200
        body = resp.json()
        assert body["authorization_endpoint"] == fake_doc["authorization_endpoint"]
        assert body["jwks_uri"] == fake_doc["jwks_uri"]
        assert "extra" not in body

    def test_discover_handles_idp_failure(self, client, admin_headers):
        with patch(
            "backend.routers.oidc.httpx.get",
            side_effect=httpx.ConnectError("nope"),
        ):
            resp = client.post(
                "/api/auth/openid/discover",
                headers=admin_headers,
                json={"issuer_url": "https://idp.example.com"},
            )
        assert resp.status_code == 502


# ---------------------------------------------------------------------------
# /api/auth/config exposes OIDC button when configured
# ---------------------------------------------------------------------------


class TestAuthConfigOIDC:
    def test_oidc_hidden_when_not_configured(self, client):
        resp = client.get("/api/auth/config")
        body = resp.json()
        assert body["oidc_enabled"] is False
        assert body["oidc_button_text"] == ""

    def test_oidc_only_exposed_when_fully_configured(self, client, admin_headers):
        # Enable but missing required fields → not exposed
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={"oidc_enabled": True},
        )
        body = client.get("/api/auth/config").json()
        assert body["oidc_enabled"] is False  # no issuer / client / secret

        # Now provide the required fields
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_issuer_url": "https://idp.example.com/realm",
                "oidc_client_id": "grimoire",
                "oidc_client_secret": "abc123",
                "oidc_button_text": "Sign in with Test IdP",
            },
        )
        body = client.get("/api/auth/config").json()
        assert body["oidc_enabled"] is True
        assert body["oidc_button_text"] == "Sign in with Test IdP"

        # Cleanup
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_enabled": False,
                "oidc_issuer_url": "",
                "oidc_client_id": "",
                "oidc_client_secret": "__CLEAR__",
                "oidc_button_text": "Sign in with SSO",
            },
        )


# ---------------------------------------------------------------------------
# Login start endpoint
# ---------------------------------------------------------------------------


class TestOIDCLoginStart:
    def test_login_503_when_not_configured(self, client):
        resp = client.get("/api/auth/openid/login", follow_redirects=False)
        assert resp.status_code == 503

    def test_login_redirects_when_configured(self, client, admin_headers):
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_enabled": True,
                "oidc_issuer_url": "https://idp.example.com/realm",
                "oidc_authorization_endpoint": "https://idp.example.com/realm/auth",
                "oidc_token_endpoint": "https://idp.example.com/realm/token",
                "oidc_jwks_uri": "https://idp.example.com/realm/jwks",
                "oidc_client_id": "grimoire",
                "oidc_client_secret": "secret",
            },
        )
        resp = client.get("/api/auth/openid/login", follow_redirects=False)
        assert resp.status_code == 302
        loc = resp.headers["location"]
        assert loc.startswith("https://idp.example.com/realm/auth?")
        assert "client_id=grimoire" in loc
        assert "code_challenge=" in loc
        assert "code_challenge_method=S256" in loc
        assert "scope=openid+email+profile" in loc
        assert "state=" in loc
        assert "nonce=" in loc

        # Cleanup
        client.patch(
            "/api/settings",
            headers=admin_headers,
            json={
                "oidc_enabled": False,
                "oidc_issuer_url": "",
                "oidc_authorization_endpoint": "",
                "oidc_token_endpoint": "",
                "oidc_jwks_uri": "",
                "oidc_client_id": "",
                "oidc_client_secret": "__CLEAR__",
            },
        )


# ---------------------------------------------------------------------------
# Pure-function helpers
# ---------------------------------------------------------------------------


class TestRoleFromGroups:
    def test_no_claim_returns_none(self):
        assert _role_from_groups({}, "") is None
        assert _role_from_groups({"groups": ["admin"]}, "") is None

    def test_missing_groups_returns_none(self):
        assert _role_from_groups({}, "groups") is None

    def test_admin_wins_over_gm_and_player(self):
        claims = {"groups": ["player", "admin", "gm"]}
        assert _role_from_groups(claims, "groups") == "admin"

    def test_gm_wins_over_player(self):
        claims = {"groups": ["player", "gm"]}
        assert _role_from_groups(claims, "groups") == "gm"

    def test_case_insensitive(self):
        claims = {"groups": ["Admin"]}
        assert _role_from_groups(claims, "groups") == "admin"

    def test_path_and_dash_prefixed_names(self):
        # Keycloak-style /admin and Authentik-style grimoire-admin
        assert _role_from_groups({"groups": ["/admin"]}, "groups") == "admin"
        assert _role_from_groups({"groups": ["grimoire-gm"]}, "groups") == "gm"

    def test_string_groups_claim(self):
        # Some IdPs return a comma-separated string
        assert _role_from_groups({"groups": "player,gm"}, "groups") == "gm"

    def test_no_match_returns_none(self):
        assert _role_from_groups({"groups": ["other-group"]}, "groups") is None


class TestPermissionsFromClaim:
    def test_unconfigured_returns_none(self):
        assert _permissions_from_claim({}, "") is None

    def test_missing_returns_none(self):
        assert _permissions_from_claim({}, "perms") is None

    def test_present(self):
        assert _permissions_from_claim({"perms": {"viewNSFW": True}}, "perms") == {
            "viewNSFW": True
        }

    def test_wrong_type_returns_none(self):
        assert _permissions_from_claim({"perms": "not-a-dict"}, "perms") is None


# ---------------------------------------------------------------------------
# User resolution / auto-register
# ---------------------------------------------------------------------------


class TestResolveUser:
    """These tests exercise the resolution logic directly against the test DB."""

    def _eff(self, **overrides):
        # Minimal effective config for resolution
        eff = {
            "oidc_match_by": "none",
            "oidc_groups_claim": "",
            "oidc_permissions_claim": "",
            "oidc_auto_register": False,
        }
        eff.update(overrides)
        return eff

    def test_no_match_no_auto_register_denies(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            with pytest.raises(_OIDCError, match="auto-register"):
                _resolve_user(
                    db,
                    {"sub": "new-sub", "email": "new@example.com", "preferred_username": "newone"},
                    self._eff(),
                )
        finally:
            db.close()

    def test_auto_register_creates_user(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {"sub": "auto-register-sub", "email": "Auto@Example.com", "preferred_username": "autoreg"},
                self._eff(oidc_auto_register=True),
            )
            assert user.username == "autoreg"
            assert user.email == "auto@example.com"
            assert user.oidc_subject == "auto-register-sub"
            assert user.role == "player"
            assert user.hashed_password is None
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_match_by_email_links_existing(self, client, admin_headers):
        # Pre-create a local user with a known email
        a = client.post(
            "/api/users",
            headers=admin_headers,
            json={
                "username": "match_by_email_user",
                "password": "password123",
                "email": "match@example.com",
            },
        ).json()

        from backend.config import SessionLocal
        from backend.models import User
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {"sub": "linked-sub-1", "email": "match@example.com", "preferred_username": "ignored"},
                self._eff(oidc_match_by="email"),
            )
            assert user.id == a["id"]
            assert user.oidc_subject == "linked-sub-1"
            # Subsequent login by sub finds the same user
            user2 = _resolve_user(
                db,
                {"sub": "linked-sub-1", "email": "match@example.com"},
                self._eff(),
            )
            assert user2.id == a["id"]
        finally:
            db.close()
            client.delete(f"/api/users/{a['id']}", headers=admin_headers)

    def test_groups_claim_required_to_match(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            with pytest.raises(_OIDCError, match="no matching group"):
                _resolve_user(
                    db,
                    {"sub": "no-group-sub", "groups": ["random-group"]},
                    self._eff(oidc_groups_claim="groups", oidc_auto_register=True),
                )
        finally:
            db.close()

    def test_groups_claim_assigns_role_on_register(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {
                    "sub": "gm-from-groups-sub",
                    "preferred_username": "gm_from_groups",
                    "groups": ["gm"],
                },
                self._eff(oidc_groups_claim="groups", oidc_auto_register=True),
            )
            assert user.role == "gm"
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_permissions_claim_missing_denies(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            with pytest.raises(_OIDCError, match="permissions claim missing"):
                _resolve_user(
                    db,
                    {"sub": "perm-missing-sub", "preferred_username": "perm_missing"},
                    self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
                )
        finally:
            db.close()

    def test_permissions_claim_applies_view_nsfw(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {
                    "sub": "perm-applied-sub",
                    "preferred_username": "perm_applied",
                    "perms": {"viewNSFW": False},
                },
                self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
            )
            assert user.allow_explicit is False
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_re_login_resyncs_role_from_groups(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User
        db = SessionLocal()
        try:
            # First login: gm
            u1 = _resolve_user(
                db,
                {
                    "sub": "resync-sub",
                    "preferred_username": "resync_user",
                    "groups": ["gm"],
                },
                self._eff(oidc_groups_claim="groups", oidc_auto_register=True),
            )
            assert u1.role == "gm"

            # Second login: claim now says player
            u2 = _resolve_user(
                db,
                {"sub": "resync-sub", "groups": ["player"]},
                self._eff(oidc_groups_claim="groups"),
            )
            assert u2.id == u1.id
            assert u2.role == "player"

            db.delete(u2)
            db.commit()
        finally:
            db.close()
