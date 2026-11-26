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
from backend.mcp_oauth import codes
from backend.mcp_oauth import routes as oauth_routes
from backend.mcp_oauth.tokens import digest
from backend.models import ApiKey, OAuthClient, OAuthCode
from backend.routers import api_keys as api_keys_router
from backend.routers.api_keys import oauth as oauth_api
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

    def __init__(self, c, headers, **register_extra):
        self.c, self.headers = c, headers
        resp = register(c, **register_extra)
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
        data = {
            "grant_type": "authorization_code",
            "code": code,
            "redirect_uri": redirect,
            "client_id": self.client_id,
            "code_verifier": verifier or self.verifier,
            "resource": RESOURCE,
        }
        if "client_secret" in self.client:  # a public client has none
            data["client_secret"] = self.client["client_secret"]
        return self.c.post("/token", data=data)

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
        assert set(info) == {
            "client_name",
            "redirect_host",
            "redirect_uri",
            "may_approve",
            "default_permissions",
        }
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

    def test_a_grant_can_be_renamed_and_keeps_its_client_name(
        self, client, oauth_client, admin_headers
    ):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        listed = client.get("/api/api-keys", headers=admin_headers).json()
        app = next(k for k in listed if k["kind"] == "app" and k["name"] == "Claude")
        resp = client.patch(
            f"/api/api-keys/{app['id']}", json={"name": "Claude (work)"}, headers=admin_headers
        )
        assert resp.status_code == 200, resp.text
        listed = client.get("/api/api-keys", headers=admin_headers).json()
        renamed = next(k for k in listed if k["id"] == app["id"])
        assert renamed["name"] == "Claude (work)"
        assert renamed["client_name"] == "Claude"
        assert mcp(oauth_client, tokens["access_token"]).status_code == 200

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
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_request"

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
        assert resp.status_code == 400
        assert resp.json()["error"] == "invalid_target"


class TestAuthorizeNeverBouncesAway:
    """Registration is open, so a client's redirect address is anyone's: a
    refused /authorize answers here instead of sending the browser there."""

    EVIL = "https://evil.example/phish"

    @pytest.mark.parametrize(
        "extra, error",
        [
            ({"scope": "bogus"}, "invalid_scope"),
            ({"resource": "https://x.example/"}, "invalid_target"),
            ({"code_challenge_method": "plain"}, "invalid_request"),
        ],
    )
    def test_a_refused_request_is_a_400_not_a_redirect(self, oauth_client, extra, error):
        client_id = register(oauth_client, redirect=self.EVIL).json()["client_id"]
        _, challenge = _pkce()
        resp = authorize(oauth_client, client_id, challenge, redirect=self.EVIL, **extra)
        assert resp.status_code == 400, resp.headers.get("location")
        assert "location" not in resp.headers
        assert "set-cookie" not in resp.headers
        assert resp.json()["error"] == error

    def test_too_many_waiting_sign_ins_is_a_400_too(self, oauth_client, monkeypatch):
        from backend.mcp_oauth import codes

        monkeypatch.setattr(codes, "MAX_PENDING_PER_CLIENT", 1)
        client_id = register(oauth_client, redirect=self.EVIL).json()["client_id"]
        _, challenge = _pkce()
        assert authorize(oauth_client, client_id, challenge, redirect=self.EVIL).status_code == 302
        resp = authorize(oauth_client, client_id, challenge, redirect=self.EVIL)
        assert resp.status_code == 400 and "location" not in resp.headers
        assert resp.json()["error"] == "temporarily_unavailable"

    def test_a_good_request_still_goes_to_the_consent_page(self, oauth_client):
        client_id = register(oauth_client, redirect=self.EVIL).json()["client_id"]
        _, challenge = _pkce()
        resp = authorize(oauth_client, client_id, challenge, redirect=self.EVIL)
        assert resp.status_code == 302
        assert urlsplit(resp.headers["location"]).path == "/oauth/consent"

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


class TestBrowserBinding:
    """A request answers only in the browser that called /authorize (issue #942).

    Extra protection only: an /authorize link sent to someone starts a request
    bound to their browser instead (see codes.py).
    """

    PATHS = ("", "/approve", "/deny")

    @staticmethod
    def answer(c, rid, path, headers):
        url = f"/api/oauth/requests/{rid}{path}"
        if path:
            return c.post(url, json={}, headers=headers)
        return c.get(url, headers=headers)

    @staticmethod
    def name(rid, secure=False):
        return codes.browser_cookie_name(rid, secure)

    @pytest.mark.parametrize("cookie", [None, "wrong", "w" * 43])
    def test_another_browser_gets_the_expired_404(self, oauth_client, admin_headers, cookie):
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        other = TestClient(oauth_client.app)
        if cookie is not None:
            other.cookies.set(self.name(rid), cookie)
        for path in self.PATHS:
            resp = self.answer(other, rid, path, admin_headers)
            assert resp.status_code == 404, (path, resp.text)
            assert resp.json()["detail"] == oauth_api.GONE
        # Still waiting, for the browser that started it.
        assert self.answer(oauth_client, rid, "", admin_headers).status_code == 200
        assert flow.approve(rid)

    def test_the_same_cookie_in_another_client_works(self, oauth_client, admin_headers):
        # The cookie is the binding, not anything else about the connection.
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        other = TestClient(oauth_client.app)
        other.cookies.set(self.name(rid), oauth_client.cookies.get(self.name(rid)))
        assert self.answer(other, rid, "", admin_headers).status_code == 200

    def test_another_requests_cookie_does_not_answer(self, oauth_client, admin_headers):
        # Each request has a cookie of its own: one request's value, presented
        # under another's name, is still a 404.
        first, second = Flow(oauth_client, admin_headers), Flow(oauth_client, admin_headers)
        rid1, rid2 = first.request_id(), second.request_id()
        other = TestClient(oauth_client.app)
        other.cookies.set(self.name(rid2), oauth_client.cookies.get(self.name(rid1)))
        assert self.answer(other, rid2, "", admin_headers).status_code == 404

    def test_a_new_sign_in_never_replaces_a_waiting_ones_cookie(self, oauth_client, admin_headers):
        # A form POST from another site carries none of this site's Lax
        # cookies; the new request's cookie has its own name, so the first
        # request's cookie survives it.
        first, second = Flow(oauth_client, admin_headers), Flow(oauth_client, admin_headers)
        rid1 = first.request_id()
        value1 = oauth_client.cookies.get(self.name(rid1))
        stranger = TestClient(oauth_client.app)
        resp = stranger.post(
            "/authorize",
            data={
                "response_type": "code",
                "client_id": second.client_id,
                "redirect_uri": REDIRECT,
                "code_challenge": second.challenge,
                "code_challenge_method": "S256",
                "state": "st-123",
                "resource": RESOURCE,
            },
            follow_redirects=False,
        )
        assert resp.status_code == 302, resp.text
        rid2 = parse_qs(urlsplit(resp.headers["location"]).query)["request"][0]
        assert resp.headers["set-cookie"].startswith(f"{self.name(rid2)}=")
        assert self.name(rid1) != self.name(rid2)
        # The browser keeps both, and both requests can be answered.
        oauth_client.cookies.set(self.name(rid2), stranger.cookies.get(self.name(rid2)))
        assert oauth_client.cookies.get(self.name(rid1)) == value1
        assert first.exchange(first.approve(rid1)).status_code == 200
        assert second.exchange(second.approve(rid2)).status_code == 200

    def test_the_cookie_flags(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        resp = authorize(oauth_client, flow.client_id, flow.challenge)
        assert resp.status_code == 302
        rid = parse_qs(urlsplit(resp.headers["location"]).query)["request"][0]
        cookie = resp.headers["set-cookie"]
        assert cookie.startswith(f"{codes.BROWSER_COOKIE_PREFIX}{digest(rid)[:16]}=")
        for flag in ("HttpOnly", "SameSite=Lax", "Path=/;", "Max-Age=600"):
            assert flag in cookie
        assert "Domain" not in cookie
        # Plain http, where Secure would drop the cookie: no Secure, no __Host-.
        assert "Secure" not in cookie

    def test_over_https_the_cookie_is_secure_and_host_only(self, oauth_client, admin_headers):
        # HTTPS seen at the request, as auth.cookie_secure decides for every
        # other cookie, though BASE_URL here is plain http on loopback.
        browser = TestClient(oauth_client.app, base_url="https://testserver")
        flow = Flow(browser, admin_headers)
        resp = authorize(browser, flow.client_id, flow.challenge)
        assert resp.status_code == 302
        rid = parse_qs(urlsplit(resp.headers["location"]).query)["request"][0]
        cookie = resp.headers["set-cookie"]
        assert cookie.startswith(f"__Host-{self.name(rid)}=")
        assert "; Secure" in cookie and "Path=/;" in cookie and "Domain" not in cookie
        assert self.answer(browser, rid, "", admin_headers).status_code == 200

    def test_over_https_a_cookie_without_the_host_prefix_is_ignored(
        self, oauth_client, admin_headers
    ):
        # The unprefixed name is one a site on a sibling domain could plant.
        browser = TestClient(oauth_client.app, base_url="https://testserver")
        flow = Flow(browser, admin_headers)
        resp = authorize(browser, flow.client_id, flow.challenge)
        rid = parse_qs(urlsplit(resp.headers["location"]).query)["request"][0]
        value = browser.cookies.get(f"__Host-{self.name(rid)}")
        planted = TestClient(oauth_client.app, base_url="https://testserver")
        planted.cookies.set(self.name(rid), value)
        assert self.answer(planted, rid, "", admin_headers).status_code == 404

    def test_only_the_cookies_hash_is_stored(self, oauth_client, admin_headers):
        rid = Flow(oauth_client, admin_headers).request_id()
        value = oauth_client.cookies.get(self.name(rid))
        db = SessionLocal()
        try:
            row = db.query(OAuthCode).filter_by(request_hash=digest(rid)).one()
        finally:
            db.close()
        assert row.params.get("browser") == digest(value)
        assert value not in str(row.params)

    def test_a_request_without_a_binding_cannot_be_answered(self, oauth_client, admin_headers):
        # Requests stored before this change have no "browser": they lapse.
        flow = Flow(oauth_client, admin_headers)
        rid = flow.request_id()
        db = SessionLocal()
        try:
            row = db.query(OAuthCode).filter_by(request_hash=digest(rid)).one()
            row.params = {k: v for k, v in row.params.items() if k != "browser"}
            db.commit()
        finally:
            db.close()
        for path in self.PATHS:
            assert self.answer(oauth_client, rid, path, admin_headers).status_code == 404


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

    def test_a_public_client_revokes_without_a_secret(self, oauth_client, admin_headers):
        """A client registered without a secret sends none; it can still revoke."""
        flow = Flow(oauth_client, admin_headers, token_endpoint_auth_method="none")
        assert "client_secret" not in flow.client
        tokens = flow.tokens()
        resp = oauth_client.post(
            "/revoke", data={"token": tokens["access_token"], "client_id": flow.client_id}
        )
        assert resp.status_code == 200, resp.text
        assert mcp(oauth_client, tokens["access_token"]).status_code == 401

    def test_a_confidential_client_still_needs_its_secret(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers)
        tokens = flow.tokens()
        resp = oauth_client.post(
            "/revoke", data={"token": tokens["access_token"], "client_id": flow.client_id}
        )
        assert resp.status_code == 401, resp.text
        assert mcp(oauth_client, tokens["access_token"]).status_code == 200

    def test_a_basic_auth_client_revokes_without_a_form_secret(self, oauth_client, admin_headers):
        flow = Flow(oauth_client, admin_headers, token_endpoint_auth_method="client_secret_basic")
        secret = flow.client["client_secret"]
        code = flow.approve()
        basic = base64.b64encode(f"{flow.client_id}:{secret}".encode()).decode()
        resp = oauth_client.post(
            "/token",
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": REDIRECT,
                "client_id": flow.client_id,
                "code_verifier": flow.verifier,
                "resource": RESOURCE,
            },
            headers={"Authorization": f"Basic {basic}"},
        )
        assert resp.status_code == 200, resp.text
        tokens = resp.json()
        resp = oauth_client.post(
            "/revoke",
            data={"token": tokens["access_token"], "client_id": flow.client_id},
            headers={"Authorization": f"Basic {basic}"},
        )
        assert resp.status_code == 200, resp.text
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

    def test_a_host_dropped_from_the_allow_list_can_no_longer_sign_in(
        self, oauth_client, monkeypatch
    ):
        evil = "https://evil.example/cb"
        client_id = register(oauth_client, redirect=evil).json()["client_id"]
        monkeypatch.setattr(config, "MCP_OAUTH_REDIRECT_HOSTS", ["claude.ai"])
        _, challenge = _pkce()
        resp = authorize(oauth_client, client_id, challenge, redirect=evil)
        assert resp.status_code == 400 and "location" not in resp.headers
        assert resp.json()["error"] == "invalid_request"

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

    def test_an_expired_sign_in_request_no_longer_keeps_its_client(
        self, oauth_client, admin_headers
    ):
        two_hours_ago = datetime.datetime.now(datetime.timezone.utc) - datetime.timedelta(hours=2)
        abandoned = Flow(oauth_client, admin_headers)
        abandoned.request_id()
        set_columns(OAuthCode, {"client_id": abandoned.client_id}, expires_at=PAST)
        set_columns(OAuthClient, {"client_id": abandoned.client_id}, created_at=two_hours_ago)
        assert register(oauth_client).status_code == 201
        # Gone after an hour like one that never started, not kept for a day.
        assert abandoned.client_id not in self._remaining()

    def test_a_lapsed_grant_is_deleted_and_a_live_one_kept(self, oauth_client, admin_headers):
        lapsed, live = Flow(oauth_client, admin_headers), Flow(oauth_client, admin_headers)
        lapsed.tokens()
        live.tokens()
        set_columns(ApiKey, {"client_id": lapsed.client_id}, refresh_expires_at=PAST)
        assert register(oauth_client).status_code == 201
        assert grant_row(client_id=lapsed.client_id) is None
        assert grant_row(client_id=live.client_id) is not None

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
