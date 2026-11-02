"""End-to-end OIDC sign-in against a mock identity provider.

The other OIDC tests patch out token validation. These run the whole
authorization-code + PKCE flow instead, with nothing patched but the network:
the mock IdP below serves discovery, JWKS, token and userinfo endpoints, checks
the client secret, redirect URI and PKCE verifier like a real one, and signs
RS256 ID tokens that Grimoire validates with its normal code path.
"""
import base64
import hashlib
import json
import time
import uuid
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest
from joserfc import jwt
from joserfc.jwk import OctKey, RSAKey

from backend.config import SessionLocal
from backend.models import User

CLIENT_ID = "grimoire-test"
CLIENT_SECRET = "mock-idp-secret"


class MockIdP:
    """Just enough of an OpenID provider to sign someone in."""

    def __init__(self):
        self.issuer = f"https://idp-{uuid.uuid4().hex[:8]}.test/realm"
        self.jwk = RSAKey.generate_key(2048, parameters={"kid": "k1", "use": "sig"})
        self.codes: dict[str, dict] = {}
        self.access_tokens: dict[str, dict] = {}
        # Claims for the next sign-in; tests change these.
        self.id_claims: dict = {}
        self.userinfo: dict = {}
        self.token_requests: list[dict] = []

    # --- the "browser" half: what the authorize endpoint would do ----------

    def authorize(self, location: str) -> dict:
        """Read Grimoire's authorize redirect and issue a code for it."""
        parts = urlsplit(location)
        assert f"{parts.scheme}://{parts.netloc}{parts.path}" == f"{self.issuer}/auth"
        q = {k: v[0] for k, v in parse_qs(parts.query).items()}
        assert q["response_type"] == "code"
        assert q["client_id"] == CLIENT_ID
        assert q["code_challenge_method"] == "S256"
        assert "openid" in q["scope"].split()
        code = uuid.uuid4().hex
        self.codes[code] = q
        return {"code": code, "state": q["state"]}

    # --- the back channel ------------------------------------------------

    def get(self, url, headers=None, **_):
        if url == f"{self.issuer}/.well-known/openid-configuration":
            return self._json(url, {
                "issuer": self.issuer,
                "authorization_endpoint": f"{self.issuer}/auth",
                "token_endpoint": f"{self.issuer}/token",
                "userinfo_endpoint": f"{self.issuer}/userinfo",
                "jwks_uri": f"{self.issuer}/jwks",
                "id_token_signing_alg_values_supported": ["RS256"],
            })
        if url == f"{self.issuer}/jwks":
            return self._json(url, {"keys": [self.jwk.as_dict(private=False)]})
        if url == f"{self.issuer}/userinfo":
            bearer = (headers or {}).get("Authorization", "")
            if not bearer.startswith("Bearer ") or bearer[7:] not in self.access_tokens:
                return httpx.Response(401, request=httpx.Request("GET", url))
            return self._json(url, self.userinfo)
        raise AssertionError(f"unexpected GET {url}")

    def post(self, url, data=None, **_):
        assert url == f"{self.issuer}/token", url
        self.token_requests.append(dict(data))
        req = self.codes.pop(data["code"], None)
        if (
            req is None
            or data["grant_type"] != "authorization_code"
            or data["client_id"] != CLIENT_ID
            or data["client_secret"] != CLIENT_SECRET
            or data["redirect_uri"] != req["redirect_uri"]
            or _s256(data["code_verifier"]) != req["code_challenge"]
        ):
            return self._json(url, {"error": "invalid_grant"}, status=400, method="POST")
        now = int(time.time())
        claims = {
            "iss": self.issuer,
            "aud": CLIENT_ID,
            "iat": now,
            "exp": now + 300,
            "nonce": req["nonce"],
            **self.id_claims,
        }
        id_token = jwt.encode({"alg": "RS256", "kid": "k1"}, claims, self.jwk)
        access = uuid.uuid4().hex
        self.access_tokens[access] = claims
        return self._json(
            url, {"id_token": id_token, "access_token": access, "token_type": "Bearer"},
            method="POST",
        )

    @staticmethod
    def _json(url, body, status=200, method="GET"):
        return httpx.Response(status, json=body, request=httpx.Request(method, url))


def _s256(verifier: str) -> str:
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    return base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")


def _set_cookies(resp) -> str:
    return " ".join(v for k, v in resp.headers.multi_items() if k.lower() == "set-cookie")


@pytest.fixture
def idp(client, admin_headers, monkeypatch):
    mock = MockIdP()
    # Only the outbound calls are faked; TestClient goes through its own
    # httpx.Client, not these module-level functions.
    monkeypatch.setattr(httpx, "get", mock.get)
    monkeypatch.setattr(httpx, "post", mock.post)
    resp = client.patch(
        "/api/settings",
        headers=admin_headers,
        json={
            # Only the issuer: every endpoint comes from discovery.
            "oidc_enabled": True,
            "oidc_issuer_url": mock.issuer,
            "oidc_authorization_endpoint": "",
            "oidc_token_endpoint": "",
            "oidc_userinfo_endpoint": "",
            "oidc_jwks_uri": "",
            "oidc_client_id": CLIENT_ID,
            "oidc_client_secret": CLIENT_SECRET,
            "oidc_signing_alg": "RS256",
            "oidc_auto_register": True,
            "oidc_match_by": "email",
            "oidc_groups_claim": "",
        },
    )
    assert resp.status_code == 200, resp.text
    yield mock
    client.patch(
        "/api/settings",
        headers=admin_headers,
        json={
            "oidc_enabled": False,
            "oidc_issuer_url": "",
            "oidc_client_id": "",
            "oidc_client_secret": "__CLEAR__",
            "oidc_auto_register": False,
            "oidc_match_by": "none",
            "oidc_groups_claim": "",
        },
    )


def _sign_in(client, idp, return_to="/library"):
    """Run the browser's side of the flow; returns the callback response."""
    start = client.get(
        "/api/auth/openid/login", params={"return_to": return_to}, follow_redirects=False
    )
    assert start.status_code == 302, start.text
    grant = idp.authorize(start.headers["location"])
    return client.get("/api/auth/openid/callback", params=grant, follow_redirects=False)


def _user_by_sub(sub):
    db = SessionLocal()
    try:
        return db.query(User).filter_by(oidc_subject=sub).first()
    finally:
        db.close()


class TestMockIdPSignIn:
    def test_full_flow_signs_in_without_a_token_in_the_url(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        email = f"{sub}@example.com"
        idp.id_claims = {"sub": sub, "email": email, "email_verified": True,
                         "preferred_username": sub}
        idp.userinfo = {"sub": sub, "name": "Mock Person"}

        cb = _sign_in(client, idp)

        assert cb.status_code == 302
        # Straight back to where the sign-in started, with nothing in the URL.
        assert cb.headers["location"] == "/library"
        cookies = _set_cookies(cb)
        assert "grimoire_session=" in cookies and "grimoire_refresh=" in cookies
        # PKCE: Grimoire sent a verifier that matched its challenge.
        assert idp.token_requests[-1]["code_verifier"]

        # What the SPA does on landing: resume the session from the cookie.
        refreshed = client.post("/api/auth/refresh")
        assert refreshed.status_code == 200, refreshed.text
        token = refreshed.json()["token"]
        me = client.get("/api/auth/me", headers={"Authorization": f"Bearer {token}"})
        assert me.status_code == 200
        assert me.json()["username"] == sub
        assert me.json()["email"] == email

    def test_session_records_the_client_address(self, client, idp):
        """Active Sessions shows where an SSO sign-in came from, like a
        password one: the client's address, read through a trusted proxy."""
        from backend.models import AuthSession

        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        grant = idp.authorize(start.headers["location"])
        cb = client.get(
            "/api/auth/openid/callback",
            params=grant,
            headers={"X-Forwarded-For": "198.51.100.23", "User-Agent": "MockBrowser/1.0"},
            follow_redirects=False,
        )
        assert cb.headers["location"] == "/"
        user = _user_by_sub(sub)
        db = SessionLocal()
        try:
            session = db.query(AuthSession).filter_by(user_id=user.id).one()
            assert session.origin == "oidc"
            assert session.ip_address == "198.51.100.23"
            assert session.user_agent == "MockBrowser/1.0"
        finally:
            db.close()

    def test_second_sign_in_finds_the_same_account(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "email": f"{sub}@example.com", "preferred_username": sub}
        idp.userinfo = {"sub": sub}
        assert _sign_in(client, idp).status_code == 302
        first = _user_by_sub(sub)
        client.cookies.clear()
        assert _sign_in(client, idp).status_code == 302
        assert _user_by_sub(sub).id == first.id

    def test_session_cookie_authenticates_reads_but_not_writes(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        idp.userinfo = {"sub": sub}
        assert _sign_in(client, idp).status_code == 302
        # The cookie is for <img>/download GETs...
        assert client.get("/api/auth/me").status_code == 200
        # ...and is not enough for a change.
        resp = client.patch("/api/users/me/preferences", json={"theme": "dark"})
        assert resp.status_code == 401

    def test_replayed_code_is_refused(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub}
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        grant = idp.authorize(start.headers["location"])
        assert client.get(
            "/api/auth/openid/callback", params=grant, follow_redirects=False
        ).headers["location"] == "/"
        again = client.get("/api/auth/openid/callback", params=grant, follow_redirects=False)
        assert again.headers["location"].startswith("/login?oidc_error=")

    def test_tampered_id_token_is_refused(self, client, idp, monkeypatch):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub}
        real_post = idp.post

        def tamper(url, data=None, **kw):
            resp = real_post(url, data=data, **kw)
            body = resp.json()
            head, payload, sig = body["id_token"].split(".")
            body["id_token"] = ".".join([head, payload, sig[::-1]])
            return MockIdP._json(url, body, method="POST")

        monkeypatch.setattr(httpx, "post", tamper)
        cb = _sign_in(client, idp)
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert _user_by_sub(sub) is None

    def _resign(self, monkeypatch, idp, make_token):
        """Have the token endpoint hand back an ID token built by ``make_token``
        from the claims it would have signed."""
        real_post = idp.post

        def resigned(url, data=None, **kw):
            resp = real_post(url, data=data, **kw)
            body = resp.json()
            payload = body["id_token"].split(".")[1]
            claims = json.loads(base64.urlsafe_b64decode(payload + "=" * (-len(payload) % 4)))
            body["id_token"] = make_token(claims)
            return MockIdP._json(url, body, method="POST")

        monkeypatch.setattr(httpx, "post", resigned)

    def test_hs256_token_is_refused_cleanly(self, client, idp, monkeypatch):
        """A token signed with a shared secret can't be checked against the
        provider's published keys; it is a sign-in error, not a server error."""
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub}
        self._resign(
            monkeypatch,
            idp,
            lambda claims: jwt.encode(
                {"alg": "HS256", "kid": "k1"}, claims, OctKey.import_key(CLIENT_SECRET)
            ),
        )
        cb = _sign_in(client, idp)
        assert cb.status_code == 302
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert _user_by_sub(sub) is None

    def test_unsigned_token_is_refused(self, client, idp, monkeypatch):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub}

        def unsigned(claims):
            def part(obj):
                raw = json.dumps(obj).encode()
                return base64.urlsafe_b64encode(raw).rstrip(b"=").decode()

            return f"{part({'alg': 'none'})}.{part(claims)}."

        self._resign(monkeypatch, idp, unsigned)
        cb = _sign_in(client, idp)
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert _user_by_sub(sub) is None

    def test_token_in_another_listed_algorithm_is_refused(self, client, idp, monkeypatch):
        """Verification is pinned to the configured algorithm (RS256 here): a
        validly signed RS512 token from the same key is still refused."""
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub}
        self._resign(
            monkeypatch,
            idp,
            lambda claims: jwt.encode(
                {"alg": "RS512", "kid": "k1"}, claims, idp.jwk, algorithms=["RS512"]
            ),
        )
        cb = _sign_in(client, idp)
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert _user_by_sub(sub) is None

    def test_a_stored_hs256_setting_fails_with_a_clear_message(self, client, idp):
        """HS256 can't be chosen any more, but an instance that saved it before
        gets a sign-in error saying what to change, not a server error."""
        from backend.models import AppSetting

        db = SessionLocal()
        try:
            db.query(AppSetting).filter_by(key="oidc_signing_alg").one().value = "HS256"
            db.commit()
        finally:
            db.close()
        try:
            idp.id_claims = {"sub": f"sub-{uuid.uuid4().hex[:8]}"}
            cb = _sign_in(client, idp)
            assert cb.status_code == 302
            assert "not+supported" in cb.headers["location"]
        finally:
            db = SessionLocal()
            try:
                db.query(AppSetting).filter_by(key="oidc_signing_alg").one().value = "RS256"
                db.commit()
            finally:
                db.close()

    def test_idp_denial_shows_a_fixed_message(self, client, idp):
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        state = parse_qs(urlsplit(start.headers["location"]).query)["state"][0]
        cb = client.get(
            "/api/auth/openid/callback",
            params={"state": state, "error": "access_denied",
                    "error_description": "#oidc_token=planted"},
            follow_redirects=False,
        )
        location = cb.headers["location"]
        assert location.startswith("/login?oidc_error=")
        assert "#" not in location and "planted" not in location


class TestMockIdPUserinfo:
    def test_userinfo_for_another_subject_is_ignored(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        idp.userinfo = {"sub": "someone-else", "email": f"other-{sub}@example.com",
                        "email_verified": True}
        assert _sign_in(client, idp).status_code == 302
        assert _user_by_sub(sub).email is None

    def test_unverified_userinfo_email_does_not_borrow_the_id_tokens_flag(
        self, client, admin_headers, idp
    ):
        # An unlinked local account the attacker would like to take over.
        victim = f"victim-{uuid.uuid4().hex[:6]}"
        created = client.post(
            "/api/users",
            headers=admin_headers,
            json={"username": victim, "password": "victimpass12", "role": "player",
                  "email": f"{victim}@example.com"},
        )
        assert created.status_code in (200, 201), created.text

        sub = f"sub-{uuid.uuid4().hex[:8]}"
        # The ID token carries no email but says "verified"; userinfo carries
        # the victim's address, unverified.
        idp.id_claims = {"sub": sub, "email_verified": True, "preferred_username": sub}
        idp.userinfo = {"sub": sub, "email": f"{victim}@example.com", "email_verified": False}
        assert _sign_in(client, idp).status_code == 302
        linked = _user_by_sub(sub)
        assert linked.username != victim

    def test_userinfo_email_used_when_id_token_has_none(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        idp.userinfo = {"sub": sub, "email": f"{sub}@example.com", "email_verified": True}
        assert _sign_in(client, idp).status_code == 302
        assert _user_by_sub(sub).email == f"{sub}@example.com"


class TestMockIdPBrowserBinding:
    """A sign-in finishes only in the browser that started it."""

    def test_login_sets_a_short_lived_flow_cookie(self, client, idp):
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        cookie = _set_cookies(start).lower()
        assert "grimoire_oidc_flow=" in cookie
        assert "httponly" in cookie
        assert "samesite=lax" in cookie
        assert "path=/api/auth/openid" in cookie
        assert "max-age=600" in cookie
        # Plain http here, so not Secure...
        assert "secure" not in cookie
        # ...but over https (as told by a trusted proxy) it is.
        secure = client.get(
            "/api/auth/openid/login",
            headers={"X-Forwarded-Proto": "https"},
            follow_redirects=False,
        )
        assert "secure" in _set_cookies(secure).lower()
        client.cookies.delete("grimoire_oidc_flow")

    def test_callback_without_the_cookie_is_refused(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        grant = idp.authorize(start.headers["location"])
        # Someone else's browser: it never visited /openid/login.
        client.cookies.delete("grimoire_oidc_flow")
        cb = client.get("/api/auth/openid/callback", params=grant, follow_redirects=False)
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert "grimoire_session=" not in _set_cookies(cb)
        assert _user_by_sub(sub) is None
        # Nothing was exchanged with the provider for it.
        assert grant["code"] in idp.codes

    def test_callback_with_another_flows_cookie_is_refused(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        start = client.get("/api/auth/openid/login", follow_redirects=False)
        grant = idp.authorize(start.headers["location"])
        client.cookies.delete("grimoire_oidc_flow")
        client.cookies.set("grimoire_oidc_flow", "from-a-different-sign-in")
        try:
            cb = client.get("/api/auth/openid/callback", params=grant, follow_redirects=False)
        finally:
            client.cookies.delete("grimoire_oidc_flow")
        assert cb.headers["location"].startswith("/login?oidc_error=")
        assert _user_by_sub(sub) is None

    def test_the_flow_cookie_is_cleared_after_the_callback(self, client, idp):
        sub = f"sub-{uuid.uuid4().hex[:8]}"
        idp.id_claims = {"sub": sub, "preferred_username": sub}
        cb = _sign_in(client, idp)
        assert cb.headers["location"] == "/library"
        cleared = [c for c in _set_cookies(cb).split("grimoire_") if c.startswith("oidc_flow=")]
        assert cleared and "max-age=0" in cleared[0].lower()
        assert "grimoire_oidc_flow" not in client.cookies
