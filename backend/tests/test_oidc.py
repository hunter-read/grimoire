"""Tests for OIDC settings, helpers, discovery endpoint, and user resolution."""
import json
import pytest
from unittest.mock import MagicMock, patch

import httpx
from authlib.jose.errors import JoseError

from backend.routers.oidc import (
    _role_from_groups,
    _permissions_from_claim,
    _resolve_user,
    _OIDCError,
)
from backend.routers.oidc._helpers import _safe_return_to


@pytest.fixture(autouse=True)
def _fresh_discovery_cache():
    """Each test sees discovery fetch afresh; the cache is tested on its own."""
    from backend.routers.oidc import _helpers

    _helpers._discovery_cache.clear()
    yield
    _helpers._discovery_cache.clear()


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

    def test_role_group_names_default_save_and_reset(self, client, admin_headers):
        body = client.get("/api/settings", headers=admin_headers).json()
        assert (body["oidc_admin_group"], body["oidc_gm_group"], body["oidc_player_group"]) == (
            "admin", "gm", "player"
        )
        assert body["oidc_admin_group_env_locked"] is False
        try:
            resp = client.patch(
                "/api/settings",
                headers=admin_headers,
                json={"oidc_admin_group": "  grimoire-admin ", "oidc_gm_group": "grimoire-gm"},
            )
            assert resp.status_code == 200
            body = resp.json()
            assert body["oidc_admin_group"] == "grimoire-admin"
            assert body["oidc_gm_group"] == "grimoire-gm"
            assert body["oidc_player_group"] == "player"
        finally:
            # A blank name goes back to the default.
            resp = client.patch(
                "/api/settings",
                headers=admin_headers,
                json={"oidc_admin_group": "", "oidc_gm_group": ""},
            )
        assert resp.json()["oidc_admin_group"] == "admin"
        assert resp.json()["oidc_gm_group"] == "gm"

    def test_role_group_names_can_be_pinned_by_env(self, client, admin_headers, monkeypatch):
        import backend.routers.settings._helpers as helpers

        env = dict(helpers.OIDC_ENV)
        env["oidc_admin_group"] = "sso-admins"
        monkeypatch.setattr(helpers, "OIDC_ENV", env)
        resp = client.patch(
            "/api/settings", headers=admin_headers, json={"oidc_admin_group": "other"}
        )
        assert resp.status_code == 400
        body = client.get("/api/settings", headers=admin_headers).json()
        assert body["oidc_admin_group"] == "sso-admins"
        assert body["oidc_admin_group_env_locked"] is True

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

    def test_unsupported_env_signing_alg_is_logged(self, monkeypatch, caplog):
        import backend.routers.settings._helpers as helpers

        monkeypatch.setattr(helpers, "OIDC_ENV", {"oidc_signing_alg": "HS256"})
        with caplog.at_level("WARNING", logger=helpers.logger.name):
            helpers._warn_unsupported_signing_alg_env()
        assert "OIDC_SIGNING_ALG='HS256' is not supported" in caplog.text
        caplog.clear()
        monkeypatch.setattr(helpers, "OIDC_ENV", {"oidc_signing_alg": "ES256"})
        with caplog.at_level("WARNING", logger=helpers.logger.name):
            helpers._warn_unsupported_signing_alg_env()
        assert caplog.text == ""

    def test_hs256_is_no_longer_offered(self, client, admin_headers):
        resp = client.patch(
            "/api/settings", headers=admin_headers, json={"oidc_signing_alg": "HS256"}
        )
        assert resp.status_code == 400
        assert "HS256" not in resp.json()["detail"]

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

    def test_client_secret_is_stored_sealed(self, client, admin_headers):
        from backend import token_vault
        from backend.config import SessionLocal
        from backend.models import AppSetting

        client.patch(
            "/api/settings", headers=admin_headers, json={"oidc_client_secret": "sealed-value-1"}
        )
        try:
            db = SessionLocal()
            try:
                stored = db.query(AppSetting).filter_by(key="oidc_client_secret").one().value
            finally:
                db.close()
            # A backup of the database alone does not carry the secret.
            assert "sealed-value-1" not in stored
            assert token_vault.unseal_secret(stored) == "sealed-value-1"
        finally:
            client.patch(
                "/api/settings", headers=admin_headers, json={"oidc_client_secret": "__CLEAR__"}
            )

    def test_unreadable_secret_counts_as_unset_and_is_logged(self, monkeypatch, caplog):
        from backend import auth, token_vault
        from backend.routers.settings import _helpers

        sealed = token_vault.seal_secret("written-under-the-old-key")
        monkeypatch.setattr(auth, "SECRET_KEY", "a-different-secret-key-" + "k" * 20)
        with caplog.at_level("ERROR", logger="grimoire.oidc"):
            assert _helpers.oidc_effective_client_secret({"oidc_client_secret": sealed}) == ""
            assert _helpers.oidc_effective_client_secret({"oidc_client_secret": sealed}) == ""
        assert sum("cannot be decrypted" in r.message for r in caplog.records) == 1
        assert not _helpers.oidc_is_configured(
            {"oidc_enabled": "true", "oidc_issuer_url": "https://i", "oidc_client_id": "c",
             "oidc_client_secret": sealed}
        )

    def test_env_lock_blocks_individual_fields(self, client, admin_headers, monkeypatch):
        import backend.routers.settings._helpers as helpers
        # Pin only the issuer URL via env
        env = dict(helpers.OIDC_ENV)
        env["oidc_issuer_url"] = "https://locked.example.com"
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

    def test_discover_keeps_fetch_errors_in_the_log(self, client, admin_headers, caplog):
        with patch(
            "backend.routers.oidc.httpx.get",
            side_effect=httpx.ConnectError("connect to 10.0.0.5:8443 refused"),
        ), caplog.at_level("WARNING"):
            resp = client.post(
                "/api/auth/openid/discover",
                headers=admin_headers,
                json={"issuer_url": "https://idp.example.com"},
            )
        assert resp.status_code == 502
        assert "10.0.0.5" not in resp.json()["detail"]
        assert "10.0.0.5" in caplog.text

    def test_discover_rejects_a_non_json_document(self, client, admin_headers, caplog):
        bad = MagicMock()
        bad.raise_for_status.return_value = None
        bad.json.side_effect = json.JSONDecodeError("Expecting value", "<html>", 0)
        with patch("backend.routers.oidc.httpx.get", return_value=bad), caplog.at_level(
            "WARNING"
        ):
            resp = client.post(
                "/api/auth/openid/discover",
                headers=admin_headers,
                json={"issuer_url": "https://idp.example.com"},
            )
        assert resp.status_code == 502
        assert "Expecting value" not in resp.json()["detail"]
        assert "Expecting value" in caplog.text

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


    def test_login_sanitizes_offsite_return_to(self, client, admin_headers):
        """GHSA-79mw-m4jj-qp8f: an off-origin return_to never reaches the state."""
        from urllib.parse import parse_qs, urlsplit

        from backend.routers.oidc import core as oidc_core

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
        try:
            for evil, expected in (
                ("//attacker.example/collect", "/"),
                ("/library?x=1", "/library?x=1"),
            ):
                resp = client.get(
                    "/api/auth/openid/login",
                    params={"return_to": evil},
                    follow_redirects=False,
                )
                assert resp.status_code == 302
                state = parse_qs(urlsplit(resp.headers["location"]).query)["state"][0]
                saved = oidc_core._state_store.pop(state)
                assert saved["return_to"] == expected
        finally:
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


def _seed_state(client, state, payload):
    """Store a sign-in's state as /openid/login would, and give the test
    client the browser cookie that goes with it."""
    from backend.routers.oidc import core as oidc_core

    browser = f"browser-{state}"
    oidc_core._state_store.put(state, {**payload, "browser": browser})
    client.cookies.delete(oidc_core.OIDC_FLOW_COOKIE)
    client.cookies.set(oidc_core.OIDC_FLOW_COOKIE, browser)



class TestOIDCCallback:
    """The callback exchanges the code, resolves the user, and signs them in
    with HttpOnly session and refresh cookies (issue #156). No token rides on
    the redirect: the SPA resumes the session from the refresh cookie."""

    @pytest.fixture(autouse=True)
    def _forget_flow_cookie(self, client):
        # _seed_state's cookie isn't scoped like the server's, so the server
        # clearing its own wouldn't remove it from the shared test client.
        yield
        client.cookies.delete("grimoire_oidc_flow")

    def test_callback_from_another_browser_is_refused(self, client):
        from backend.routers.oidc import core as oidc_core

        oidc_core._state_store.put(
            "state-elsewhere",
            {"code_verifier": "v", "nonce": "n", "return_to": "/", "browser": "the-starter"},
        )
        client.cookies.set("grimoire_oidc_flow", "someone-else")
        resp = client.get(
            "/api/auth/openid/callback?code=abc&state=state-elsewhere", follow_redirects=False
        )
        assert resp.headers["location"].startswith("/login?oidc_error=")
        assert "another+browser" in resp.headers["location"]
        # Spent: the starter can't use the link afterwards either.
        assert oidc_core._state_store.pop("state-elsewhere") is None

    def test_state_without_a_browser_binding_is_refused(self, client):
        """State stored by a version without the binding (e.g. in Valkey
        across an upgrade) is refused rather than trusted."""
        from backend.routers.oidc import core as oidc_core

        oidc_core._state_store.put(
            "state-unbound", {"code_verifier": "v", "nonce": "n", "return_to": "/"}
        )
        client.cookies.set("grimoire_oidc_flow", "anything")
        resp = client.get(
            "/api/auth/openid/callback?code=abc&state=state-unbound", follow_redirects=False
        )
        assert resp.headers["location"].startswith("/login?oidc_error=")

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
            _seed_state(client,
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
            # No token in the redirect - it would land in browser history...
            assert resp.headers["location"] == "/"
            # ...the session and refresh cookies carry the sign-in instead.
            set_cookie = "".join(
                v for k, v in resp.headers.items() if k.lower() == "set-cookie"
            )
            assert "grimoire_session=" in set_cookie
            assert "grimoire_refresh=" in set_cookie
            assert "httponly" in set_cookie.lower()
        finally:
            self._cleanup(client, admin_headers)

    @pytest.mark.parametrize(
        "return_to",
        [
            "//attacker.example/collect",
            "/\\attacker.example/collect",
            "/\t/attacker.example/collect",
            "https://attacker.example/collect",
        ],
    )
    def test_callback_never_redirects_offsite(self, client, admin_headers, return_to):
        """GHSA-79mw-m4jj-qp8f: the token-bearing redirect stays on our origin,
        even if a hostile return_to somehow made it into the state store."""
        from backend.routers.oidc import core as oidc_core

        self._configure(client, admin_headers)
        try:
            _seed_state(client,
                "state-evil",
                {"code_verifier": "verifier", "nonce": "nonce123", "return_to": return_to},
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
                    return_value={"sub": "oidc-sub-evil", "email": "evil@example.com"},
                ),
                patch.object(oidc_core, "_fetch_userinfo", return_value={}),
            ):
                resp = client.get(
                    "/api/auth/openid/callback?code=abc&state=state-evil",
                    follow_redirects=False,
                )
            assert resp.status_code == 302
            assert resp.headers["location"] == "/"
        finally:
            self._cleanup(client, admin_headers)

    def test_callback_keeps_token_validation_details_in_the_log(
        self, client, admin_headers, caplog
    ):
        from backend.routers.oidc import core as oidc_core
        from backend.routers.oidc._helpers import _OIDCError

        self._configure(client, admin_headers)
        try:
            _seed_state(client,
                "state-jwks",
                {"code_verifier": "verifier", "nonce": "nonce123", "return_to": "/"},
            )
            token_resp = httpx.Response(
                200,
                json={"id_token": "id-tok", "access_token": "acc-tok"},
                request=httpx.Request("POST", "https://idp.example.com/realm/token"),
            )
            failure = _OIDCError("jwks fetch failed: connect to idp-internal.lan refused")
            with (
                patch.object(oidc_core.httpx, "post", return_value=token_resp),
                patch.object(oidc_core, "_discover_issuer", return_value="https://idp.example.com/realm"),
                patch.object(oidc_core, "_validate_id_token", side_effect=failure),
                caplog.at_level("WARNING"),
            ):
                resp = client.get(
                    "/api/auth/openid/callback?code=abc&state=state-jwks",
                    follow_redirects=False,
                )
            assert resp.status_code == 302
            location = resp.headers["location"]
            assert location == "/login?oidc_error=the+sign-in+could+not+be+verified"
            assert "idp-internal.lan" in caplog.text
        finally:
            self._cleanup(client, admin_headers)

    def test_callback_idp_error_redirects_to_login(self, client):
        from backend.routers.oidc import core as oidc_core

        _seed_state(client,
            "state-denied", {"code_verifier": "v", "nonce": "n", "return_to": "/"}
        )
        resp = client.get(
            "/api/auth/openid/callback?state=state-denied"
            "&error=access_denied&error_description=nope",
            follow_redirects=False,
        )
        assert resp.status_code == 302
        location = resp.headers["location"]
        assert location.startswith("/login?oidc_error=")
        # A fixed message for the code; the IdP's description is only logged.
        assert "nope" not in location
        assert "cancelled" in location
        # The state was spent.
        assert oidc_core._state_store.pop("state-denied") is None

    def test_callback_error_without_valid_state_is_refused(self, client):
        """Anyone can build a callback link, so an error with no state this
        server issued says only that, and carries nothing from the query."""
        resp = client.get(
            "/api/auth/openid/callback?state=forged&error=access_denied"
            "&error_description=x%23oidc_token%3Dattacker",
            follow_redirects=False,
        )
        location = resp.headers["location"]
        assert "#" not in location and "attacker" not in location
        assert "invalid" in location

    def test_callback_error_description_never_plants_a_fragment(self, client):

        _seed_state(client,
            "state-frag", {"code_verifier": "v", "nonce": "n", "return_to": "/"}
        )
        resp = client.get(
            "/api/auth/openid/callback?state=state-frag&error=made_up"
            "&error_description=x%23oidc_token%3Dattacker",
            follow_redirects=False,
        )
        location = resp.headers["location"]
        assert "#" not in location and "attacker" not in location

    def test_error_redirect_is_url_encoded(self):
        from backend.routers.oidc.core import _redirect_with_error

        location = _redirect_with_error("bad #thing&x=1").headers["location"]
        assert location == "/login?oidc_error=bad+%23thing%26x%3D1"

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
            _seed_state(client,
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
            assert "oidc_error=token+exchange+failed" in resp.headers["location"]
        finally:
            self._cleanup(client, admin_headers)


# ---------------------------------------------------------------------------
# Pure-function helpers
# ---------------------------------------------------------------------------


class TestSafeReturnTo:
    @pytest.mark.parametrize(
        "value",
        ["/", "/library", "/books/12?page=3", "/campaigns/4/wiki/a%2Fb"],
    )
    def test_same_origin_paths_kept(self, value):
        assert _safe_return_to(value) == value

    @pytest.mark.parametrize(
        "value",
        [
            None,
            "",
            "library",
            "https://attacker.example/",
            "javascript:alert(1)",
            "//attacker.example/collect",
            "///attacker.example",
            "/\\attacker.example",
            "/\t/attacker.example",
            "/\n/attacker.example",
            "/ /attacker.example",
            "/ok\\..\\x",
            "/ok#frag",
            "/" + "a" * 3000,
        ],
    )
    def test_offsite_or_odd_values_fall_back_to_root(self, value):
        assert _safe_return_to(value) == "/"

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

    def test_keycloak_top_level_path_matches(self):
        # Keycloak's "full group path" form of a top-level group.
        assert _role_from_groups({"groups": ["/admin"]}, "groups") == "admin"
        assert _role_from_groups({"groups": ["/GM"]}, "groups") == "gm"

    @pytest.mark.parametrize(
        "group",
        ["jellyfin-admin", "grimoire-gm", "media-player", "/nextcloud/admin", "/x/admin",
         "admins", "superadmin", "admin/", "//admin"],
    )
    def test_only_exact_names_match(self, group):
        # A group merely ending in a role name belongs to something else.
        assert _role_from_groups({"groups": [group]}, "groups") is None

    def test_configured_group_names_match_exactly(self):
        names = {"admin": "grimoire-admin", "gm": "Grimoire GMs", "player": "/grimoire/players"}
        assert _role_from_groups({"groups": ["grimoire-admin"]}, "groups", names) == "admin"
        assert _role_from_groups({"groups": ["/grimoire-admin"]}, "groups", names) == "admin"
        assert _role_from_groups({"groups": ["grimoire gms"]}, "groups", names) == "gm"
        assert _role_from_groups({"groups": ["/grimoire/players"]}, "groups", names) == "player"
        # The defaults no longer apply once a name is configured...
        assert _role_from_groups({"groups": ["admin"]}, "groups", names) is None
        # ...and the configured names are not suffix-matched either.
        assert _role_from_groups({"groups": ["other-grimoire-admin"]}, "groups", names) is None
        assert _role_from_groups({"groups": ["/a/grimoire-admin"]}, "groups", names) is None

    def test_blank_configured_name_falls_back_to_the_default(self):
        names = {"admin": "  ", "gm": "", "player": "players"}
        assert _role_from_groups({"groups": ["admin"]}, "groups", names) == "admin"
        assert _role_from_groups({"groups": ["gm"]}, "groups", names) == "gm"
        assert _role_from_groups({"groups": ["player"]}, "groups", names) is None

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
                "password": "password123-long",
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

    def test_lookalike_group_is_refused_not_promoted(self, client, admin_setup):
        """Someone in another application's "jellyfin-admin" group is in none of
        Grimoire's role groups, so the sign-in is refused like any other."""
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            with pytest.raises(_OIDCError, match="no matching group"):
                _resolve_user(
                    db,
                    {"sub": "lookalike-sub", "groups": ["jellyfin-admin", "/media/admin"]},
                    self._eff(oidc_groups_claim="groups", oidc_auto_register=True),
                )
        finally:
            db.close()

    def test_configured_group_names_are_used(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {"sub": "named-group-sub", "preferred_username": "named_group",
                 "groups": ["grimoire-gm", "gm"]},
                self._eff(oidc_groups_claim="groups", oidc_auto_register=True,
                          oidc_gm_group="grimoire-gm", oidc_player_group="gm"),
            )
            # "gm" is the player group here; "grimoire-gm" is what grants GM.
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

    def test_permissions_claim_without_view_nsfw_denies_explicit(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            # A new account whose claim leaves viewNSFW out starts locked off.
            user = _resolve_user(
                db,
                {
                    "sub": "perm-no-nsfw-sub",
                    "preferred_username": "perm_no_nsfw",
                    "perms": {"apiKeys": True},
                },
                self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
            )
            assert user.allow_explicit is False
            assert user.explicit_locked is True
            # An explicit grant unlocks it...
            user = _resolve_user(
                db,
                {
                    "sub": "perm-no-nsfw-sub",
                    "preferred_username": "perm_no_nsfw",
                    "perms": {"viewNSFW": True},
                },
                self._eff(oidc_permissions_claim="perms"),
            )
            assert user.allow_explicit is True
            assert user.explicit_locked is False
            # ...and an existing account keeps it when a later claim drops the key.
            user = _resolve_user(
                db,
                {
                    "sub": "perm-no-nsfw-sub",
                    "preferred_username": "perm_no_nsfw",
                    "perms": {},
                },
                self._eff(oidc_permissions_claim="perms"),
            )
            assert user.allow_explicit is True
            assert user.explicit_locked is False
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_no_permissions_claim_configured_leaves_explicit_alone(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            user = _resolve_user(
                db,
                {"sub": "perm-unset-sub", "preferred_username": "perm_unset"},
                self._eff(oidc_auto_register=True),
            )
            assert user.allow_explicit is True
            assert not user.explicit_locked
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

    def test_permissions_claim_applies_api_keys(self, client, admin_setup):
        from backend.config import SessionLocal
        db = SessionLocal()
        try:
            # Off by default: a claim without apiKeys leaves it off.
            user = _resolve_user(
                db,
                {
                    "sub": "perm-keys-sub",
                    "preferred_username": "perm_keys",
                    "perms": {"viewNSFW": True},
                },
                self._eff(oidc_permissions_claim="perms", oidc_auto_register=True),
            )
            assert not user.api_keys_enabled
            user = _resolve_user(
                db,
                {
                    "sub": "perm-keys-sub",
                    "preferred_username": "perm_keys",
                    "perms": {"apiKeys": True},
                },
                self._eff(oidc_permissions_claim="perms"),
            )
            assert user.api_keys_enabled is True
            user = _resolve_user(
                db,
                {
                    "sub": "perm-keys-sub",
                    "preferred_username": "perm_keys",
                    "perms": {"apiKeys": False},
                },
                self._eff(oidc_permissions_claim="perms"),
            )
            assert user.api_keys_enabled is False
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
            patch.object(_helpers, "_decode", decode),
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

    @pytest.mark.parametrize(
        "extra",
        [
            {"aud": ["client", "other"]},  # several audiences, no azp
            {"aud": ["client", "other"], "azp": "other"},
            {"aud": "client", "azp": "other"},  # azp present but not us
        ],
    )
    def test_azp_must_name_this_client(self, extra):
        claims = FakeClaims({"sub": "s", "nonce": "n", **extra})
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode, pytest.raises(_OIDCError, match="azp"):
            self._validate()

    @pytest.mark.parametrize(
        "extra", [{"aud": ["client", "other"], "azp": "client"}, {"aud": "client"}]
    )
    def test_azp_accepted(self, extra):
        claims = FakeClaims({"sub": "s", "nonce": "n", **extra})
        get_jwks, decode = self._patch(lambda *a, **k: claims)
        with get_jwks, decode:
            assert self._validate()["sub"] == "s"

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
            with patch.object(_helpers, "_decode", decode):
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

    @pytest.mark.parametrize("alg", ["HS256", "none", ""])
    def test_unsupported_configured_algorithm_fails_cleanly(self, alg):
        from backend.routers.oidc import _helpers

        with patch.object(_helpers, "_get_jwks") as get_jwks:
            with pytest.raises(_OIDCError, match="not supported"):
                self._validate(allowed_alg=alg)
        # Refused before anything is fetched.
        get_jwks.assert_not_called()

    def test_decode_errors_other_than_jose_become_sign_in_errors(self):
        def decode(*a, **k):
            raise ValueError('Missing required field: "k"')

        get_jwks, decode_patch = self._patch(decode)
        with get_jwks, decode_patch:
            with pytest.raises(_OIDCError, match="signature invalid"):
                self._validate()

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

    def _make(self, db, **fields):
        from backend.models import User

        user = User(hashed_password="x", role="player", **fields)
        db.add(user)
        db.commit()
        return user

    def test_email_match_only_considers_unlinked_accounts(self, client, admin_setup):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            linked = self._make(
                db, username="linked-elsewhere", email="linked@example.com", oidc_subject="first-sub"
            )
            with pytest.raises(_OIDCError, match="auto-register"):
                _resolve_user(
                    db,
                    {"sub": "second-sub", "email": "linked@example.com"},
                    self._eff(oidc_match_by="email"),
                )
            db.refresh(linked)
            assert linked.oidc_subject == "first-sub"
            db.delete(linked)
            db.commit()
        finally:
            db.close()

    def test_email_match_needs_a_confirmed_address(self, client, admin_setup):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            owner = self._make(db, username="mail-unconfirmed", email="unconfirmed@example.com")
            for flag in (False, "false"):
                with pytest.raises(_OIDCError, match="auto-register"):
                    _resolve_user(
                        db,
                        {"sub": "u-sub", "email": "unconfirmed@example.com", "email_verified": flag},
                        self._eff(oidc_match_by="email"),
                    )
            user = _resolve_user(
                db,
                {"sub": "u-sub", "email": "unconfirmed@example.com", "email_verified": True},
                self._eff(oidc_match_by="email"),
            )
            assert user.id == owner.id
            db.delete(user)
            db.commit()
        finally:
            db.close()

    def test_linked_account_keeps_its_email_until_the_provider_confirms_one(
        self, client, admin_setup
    ):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            linked = self._make(db, username="email-sync", email="old@example.com", oidc_subject="sync-sub")
            _resolve_user(
                db,
                {"sub": "sync-sub", "email": "new@example.com", "email_verified": False},
                self._eff(),
            )
            db.refresh(linked)
            assert linked.email == "old@example.com"
            _resolve_user(
                db,
                {"sub": "sync-sub", "email": "new@example.com", "email_verified": True},
                self._eff(),
            )
            db.refresh(linked)
            assert linked.email == "new@example.com"
            db.delete(linked)
            db.commit()
        finally:
            db.close()

    def test_guest_accounts_are_never_matched(self, client, admin_setup):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            guest = self._make(db, username="guest-mailbox", email="guest@example.com", is_guest=True)
            guest.role = "guest"
            db.commit()
            with pytest.raises(_OIDCError, match="auto-register"):
                _resolve_user(
                    db,
                    {"sub": "g-sub", "email": "guest@example.com"},
                    self._eff(oidc_match_by="email"),
                )
            db.delete(guest)
            db.commit()
        finally:
            db.close()

    def test_username_match_never_picks_an_admin_account(self, client, admin_setup):
        """Most providers let people choose their login name, so it can't be
        what hands someone an admin account. Any case of the name is refused."""
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            admin = self._make(db, username="LocalBoss")
            admin.role = "admin"
            db.commit()
            for name in ("LocalBoss", "localboss", "LOCALBOSS"):
                with pytest.raises(_OIDCError, match="auto-register"):
                    _resolve_user(
                        db,
                        {"sub": f"boss-{name}", "preferred_username": name},
                        self._eff(oidc_match_by="username"),
                    )
            # With auto-register on, the person gets a new account of their own.
            other = _resolve_user(
                db,
                {"sub": "boss-sub", "preferred_username": "localboss"},
                self._eff(oidc_match_by="username", oidc_auto_register=True),
            )
            db.refresh(admin)
            assert other.id != admin.id
            assert other.role == "player"
            assert admin.oidc_subject is None
            db.delete(other)
            db.delete(admin)
            db.commit()
        finally:
            db.close()

    def test_username_match_uses_only_the_login_name(self, client, admin_setup):
        from backend.config import SessionLocal

        db = SessionLocal()
        try:
            local = self._make(db, username="localname")
            for claims in (
                {"sub": "n-sub", "name": "localname"},
                {"sub": "n-sub", "nickname": "localname"},
                {"sub": "n-sub", "email": "localname@example.com"},
            ):
                with pytest.raises(_OIDCError, match="auto-register"):
                    _resolve_user(db, claims, self._eff(oidc_match_by="username"))
            db.refresh(local)
            assert local.oidc_subject is None
            db.delete(local)
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



class TestOidcLoginHardening:
    def test_discovery_is_cached(self):
        from backend.routers.oidc import _helpers

        resp = httpx.Response(
            200, json={"issuer": "https://cached.idp"},
            request=httpx.Request("GET", "https://cached.idp/.well-known/openid-configuration"),
        )
        with patch.object(_helpers.httpx, "get", return_value=resp) as get:
            for _ in range(3):
                assert _helpers._discover_issuer("https://cached.idp") == "https://cached.idp"
        assert get.call_count == 1

    def test_failed_discovery_is_not_cached(self):
        from backend.routers.oidc import _helpers

        with patch.object(_helpers.httpx, "get", side_effect=httpx.ConnectError("down")) as get:
            _helpers._discovery_doc("https://down.idp")
            _helpers._discovery_doc("https://down.idp")
        assert get.call_count == 2

    def test_memory_state_store_is_capped(self, monkeypatch):
        from backend.routers.oidc import _state

        monkeypatch.setattr(_state, "_STATE_MAX", 3)
        store = _state.MemoryStateStore()
        for i in range(5):
            store.put(f"s{i}", {"n": i})
        assert len(store._d) == 3
        assert store.pop("s0") is None and store.pop("s1") is None
        assert store.pop("s4")["n"] == 4

    def test_login_start_is_rate_limited(self, client, monkeypatch):
        from backend import security

        monkeypatch.setattr(security.limiter, "enabled", True)
        security.limiter.reset()
        try:
            codes = [client.get("/api/auth/openid/login", follow_redirects=False).status_code
                     for _ in range(35)]
        finally:
            security.limiter.reset()
        assert 429 in codes
