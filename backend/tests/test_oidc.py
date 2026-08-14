"""Tests for OIDC settings, helpers, discovery endpoint, and user resolution."""
import pytest
from unittest.mock import patch

import httpx
from authlib.jose.errors import JoseError

from backend.routers.oidc import (
    _role_from_groups,
    _permissions_from_claim,
    _resolve_user,
    _OIDCError,
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

    def test_discover_accepts_full_openid_configuration_url(self, client, admin_headers):
        fake_doc = {
            "issuer": "https://auth.example.com/application/o/app",
            "authorization_endpoint": "https://auth.example.com/application/o/app/authorize/",
            "token_endpoint": "https://auth.example.com/application/o/token/",
            "userinfo_endpoint": "https://auth.example.com/application/o/userinfo/",
            "jwks_uri": "https://auth.example.com/application/o/app/jwks/",
        }

        class FakeResp:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return fake_doc

        with patch("backend.routers.oidc.httpx.get", return_value=FakeResp()) as mock_get:
            resp = client.post(
                "/api/auth/openid/discover",
                headers=admin_headers,
                json={
                    "issuer_url": "https://auth.example.com/application/o/app/.well-known/openid-configuration"
                },
            )
        assert resp.status_code == 200
        body = resp.json()
        # The canonical issuer from the discovery doc must be returned so the
        # frontend can save it back as oidc_issuer_url for iss claim validation.
        assert body["issuer"] == fake_doc["issuer"]
        # The URL must not have /.well-known/openid-configuration appended twice
        called_url = mock_get.call_args[0][0]
        assert called_url.count(".well-known/openid-configuration") == 1

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

    def test_discovery_doc_logs_http_failure(self, caplog):
        """A discovery fetch failure returns {} but is logged, not swallowed."""
        from backend.routers.oidc import _helpers

        with patch(
            "backend.routers.oidc._helpers.httpx.get",
            side_effect=httpx.ConnectError("nope"),
        ):
            with caplog.at_level("WARNING", logger="grimoire.oidc"):
                assert _helpers._discovery_doc("https://idp.example.com") == {}
        assert any("discovery fetch failed" in r.message.lower() for r in caplog.records)


# ---------------------------------------------------------------------------
# Low-level helpers: PKCE, state store, JWKS, userinfo, endpoint discovery
# ---------------------------------------------------------------------------


class TestOIDCLowLevelHelpers:
    def test_pkce_pair_is_url_safe_and_deterministic_challenge(self):
        from backend.routers.oidc import _helpers

        verifier, challenge = _helpers._pkce_pair()
        assert verifier and challenge
        # Challenge is the S256 of the verifier, base64url without padding.
        import base64
        import hashlib

        expected = (
            base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest())
            .rstrip(b"=")
            .decode()
        )
        assert challenge == expected
        assert "=" not in challenge

    def test_state_store_put_pop_roundtrip(self):
        from backend.routers.oidc import _state

        store = _state.MemoryStateStore()
        store.put("s1", {"nonce": "n"})
        popped = store.pop("s1")
        assert popped is not None
        assert popped["nonce"] == "n"
        assert "_ts" in popped  # put() stamps a timestamp
        # Popped once → gone.
        assert store.pop("s1") is None

    def test_state_store_expires_old_entries(self):
        from backend.routers.oidc import _state

        store = _state.MemoryStateStore()
        store.put("old", {"nonce": "n"})
        # Force the entry's timestamp past the TTL so _gc drops it.
        store._d["old"]["_ts"] = 0
        assert store.pop("old") is None

    def test_try_endpoint_and_discover_issuer_fall_back(self):
        from backend.routers.oidc import _helpers

        with patch.object(_helpers, "_discovery_doc", return_value={}):
            assert _helpers._try_endpoint("https://idp", "token_endpoint") == ""
            assert _helpers._discover_issuer("https://idp") == "https://idp"

        with patch.object(
            _helpers,
            "_discovery_doc",
            return_value={"issuer": "https://canonical", "token_endpoint": "https://t"},
        ):
            assert _helpers._try_endpoint("https://idp", "token_endpoint") == "https://t"
            assert _helpers._discover_issuer("https://idp") == "https://canonical"

    def test_get_jwks_fetches_and_caches(self):
        from backend.routers.oidc import _helpers, _state

        class FakeResp:
            status_code = 200

            def raise_for_status(self):
                pass

            def json(self):
                return {"keys": [{"kid": "abc"}]}

        with patch.object(_helpers, "_jwks_cache", _state.MemoryJWKSCache()):
            with patch(
                "backend.routers.oidc._helpers.httpx.get", return_value=FakeResp()
            ) as mock_get:
                keys = _helpers._get_jwks("https://idp/jwks")
                assert keys == {"keys": [{"kid": "abc"}]}
                # Second call within TTL is served from cache (no second fetch).
                _helpers._get_jwks("https://idp/jwks")
                assert mock_get.call_count == 1
                # force=True bypasses the cache to pick up rotated keys.
                _helpers._get_jwks("https://idp/jwks", force=True)
                assert mock_get.call_count == 2

    def test_get_jwks_http_error_raises_oidc_error(self):
        from backend.routers.oidc import _helpers, _state

        with patch.object(_helpers, "_jwks_cache", _state.MemoryJWKSCache()):
            with patch(
                "backend.routers.oidc._helpers.httpx.get",
                side_effect=httpx.ConnectError("down"),
            ):
                with pytest.raises(_OIDCError):
                    _helpers._get_jwks("https://idp/jwks")

    def test_validate_id_token_requires_jwks_uri(self):
        from backend.routers.oidc import _helpers

        with pytest.raises(_OIDCError):
            _helpers._validate_id_token(
                "tok",
                issuer="https://idp",
                client_id="c",
                jwks_uri="",
                expected_nonce="n",
                allowed_alg="RS256",
            )

    def test_fetch_userinfo_returns_empty_without_url_or_token(self):
        from backend.routers.oidc import _helpers

        assert _helpers._fetch_userinfo(None, "tok") == {}
        assert _helpers._fetch_userinfo("https://idp/userinfo", None) == {}

    def test_fetch_userinfo_success(self):
        from backend.routers.oidc import _helpers

        class FakeResp:
            def raise_for_status(self):
                pass

            def json(self):
                return {"sub": "abc", "email": "a@b.c"}

        with patch(
            "backend.routers.oidc._helpers.httpx.get", return_value=FakeResp()
        ):
            info = _helpers._fetch_userinfo("https://idp/userinfo", "tok")
        assert info == {"sub": "abc", "email": "a@b.c"}

    def test_fetch_userinfo_http_error_logs_and_returns_empty(self, caplog):
        from backend.routers.oidc import _helpers

        with patch(
            "backend.routers.oidc._helpers.httpx.get",
            side_effect=httpx.ConnectError("down"),
        ):
            with caplog.at_level("WARNING", logger="grimoire.oidc"):
                assert _helpers._fetch_userinfo("https://idp/userinfo", "tok") == {}
        assert any("userinfo fetch failed" in r.message.lower() for r in caplog.records)


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


class TestOIDCCallback:
    """The callback exchanges the code, resolves the user, and hands back a
    token — via the URL fragment AND an HttpOnly session cookie (issue #156)."""

    def _configure(self, client, admin_headers):
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
                "oidc_auto_register": True,
            },
        )

    def _cleanup(self, client, admin_headers):
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
                "oidc_auto_register": False,
            },
        )

    def test_callback_sets_session_cookie_on_success(self, client, admin_headers):
        from backend.routers.oidc import core as oidc_core

        self._configure(client, admin_headers)
        try:
            # Seed the state the login step would have stored.
            oidc_core._state_store.put(
                "state123",
                {"code_verifier": "verifier", "nonce": "nonce123", "return_to": "/"},
            )

            token_resp = httpx.Response(
                200,
                json={"id_token": "id-tok", "access_token": "acc-tok"},
                request=httpx.Request("POST", "https://idp.example.com/realm/token"),
            )
            with (
                patch.object(oidc_core.httpx, "post", return_value=token_resp),
                patch.object(oidc_core, "_discover_issuer", return_value="https://idp.example.com/realm"),
                patch.object(
                    oidc_core,
                    "_validate_id_token",
                    return_value={"sub": "oidc-sub-1", "email": "oidc@example.com"},
                ),
                patch.object(oidc_core, "_fetch_userinfo", return_value={}),
            ):
                resp = client.get(
                    "/api/auth/openid/callback?code=abc&state=state123",
                    follow_redirects=False,
                )

            assert resp.status_code == 302
            # Token still handed to the SPA via the fragment...
            assert "#oidc_token=" in resp.headers["location"]
            # ...and the session cookie is set so media GETs authenticate.
            set_cookie = "".join(
                v for k, v in resp.headers.items() if k.lower() == "set-cookie"
            )
            assert "grimoire_session=" in set_cookie
            assert "httponly" in set_cookie.lower()
        finally:
            self._cleanup(client, admin_headers)

    def test_callback_idp_error_redirects_to_login(self, client):
        resp = client.get(
            "/api/auth/openid/callback?error=access_denied&error_description=nope",
            follow_redirects=False,
        )
        assert resp.status_code == 302
        assert "oidc_error=nope" in resp.headers["location"]

    def test_callback_missing_code_or_state(self, client):
        resp = client.get("/api/auth/openid/callback?code=abc", follow_redirects=False)
        assert resp.status_code == 302
        assert "oidc_error=" in resp.headers["location"]

    def test_callback_invalid_state(self, client):
        resp = client.get(
            "/api/auth/openid/callback?code=abc&state=never-issued",
            follow_redirects=False,
        )
        assert resp.status_code == 302
        assert "invalid" in resp.headers["location"].lower()

    def test_callback_token_exchange_failure(self, client, admin_headers):
        from backend.routers.oidc import core as oidc_core

        self._configure(client, admin_headers)
        try:
            oidc_core._state_store.put(
                "state-fail",
                {"code_verifier": "verifier", "nonce": "n", "return_to": "/"},
            )
            with patch.object(
                oidc_core.httpx, "post", side_effect=httpx.HTTPError("boom")
            ):
                resp = client.get(
                    "/api/auth/openid/callback?code=abc&state=state-fail",
                    follow_redirects=False,
                )
            assert resp.status_code == 302
            assert "token%20exchange%20failed" in resp.headers["location"]
        finally:
            self._cleanup(client, admin_headers)


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

    def test_permissions_claim_applies_campaign_access(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {
                    "sub": "perm-campaign-sub",
                    "preferred_username": "perm_campaign",
                    "perms": {"campaignAccess": False},
                },
                self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
            )
            assert user.campaign_access is False
            # Re-login with the claim flipped back on re-enables access.
            user = _resolve_user(
                db,
                {
                    "sub": "perm-campaign-sub",
                    "preferred_username": "perm_campaign",
                    "perms": {"campaignAccess": True},
                },
                self._eff(oidc_permissions_claim="perms"),
            )
            assert user.campaign_access is True
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_permissions_claim_absent_key_leaves_campaign_access_default(
        self, client, admin_setup
    ):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            # perms present but without campaignAccess → default (enabled) preserved.
            user = _resolve_user(
                db,
                {
                    "sub": "perm-no-campaign-sub",
                    "preferred_username": "perm_no_campaign",
                    "perms": {"viewNSFW": True},
                },
                self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
            )
            assert user.campaign_access is None or user.campaign_access is True
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_re_login_resyncs_role_from_groups(self, client, admin_setup):
        from backend.config import SessionLocal
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


# ---------------------------------------------------------------------------
# ID token validation
# ---------------------------------------------------------------------------


class FakeClaims(dict):
    """Stand-in for an authlib claims object (a dict plus header/validate)."""

    def __init__(self, data, header=None, validate_error=None):
        super().__init__(data)
        self.header = header if header is not None else {"alg": "RS256"}
        self._validate_error = validate_error

    def validate(self, leeway=0):
        if self._validate_error:
            raise self._validate_error


class TestValidateIdToken:
    """_validate_id_token with the JOSE decode faked out — no real signing keys."""

    JWKS = {"keys": [{"kid": "abc"}]}

    def _patch(self, decode):
        from backend.routers.oidc import _helpers

        return (
            patch.object(_helpers, "_get_jwks", return_value=self.JWKS),
            patch.object(_helpers.joseju, "decode", decode),
        )

    def _validate(self, **overrides):
        from backend.routers.oidc import _helpers

        kwargs = {
            "issuer": "https://idp",
            "client_id": "client",
            "jwks_uri": "https://idp/jwks",
            "expected_nonce": "n",
            "allowed_alg": "RS256",
        }
        kwargs.update(overrides)
        return _helpers._validate_id_token("tok", **kwargs)

    def test_returns_claims_on_success(self):
        claims = FakeClaims({"sub": "s", "nonce": "n", "email": "a@b.c"})
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            result = self._validate()
        assert result["sub"] == "s"
        assert result["email"] == "a@b.c"
        assert isinstance(result, dict)

    def test_retries_with_forced_refresh_on_signature_error(self):
        from backend.routers.oidc import _helpers

        claims = FakeClaims({"sub": "s", "nonce": "n"})
        calls = []

        def decode(*a, **k):
            calls.append(1)
            if len(calls) == 1:
                raise JoseError("bad signature")
            return claims

        with patch.object(_helpers, "_get_jwks", return_value=self.JWKS) as mock_jwks:
            with patch.object(_helpers.joseju, "decode", decode):
                assert self._validate()["sub"] == "s"
        # Second JWKS fetch is forced, so rotated keys are picked up.
        assert mock_jwks.call_args_list[-1].kwargs["force"] is True
        assert len(calls) == 2

    def test_raises_when_signature_invalid_after_refresh(self):
        def decode(*a, **k):
            raise JoseError("still bad")

        get_jwks, decode_patch = self._patch(decode)
        with get_jwks, decode_patch:
            with pytest.raises(_OIDCError, match="signature invalid"):
                self._validate()

    def test_raises_when_claims_invalid(self):
        claims = FakeClaims({"nonce": "n"}, validate_error=JoseError("expired"))
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            with pytest.raises(_OIDCError, match="claims invalid"):
                self._validate()

    def test_raises_on_algorithm_mismatch(self):
        claims = FakeClaims({"nonce": "n"}, header={"alg": "HS256"})
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            with pytest.raises(_OIDCError, match="alg HS256"):
                self._validate(allowed_alg="RS256")

    def test_raises_on_nonce_mismatch(self):
        claims = FakeClaims({"nonce": "other"})
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            with pytest.raises(_OIDCError, match="nonce mismatch"):
                self._validate(expected_nonce="n")

    def test_missing_header_does_not_break_alg_check(self):
        claims = FakeClaims({"nonce": "n"}, header=None)
        claims.header = None  # authlib can hand back a falsy header
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            assert self._validate()["nonce"] == "n"


class TestDiscoveryDocEdges:
    def test_blank_issuer_short_circuits(self):
        from backend.routers.oidc import _helpers

        assert _helpers._discovery_doc("") == {}

    def test_full_discovery_url_is_used_verbatim(self):
        from backend.routers.oidc import _helpers

        url = "https://idp/.well-known/openid-configuration"

        class FakeResp:
            status_code = 200

            def json(self):
                return {"issuer": "https://idp"}

        with patch.object(_helpers.httpx, "get", return_value=FakeResp()) as mock_get:
            assert _helpers._discovery_doc(url) == {"issuer": "https://idp"}
        assert mock_get.call_args[0][0] == url

    def test_non_200_returns_empty(self):
        from backend.routers.oidc import _helpers

        class FakeResp:
            status_code = 404

            def json(self):
                return {"issuer": "nope"}

        with patch.object(_helpers.httpx, "get", return_value=FakeResp()):
            assert _helpers._discovery_doc("https://idp") == {}


class TestRoleFromGroupsEdges:
    def test_non_list_non_string_claim_returns_none(self):
        assert _role_from_groups({"groups": 42}, "groups") is None


class TestResolveUserEdges:
    def _eff(self, **overrides):
        eff = {
            "oidc_match_by": "none",
            "oidc_groups_claim": "",
            "oidc_permissions_claim": "",
            "oidc_auto_register": False,
        }
        eff.update(overrides)
        return eff

    def test_missing_sub_is_rejected(self, client, admin_setup):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            with pytest.raises(_OIDCError, match="sub claim"):
                _resolve_user(db, {"sub": "  "}, self._eff())
        finally:
            db.close()

    def test_match_by_username_links_existing_account(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        try:
            existing = User(username="byname", email=None, hashed_password="x", role="player")
            db.add(existing)
            db.commit()

            user = _resolve_user(
                db,
                {"sub": "byname-sub", "preferred_username": "byname"},
                self._eff(oidc_match_by="username"),
            )
            assert user.id == existing.id
            assert user.oidc_subject == "byname-sub"

            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_username_collision_gets_suffixed(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        try:
            taken = User(username="dupe", email=None, hashed_password="x", role="player")
            db.add(taken)
            db.commit()

            user = _resolve_user(
                db,
                {"sub": "collide-sub", "preferred_username": "dupe"},
                self._eff(oidc_auto_register=True),
            )
            assert user.id != taken.id
            assert user.username.startswith("dupe-")

            db.delete(user)
            db.delete(taken)
            db.commit()
        finally:
            db.close()

    def test_email_collision_drops_email_on_register(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        try:
            taken = User(
                username="mailowner", email="shared@example.com", hashed_password="x", role="player"
            )
            db.add(taken)
            db.commit()

            user = _resolve_user(
                db,
                {
                    "sub": "mail-collide-sub",
                    "email": "shared@example.com",
                    "preferred_username": "mailnew",
                },
                self._eff(oidc_auto_register=True),
            )
            # Registration succeeds; the conflicting email is simply dropped.
            assert user.email is None
            assert user.username == "mailnew"

            db.delete(user)
            db.delete(taken)
            db.commit()
        finally:
            db.close()

    def test_email_not_stolen_from_another_user_on_login(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        try:
            owner = User(
                username="owner", email="owned@example.com", hashed_password="x", role="player"
            )
            linked = User(
                username="linked", email=None, oidc_subject="linked-sub",
                hashed_password=None, role="player",
            )
            db.add_all([owner, linked])
            db.commit()

            user = _resolve_user(
                db, {"sub": "linked-sub", "email": "owned@example.com"}, self._eff()
            )
            assert user.id == linked.id
            assert user.email is None  # left alone — the address belongs to `owner`

            db.delete(linked)
            db.delete(owner)
            db.commit()
        finally:
            db.close()

    def test_last_admin_is_not_demoted_by_groups(self, client, admin_setup):
        from backend.config import SessionLocal
        from backend.models import User

        db = SessionLocal()
        try:
            admin = User(
                username="onlyadmin", email=None, oidc_subject="admin-sub",
                hashed_password=None, role="admin",
            )
            db.add(admin)
            db.commit()
            admin_count = db.query(User).filter_by(role="admin").count()

            user = _resolve_user(
                db,
                {"sub": "admin-sub", "groups": ["player"]},
                self._eff(oidc_groups_claim="groups"),
            )
            if admin_count > 1:
                assert user.role == "player"
            else:
                assert user.role == "admin"  # demotion would lock the system

            db.delete(user)
            db.commit()
        finally:
            db.close()
