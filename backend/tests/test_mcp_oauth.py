"""OAuth sign-in for /mcp (issue #906): the whole flow, and every way it refuses.

The OAuth routes are only mounted when MCP_OAUTH_ENABLED is on, so these tests
build an app of their own - /mcp, the OAuth routes and the consent API - as
the MCP tests do. Grants are api_keys rows, so the key list is checked through
the shared session client.
"""
import base64
import datetime
import hashlib
import logging
import secrets
from urllib.parse import parse_qs, urlsplit

import pytest
from fastapi import APIRouter, Depends, FastAPI
from fastapi.testclient import TestClient

from backend import config
from backend.auth import get_current_user
from backend.config import SessionLocal
from backend.mcp_oauth import routes as oauth_routes
from backend.models import ApiKey, OAuthClient, OAuthCode
from backend.routers import api_keys as api_keys_router
from backend.routers import mcp as mcp_router
from backend.security import limiter
from backend.tests._mcp import allow_keys, make_key

BASE_URL = "http://localhost:9481"
REDIRECT = "https://claude.ai/api/mcp/auth_callback"
RESOURCE = f"{BASE_URL}/mcp"


@pytest.fixture(scope="module")
def oauth_client():
    # Pinned: the issuer, the resource and the consent address all come from
    # BASE_URL, and only loopback may be plain http.
    saved = config.BASE_URL
    config.BASE_URL = BASE_URL
    try:
        app = FastAPI()
        app.include_router(mcp_router.router)
        assert oauth_routes.mount(app)
        api = APIRouter(prefix="/api", dependencies=[Depends(get_current_user)])
        api.include_router(api_keys_router.oauth_router)
        app.include_router(api)
        with TestClient(app) as c:
            yield c
    finally:
        config.BASE_URL = saved


@pytest.fixture
def rate_limited():
    limiter.reset()
    limiter.enabled = True
    try:
        yield
    finally:
        limiter.enabled = False
        limiter.reset()


def _pkce():
    verifier = secrets.token_urlsafe(48)
    challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).decode().rstrip("=")
    )
    return verifier, challenge


def register(c, redirect=REDIRECT, **extra):
    body = {
        "redirect_uris": [redirect],
        "token_endpoint_auth_method": "client_secret_post",
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "client_name": "Claude",
        **extra,
    }
    return c.post("/register", json=body)


def authorize(c, client_id, challenge, redirect=REDIRECT, **extra):
    params = {
        "response_type": "code",
        "client_id": client_id,
        "redirect_uri": redirect,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
        "state": "st-123",
        "resource": RESOURCE,
        **extra,
    }
    return c.get("/authorize", params=params, follow_redirects=False)


class Flow:
    """One client signed in by one user, step by step."""

    def __init__(self, c, headers):
        self.c, self.headers = c, headers
        resp = register(c)
        assert resp.status_code == 201, resp.text
        self.client = resp.json()
        self.verifier, self.challenge = _pkce()

    @property
    def client_id(self):
        return self.client["client_id"]

    def request_id(self):
        resp = authorize(self.c, self.client_id, self.challenge)
        assert resp.status_code == 302, resp.text
        location = resp.headers["location"]
        assert urlsplit(location).path == "/oauth/consent"
        return parse_qs(urlsplit(location).query)["request"][0]

    def approve(self, request_id=None, **body):
        rid = request_id or self.request_id()
        resp = self.c.post(f"/api/oauth/requests/{rid}/approve", json=body, headers=self.headers)
        assert resp.status_code == 200, resp.text
        query = parse_qs(urlsplit(resp.json()["redirect_to"]).query)
        assert query["state"] == ["st-123"]
        return query["code"][0]

    def exchange(self, code, verifier=None, redirect=REDIRECT):
        return self.c.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": redirect,
                "client_id": self.client_id,
                "client_secret": self.client["client_secret"],
                "code_verifier": verifier or self.verifier,
                "resource": RESOURCE,
            },
        )

    def tokens(self):
        resp = self.exchange(self.approve())
        assert resp.status_code == 200, resp.text
        return resp.json()

    def refresh(self, refresh_token):
        return self.c.post(
            "/token",
            data={
                "grant_type": "refresh_token",
                "refresh_token": refresh_token,
                "client_id": self.client_id,
                "client_secret": self.client["client_secret"],
                "resource": RESOURCE,
            },
        )


def mcp(c, access_token, method="tools/list"):
    return c.post(
        "/mcp",
        json={"jsonrpc": "2.0", "id": 1, "method": method},
        headers={"Authorization": f"Bearer {access_token}"},
    )


def grant_row(access_token=None, client_id=None):
    from backend.mcp_oauth.tokens import digest

    db = SessionLocal()
    try:
        q = db.query(ApiKey)
        if access_token:
            q = q.filter_by(access_token_hash=digest(access_token))
        if client_id:
            q = q.filter_by(client_id=client_id)
        return q.first()
    finally:
        db.close()


def set_columns(model, row_id, **values):
    db = SessionLocal()
    try:
        db.query(model).filter_by(**row_id).update(values)
        db.commit()
    finally:
        db.close()


PAST = datetime.datetime(2000, 1, 1, tzinfo=datetime.timezone.utc)


class TestDiscovery:
    def test_metadata_documents(self, oauth_client):
        meta = oauth_client.get("/.well-known/oauth-authorization-server").json()
        assert meta["issuer"].rstrip("/") == BASE_URL
        assert meta["registration_endpoint"].endswith("/register")
        assert meta["revocation_endpoint"].endswith("/revoke")
        assert meta["code_challenge_methods_supported"] == ["S256"]
        resource = oauth_client.get("/.well-known/oauth-protected-resource/mcp").json()
        assert resource["resource"] == RESOURCE

    def test_mcp_without_credentials_points_at_discovery(self, oauth_client):
        resp = oauth_client.post("/mcp", json={"jsonrpc": "2.0", "id": 1, "method": "ping"})
        assert resp.status_code == 401
        challenge = resp.headers["www-authenticate"]
        assert challenge.startswith("Bearer ")
        assert "/.well-known/oauth-protected-resource/mcp" in challenge
        assert "error=" not in challenge

    def test_an_unknown_token_is_invalid_token(self, oauth_client):
        resp = mcp(oauth_client, "grim_at_nope")
        assert resp.status_code == 401
        assert 'error="invalid_token"' in resp.headers["www-authenticate"]


class TestSignIn:
    def test_the_whole_flow(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        info = oauth_client.get(f"/api/oauth/requests/{rid}", headers=admin_headers).json()
        assert info["client_name"] == "Claude"
        assert info["redirect_host"] == "claude.ai"
        assert info["may_approve"] is True
        tokens = flow.exchange(flow.approve(rid)).json()
        assert tokens["access_token"].startswith("grim_at_")
        assert tokens["refresh_token"].startswith("grim_rt_")
        assert tokens["scope"] == "mcp"
        resp = mcp(oauth_client, tokens["access_token"])
        assert resp.status_code == 200, resp.text
        assert resp.json()["result"]["tools"]

    def test_a_grant_is_listed_as_an_app_and_cannot_be_regenerated(
        self, client, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        flow.tokens()
        listed = client.get("/api/api-keys", headers=admin_headers).json()
        app = next(k for k in listed if k["kind"] == "app" and k["name"] == "Claude")
        assert app["client_name"] == "Claude"
        assert app["redirect_host"] == "claude.ai"
        resp = client.post(f"/api/api-keys/{app['id']}/regenerate", headers=admin_headers)
        assert resp.status_code == 409

    def test_a_grant_never_works_as_an_api_key(self, client, oauth_client, admin_headers):
        tokens = Flow(oauth_client, admin_headers).tokens()
        for value in (tokens["access_token"], tokens["refresh_token"]):
            assert client.get("/api/books", headers={"X-API-Key": value}).status_code == 401

    def test_an_access_token_is_not_a_session_on_the_api(self, client, oauth_client, admin_headers):
        tokens = Flow(oauth_client, admin_headers).tokens()
        resp = client.get("/api/books", headers={"Authorization": f"Bearer {tokens['access_token']}"})
        assert resp.status_code == 401

    def test_deny_sends_access_denied_and_drops_the_request(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        resp = oauth_client.post(f"/api/oauth/requests/{rid}/deny", headers=admin_headers)
        query = parse_qs(urlsplit(resp.json()["redirect_to"]).query)
        assert query["error"] == ["access_denied"] and query["state"] == ["st-123"]
        again = oauth_client.post(f"/api/oauth/requests/{rid}/approve", json={}, headers=admin_headers)
        assert again.status_code == 404

    def test_a_request_is_approved_once(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        flow.approve(rid)
        again = oauth_client.post(f"/api/oauth/requests/{rid}/approve", json={}, headers=admin_headers)
        assert again.status_code == 404

    def test_chosen_permissions_are_validated_for_the_role(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = oauth_client.post(
            f"/api/oauth/requests/{flow.request_id()}/approve",
            json={"permissions": {"no-such-permission": "read"}},
            headers=admin_headers,
        )
        assert resp.status_code == 400


class TestCodes:
    def test_a_wrong_pkce_verifier_is_refused(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = flow.exchange(flow.approve(), verifier=secrets.token_urlsafe(48))
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_grant"

    def test_the_plain_pkce_method_is_refused(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = authorize(oauth_client, flow.client_id, flow.verifier, code_challenge_method="plain")
        assert resp.status_code == 302
        assert "error=invalid_request" in resp.headers["location"]
        assert urlsplit(resp.headers["location"]).hostname == "claude.ai"

    def test_a_reused_code_is_refused_and_revokes_its_grant(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        code = flow.approve()
        first = flow.exchange(code)
        assert first.status_code == 200
        second = flow.exchange(code)
        assert second.status_code == 400 and second.json()["error"] == "invalid_grant"
        assert mcp(oauth_client, first.json()["access_token"]).status_code == 401

    def test_an_expired_code_is_refused(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        code = flow.approve()
        set_columns(OAuthCode, {"client_id": flow.client_id}, expires_at=PAST)
        resp = flow.exchange(code)
        assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"

    def test_an_unregistered_redirect_uri_is_refused_without_redirecting(
        self, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        resp = authorize(oauth_client, flow.client_id, flow.challenge, redirect="https://evil.example/cb")
        assert resp.status_code == 400

    def test_a_different_redirect_uri_at_the_exchange_is_refused(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = flow.exchange(flow.approve(), redirect="https://claude.ai/other")
        assert resp.status_code == 400

    def test_tokens_are_only_for_this_servers_mcp(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = authorize(
            oauth_client, flow.client_id, flow.challenge, resource="https://elsewhere.example/mcp"
        )
        assert resp.status_code == 302
        assert "error=invalid_target" in resp.headers["location"]

    def test_a_wrong_client_secret_is_refused(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        code = flow.approve()
        flow.client["client_secret"] = "0" * 64
        resp = flow.exchange(code)
        assert resp.status_code == 401 and resp.json()["error"] == "invalid_client"

    def test_a_missing_client_secret_is_refused(self, oauth_client, admin_headers):
        # Pins the SDK behaviour clients.get relies on: a client registered with
        # a secret, given none back, must be refused rather than waved through.
        flow = Flow(oauth_client, admin_headers)
        code = flow.approve()
        resp = oauth_client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT,
                "client_id": flow.client_id,
                "code_verifier": flow.verifier,
            },
        )
        assert resp.status_code == 401 and resp.json()["error"] == "invalid_client"

    def test_only_the_secrets_hash_is_stored(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        db = SessionLocal()
        try:
            row = db.query(OAuthClient).filter_by(client_id=flow.client_id).one()
        finally:
            db.close()
        assert flow.client["client_secret"] not in str(row.info)
        assert row.client_secret_hash != flow.client["client_secret"]


class TestTokens:
    def test_an_expired_access_token_is_invalid_token_and_refresh_renews_it(
        self, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        set_columns(ApiKey, {"client_id": flow.client_id}, access_expires_at=PAST)
        resp = mcp(oauth_client, tokens["access_token"])
        assert resp.status_code == 401
        assert 'error="invalid_token"' in resp.headers["www-authenticate"]
        renewed = flow.refresh(tokens["refresh_token"])
        assert renewed.status_code == 200, renewed.text
        assert mcp(oauth_client, renewed.json()["access_token"]).status_code == 200

    def test_a_refresh_sent_twice_inside_the_grace_window_gets_the_same_pair(
        self, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        first = flow.refresh(tokens["refresh_token"])
        second = flow.refresh(tokens["refresh_token"])
        assert first.status_code == second.status_code == 200
        assert first.json()["access_token"] == second.json()["access_token"]
        assert first.json()["refresh_token"] == second.json()["refresh_token"]
        # The pair both answers carried keeps working.
        assert mcp(oauth_client, second.json()["access_token"]).status_code == 200
        assert flow.refresh(second.json()["refresh_token"]).status_code == 200

    def test_a_replaced_refresh_token_after_the_window_revokes_the_grant(
        self, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        renewed = flow.refresh(tokens["refresh_token"]).json()
        set_columns(ApiKey, {"client_id": flow.client_id}, prev_refresh_until=PAST)
        resp = flow.refresh(tokens["refresh_token"])
        assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"
        assert grant_row(client_id=flow.client_id) is None
        assert mcp(oauth_client, renewed["access_token"]).status_code == 401

    def test_a_refresh_token_is_bound_to_its_client(self, oauth_client, admin_headers):
        tokens = Flow(oauth_client, admin_headers).tokens()
        other = Flow(oauth_client, admin_headers)
        resp = other.refresh(tokens["refresh_token"])
        assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"


class TestRevocation:
    def test_revoked_by_its_owner(self, client, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        grant = grant_row(client_id=flow.client_id)
        assert client.delete(f"/api/api-keys/{grant.id}", headers=admin_headers).status_code == 204
        assert mcp(oauth_client, tokens["access_token"]).status_code == 401
        assert flow.refresh(tokens["refresh_token"]).status_code == 400

    def test_revoked_by_an_admin(self, client, oauth_client, admin_headers, player_headers, player_id):
        allow_keys(client, admin_headers, player_id)
        flow = Flow(oauth_client, player_headers)
        tokens = flow.tokens()
        grant = grant_row(client_id=flow.client_id)
        assert client.delete(f"/api/api-keys/{grant.id}", headers=admin_headers).status_code == 204
        assert mcp(oauth_client, tokens["access_token"]).status_code == 401

    def test_revoked_through_the_revoke_endpoint(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        resp = oauth_client.post(
            "/revoke",
            data={
                "token": tokens["refresh_token"],
                "token_type_hint": "refresh_token",
                "client_id": flow.client_id,
                "client_secret": flow.client["client_secret"],
            },
        )
        assert resp.status_code == 200
        assert mcp(oauth_client, tokens["access_token"]).status_code == 401

    def test_revoke_works_while_the_grant_cannot_be_used(
        self, client, oauth_client, admin_headers, player_headers, player_id
    ):
        """A grant whose owner has lost keys is still revocable, and stays revoked."""
        allow_keys(client, admin_headers, player_id)
        flow = Flow(oauth_client, player_headers)
        tokens = flow.tokens()
        allow_keys(client, admin_headers, player_id, allowed=False)
        try:
            resp = oauth_client.post(
                "/revoke",
                data={
                    "token": tokens["refresh_token"],
                    "token_type_hint": "refresh_token",
                    "client_id": flow.client_id,
                    "client_secret": flow.client["client_secret"],
                },
            )
            assert resp.status_code == 200
            assert grant_row(client_id=flow.client_id) is None
        finally:
            allow_keys(client, admin_headers, player_id)
        assert flow.refresh(tokens["refresh_token"]).status_code == 400


class TestOwnerChecks:
    """Every refusal covers the refresh token too: a client refreshes straight
    after an invalid_token, so an access-token-only check would be undone."""

    def test_keys_turned_off_for_the_owner(self, client, oauth_client, admin_headers, player_headers, player_id):
        allow_keys(client, admin_headers, player_id)
        flow = Flow(oauth_client, player_headers)
        tokens = flow.tokens()
        allow_keys(client, admin_headers, player_id, allowed=False)
        try:
            assert mcp(oauth_client, tokens["access_token"]).status_code == 403
            resp = flow.refresh(tokens["refresh_token"])
            assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"
        finally:
            allow_keys(client, admin_headers, player_id)

    @staticmethod
    def _user(client, admin_headers, role, keys):
        username = f"oauth-{role}-{secrets.token_hex(3)}"
        created = client.post(
            "/api/users",
            json={"username": username, "password": "oauthpass1234", "role": role, "api_keys_enabled": keys},
            headers=admin_headers,
        )
        assert created.status_code == 201, created.text
        token = client.post(
            "/api/auth/login", json={"username": username, "password": "oauthpass1234"}
        ).json()["token"]
        client.cookies.clear()
        return created.json()["id"], {"Authorization": f"Bearer {token}"}

    def test_a_demoted_owners_grant_loses_the_role(self, client, oauth_client, admin_headers):
        user_id, headers = self._user(client, admin_headers, "gm", keys=True)
        flow = Flow(oauth_client, headers)
        tokens = flow.exchange(flow.approve(permissions={"*": "write"})).json()

        def tools():
            resp = mcp(oauth_client, tokens["access_token"])
            assert resp.status_code == 200, resp.text
            return {t["name"] for t in resp.json()["result"]["tools"]}

        assert "tag_books" in tools()
        client.patch(f"/api/users/{user_id}", json={"role": "player"}, headers=admin_headers)
        # Still connected, but with only what a player may do.
        assert "tag_books" not in tools()

    def test_an_admin_demoted_without_keys_is_refused_on_both_paths(
        self, client, oauth_client, admin_headers
    ):
        # Admins hold keys regardless of the per-user switch; a player needs it.
        user_id, headers = self._user(client, admin_headers, "admin", keys=False)
        flow = Flow(oauth_client, headers)
        tokens = flow.tokens()
        client.patch(f"/api/users/{user_id}", json={"role": "player"}, headers=admin_headers)
        assert mcp(oauth_client, tokens["access_token"]).status_code == 403
        resp = flow.refresh(tokens["refresh_token"])
        assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"

    def test_api_keys_off_for_the_instance(self, oauth_client, admin_headers, monkeypatch):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        monkeypatch.setattr(config, "API_KEYS_ENABLED", False)
        assert mcp(oauth_client, tokens["access_token"]).status_code == 403
        resp = flow.refresh(tokens["refresh_token"])
        assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"

    def test_keys_turned_off_between_approval_and_exchange(
        self, client, oauth_client, admin_headers, player_headers, player_id
    ):
        allow_keys(client, admin_headers, player_id)
        flow = Flow(oauth_client, player_headers)
        code = flow.approve()
        allow_keys(client, admin_headers, player_id, allowed=False)
        try:
            resp = flow.exchange(code)
            assert resp.status_code == 400 and resp.json()["error"] == "invalid_grant"
        finally:
            allow_keys(client, admin_headers, player_id)

    def test_a_user_without_keys_cannot_approve(
        self, client, oauth_client, admin_headers, player_headers, player_id
    ):
        allow_keys(client, admin_headers, player_id, allowed=False)
        try:
            flow = Flow(oauth_client, player_headers)
            rid = flow.request_id()
            info = oauth_client.get(f"/api/oauth/requests/{rid}", headers=player_headers).json()
            assert info["may_approve"] is False
            resp = oauth_client.post(
                f"/api/oauth/requests/{rid}/approve", json={}, headers=player_headers
            )
            assert resp.status_code == 403
        finally:
            allow_keys(client, admin_headers, player_id)

    def test_an_api_key_cannot_approve(self, client, oauth_client, admin_headers):
        key = make_key(client, admin_headers, {"*": "write"})
        flow = Flow(oauth_client, admin_headers)
        resp = oauth_client.post(
            f"/api/oauth/requests/{flow.request_id()}/approve",
            json={},
            headers={"X-API-Key": key},
        )
        assert resp.status_code == 403

    def test_a_grant_sees_what_the_same_key_would(
        self, client, oauth_client, admin_headers, player_headers, player_id
    ):
        allow_keys(client, admin_headers, player_id)
        key = make_key(client, player_headers, {"*": "read"})
        tokens = Flow(oauth_client, player_headers).tokens()
        by_key = oauth_client.post(
            "/mcp",
            json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"},
            headers={"X-API-Key": key},
        ).json()["result"]["tools"]
        by_grant = mcp(oauth_client, tokens["access_token"]).json()["result"]["tools"]
        assert sorted(t["name"] for t in by_grant) == sorted(t["name"] for t in by_key)


class TestRegistration:
    def test_the_allow_list_refuses_other_hosts(self, oauth_client, monkeypatch):
        monkeypatch.setattr(config, "MCP_OAUTH_REDIRECT_HOSTS", ["claude.ai"])
        assert register(oauth_client).status_code == 201
        resp = register(oauth_client, redirect="https://evil.example/cb")
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_redirect_uri"

    @pytest.mark.parametrize(
        "redirect", ["http://evil.example/cb", "ftp://claude.ai/cb", "https://claude.ai/cb#frag"]
    )
    def test_unsafe_redirect_addresses_are_refused(self, oauth_client, redirect):
        assert register(oauth_client, redirect=redirect).status_code == 400

    def test_loopback_http_is_allowed_for_local_clients(self, oauth_client):
        assert register(oauth_client, redirect="http://127.0.0.1:33418/callback").status_code == 201

    @staticmethod
    def _remaining():
        db = SessionLocal()
        try:
            return {c for (c,) in db.query(OAuthClient.client_id).all()}
        finally:
            db.close()

    def test_clients_without_a_grant_are_cleaned_up(self, client, oauth_client, admin_headers):
        two_hours_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
        idle = Flow(oauth_client, admin_headers)  # never started a sign-in
        started = Flow(oauth_client, admin_headers)
        started.request_id()  # started, not approved yet
        used = Flow(oauth_client, admin_headers)
        used.tokens()  # holds a grant
        lapsed = Flow(oauth_client, admin_headers)
        lapsed.tokens()
        grant = grant_row(client_id=lapsed.client_id)
        assert client.delete(f"/api/api-keys/{grant.id}", headers=admin_headers).status_code == 204
        for flow in (idle, started, used, lapsed):
            set_columns(OAuthClient, {"client_id": flow.client_id}, created_at=two_hours_ago)
        assert register(oauth_client).status_code == 201
        remaining = self._remaining()
        assert idle.client_id not in remaining
        # A sign-in under way gets a day, and a client that was approved keeps
        # its registration for 30 days, to be approved again under it.
        assert {started.client_id, used.client_id, lapsed.client_id} <= remaining
        set_columns(OAuthClient, {"client_id": started.client_id}, created_at=PAST)
        set_columns(OAuthClient, {"client_id": lapsed.client_id}, granted_at=PAST)
        assert register(oauth_client).status_code == 201
        remaining = self._remaining()
        assert started.client_id not in remaining and lapsed.client_id not in remaining
        assert used.client_id in remaining

    def test_a_flood_of_registrations_never_pushes_out_a_sign_in(
        self, oauth_client, admin_headers, monkeypatch
    ):
        from backend.mcp_oauth import clients

        signing_in = Flow(oauth_client, admin_headers)
        rid = signing_in.request_id()
        db = SessionLocal()
        try:
            waiting = clients._without_grant(db).count()
        finally:
            db.close()
        monkeypatch.setattr(clients, "MAX_UNUSED_CLIENTS", waiting + 2)
        for _ in range(5):
            assert register(oauth_client).status_code == 201
        assert signing_in.client_id in self._remaining()
        # ... and that sign-in still completes.
        assert signing_in.exchange(signing_in.approve(rid)).status_code == 200


class TestThrottling:
    def test_one_clients_failures_never_throttle_another_on_the_same_address(
        self, oauth_client, admin_headers, rate_limited
    ):
        broken = Flow(oauth_client, admin_headers)
        healthy = Flow(oauth_client, admin_headers)
        saw_429 = False
        for _ in range(30):
            if broken.refresh("grim_rt_nope").status_code == 429:
                saw_429 = True
                break
        assert saw_429
        assert healthy.refresh("grim_rt_nope").status_code == 400

    def test_knowing_a_client_id_does_not_let_anyone_lock_it_out(
        self, oauth_client, admin_headers, rate_limited
    ):
        victim = Flow(oauth_client, admin_headers)
        tokens = victim.tokens()
        for _ in range(30):
            oauth_client.post(
                "/token",
                data={
                    "grant_type": "refresh_token",
                    "refresh_token": "grim_rt_nope",
                    "client_id": victim.client_id,
                    "client_secret": "wrong",
                },
                headers={"X-Forwarded-For": "203.0.113.66"},
            )
        assert victim.refresh(tokens["refresh_token"]).status_code == 200

    def test_an_oversized_request_is_refused_before_it_is_read_whole(self, oauth_client):
        resp = oauth_client.post(
            "/token",
            content=b"a" * (70 * 1024),
            headers={"content-type": "application/x-www-form-urlencoded"},
        )
        assert resp.status_code == 413

    def test_registration_is_throttled_per_address(self, oauth_client, rate_limited):
        statuses = [register(oauth_client).status_code for _ in range(30)]
        assert 429 in statuses


class TestMounting:
    def test_a_localhost_base_url_is_warned_about(self, monkeypatch, caplog):
        monkeypatch.setattr(config, "BASE_URL", BASE_URL)
        with caplog.at_level(logging.WARNING, logger="grimoire.mcp"):
            assert oauth_routes.mount(FastAPI())
        assert "BASE_URL" in caplog.text

    def test_an_http_base_url_keeps_oauth_off(self, monkeypatch, caplog):
        monkeypatch.setattr(config, "BASE_URL", "http://grimoire.example.com")
        app = FastAPI()
        with caplog.at_level(logging.ERROR, logger="grimoire.mcp"):
            assert not oauth_routes.mount(app)
        assert "https" in caplog.text
        assert not any(getattr(r, "path", "") == "/token" for r in app.routes)

    def test_the_consent_api_is_a_404_when_oauth_is_off(self, client, admin_headers):
        assert client.get("/api/oauth/requests/x", headers=admin_headers).status_code == 404
