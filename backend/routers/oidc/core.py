"""OpenID Connect (OIDC) endpoint handlers.

Implements the authorization-code + PKCE flow against any standards-compliant
IdP (Keycloak, Authentik, Authelia, Auth0, Okta, etc.).

The IdP is configured at runtime via Settings → Authentication. Each individual
field can be locked by an environment variable; see backend/config/env.py.
"""
import hmac
import json
import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ...auth import (
    CurrentUser,
    cookie_secure,
    create_token,
    require_admin,
    set_auth_cookie,
    set_refresh_cookie,
)
from ...security import limiter
from ...sessions import create_session
from ...services.user_activity import note_sign_in
from ...config import get_db, release_connection
from .._client import client_ip, client_user_agent
from ...services.app_settings import (
    get_raw,
    oidc_effective,
    oidc_effective_client_secret,
    oidc_is_configured,
    oidc_redirect_uri,
)
from ._helpers import (
    _OIDCError,
    _discover_issuer,
    _fetch_userinfo,
    _pkce_pair,
    _resolve_user,
    _safe_return_to,
    _state_store,
    _try_endpoint,
    _validate_id_token,
    logger,
)
from ._schemas import DiscoverRequest
from ._state import _STATE_TTL


# Starting a sign-in stores state server-side before anything is checked, so
# it is rate limited per address. Generous: auto-launch and a retry or two are
# a handful of calls.
OIDC_LOGIN_RATE_LIMIT = "30/minute"

# Ties a sign-in to the browser that started it. The state in the callback URL
# alone would let anyone who started a sign-in hand the unused callback link to
# someone else, signing them in to the starter's account. Lax so the IdP's
# top-level redirect back carries it; scoped to the OIDC routes, and as
# short-lived as the state itself.
OIDC_FLOW_COOKIE = "grimoire_oidc_flow"
OIDC_FLOW_COOKIE_PATH = "/api/auth/openid"


def _set_flow_cookie(response: Response, value: str, request: Request) -> None:
    response.set_cookie(
        OIDC_FLOW_COOKIE,
        value,
        max_age=_STATE_TTL,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path=OIDC_FLOW_COOKIE_PATH,
    )


def _clear_flow_cookie(response: Response, request: Optional[Request]) -> None:
    response.delete_cookie(
        OIDC_FLOW_COOKIE,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path=OIDC_FLOW_COOKIE_PATH,
    )


def _same_browser(request: Request, saved: dict) -> bool:
    """Whether this callback comes from the browser that started the sign-in."""
    expected = saved.get("browser")
    presented = request.cookies.get(OIDC_FLOW_COOKIE)
    if not isinstance(expected, str) or not expected or not presented:
        return False
    return hmac.compare_digest(expected.encode(), presented.encode())


def discover(data: DiscoverRequest, _: CurrentUser = Depends(require_admin)):
    issuer = (data.issuer_url or "").strip().rstrip("/")
    if not issuer:
        raise HTTPException(400, "Issuer URL is required")
    if not (issuer.startswith("https://") or issuer.startswith("http://")):
        raise HTTPException(400, "Issuer URL must start with http:// or https://")

    if issuer.endswith("/.well-known/openid-configuration"):
        url = issuer
    else:
        url = f"{issuer}/.well-known/openid-configuration"
    try:
        resp = httpx.get(url, timeout=10.0, follow_redirects=True)
        resp.raise_for_status()
        doc = resp.json()
    except httpx.HTTPError as e:
        logger.warning("OIDC discovery fetch from %s failed: %s", url, e)
        raise HTTPException(
            502,
            "Could not fetch the discovery document from that issuer URL. "
            "The server log has the details.",
        ) from e
    except json.JSONDecodeError as e:
        logger.warning("OIDC discovery document from %s is not JSON: %s", url, e)
        raise HTTPException(
            502, "That issuer URL did not return a valid discovery document."
        ) from e

    return {
        "issuer": doc.get("issuer", ""),
        "authorization_endpoint": doc.get("authorization_endpoint", ""),
        "token_endpoint": doc.get("token_endpoint", ""),
        "userinfo_endpoint": doc.get("userinfo_endpoint", ""),
        "jwks_uri": doc.get("jwks_uri", ""),
        "end_session_endpoint": doc.get("end_session_endpoint", ""),
        "id_token_signing_alg_values_supported": doc.get(
            "id_token_signing_alg_values_supported", []
        ),
    }


@limiter.limit(OIDC_LOGIN_RATE_LIMIT)
def oidc_login(
    request: Request,
    return_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    raw = get_raw(db)

    if not oidc_is_configured(raw):
        raise HTTPException(503, "OIDC is not configured")

    eff = oidc_effective(raw)
    auth_url = eff["oidc_authorization_endpoint"] or _try_endpoint(
        eff["oidc_issuer_url"], "authorization_endpoint"
    )
    if not auth_url:
        raise HTTPException(500, "OIDC authorization endpoint is not configured")

    state = secrets.token_urlsafe(24)
    nonce = secrets.token_urlsafe(24)
    browser = secrets.token_urlsafe(32)
    verifier, challenge = _pkce_pair()
    _state_store.put(
        state,
        {
            "nonce": nonce,
            "code_verifier": verifier,
            "return_to": _safe_return_to(return_to),
            "browser": browser,
        },
    )

    scopes = ["openid", "email", "profile"]
    if eff["oidc_groups_claim"]:
        # Request both the generic "groups" scope and the configured claim name
        # as a scope — IdPs like Authentik map claims to scopes by name.
        scopes.append("groups")
        if eff["oidc_groups_claim"] not in scopes:
            scopes.append(eff["oidc_groups_claim"])
    if eff["oidc_permissions_claim"] and eff["oidc_permissions_claim"] not in scopes:
        scopes.append(eff["oidc_permissions_claim"])

    params = {
        "response_type": "code",
        "client_id": eff["oidc_client_id"],
        "redirect_uri": oidc_redirect_uri(),
        "scope": " ".join(scopes),
        "state": state,
        "nonce": nonce,
        "code_challenge": challenge,
        "code_challenge_method": "S256",
    }
    resp = RedirectResponse(f"{auth_url}?{urlencode(params)}", status_code=302)
    _set_flow_cookie(resp, browser, request)
    return resp


# What the login page shows for each standard OAuth 2.0 / OIDC error code the
# IdP can send back (RFC 6749 §4.1.2.1, OIDC Core §3.1.2.6). The IdP's own
# error_description is logged, never shown: anyone can hand a user a callback
# link, so nothing from the query string reaches the page as text.
_IDP_ERRORS = {
    "access_denied": "sign-in was cancelled or refused at the identity provider",
    "login_required": "the identity provider needs you to sign in again",
    "interaction_required": "the identity provider needs you to sign in again",
    "consent_required": "the identity provider needs your consent first",
    "account_selection_required": "choose an account at the identity provider",
    "temporarily_unavailable": "the identity provider is temporarily unavailable",
    "server_error": "the identity provider reported an error",
}
_IDP_ERROR_FALLBACK = "the identity provider refused the sign-in"


def _redirect_with_error(msg: str) -> RedirectResponse:
    return RedirectResponse(f"/login?{urlencode({'oidc_error': msg})}", status_code=302)


def merge_userinfo(claims: dict, userinfo: Optional[dict], eff: dict) -> dict:
    """The ID token's claims with what the userinfo response adds.

    Userinfo is discarded when its ``sub`` is not the ID token's (OIDC Core
    §5.3.2): it would describe someone else. Otherwise the ID token wins for
    everything except group, role and permission claims, which some IdPs only
    put in userinfo. ``email`` and ``email_verified`` always come together from
    one response - the ID token when it carries an email, else userinfo - so an
    address is never paired with another response's verified flag. Email
    matching and syncing rely on that pairing.
    """
    merged: dict = dict(claims)
    if not userinfo:
        return merged
    if userinfo.get("sub") != claims.get("sub"):
        logger.warning("OIDC userinfo ignored: its sub does not match the ID token's")
        return merged
    prefer = {"groups", "roles", eff["oidc_groups_claim"], eff["oidc_permissions_claim"]}
    for k, v in userinfo.items():
        if k in ("email", "email_verified"):
            continue
        if k in prefer:
            merged[k] = v
        else:
            merged.setdefault(k, v)
    if not claims.get("email"):
        merged.pop("email_verified", None)
        for k in ("email", "email_verified"):
            if k in userinfo:
                merged[k] = userinfo[k]
    return merged


def oidc_callback(
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    resp = _finish_sign_in(request, code, state, error, error_description, db)
    # The flow cookie is spent whichever way the sign-in went.
    _clear_flow_cookie(resp, request)
    return resp


def _finish_sign_in(
    request: Request,
    code: Optional[str],
    state: Optional[str],
    error: Optional[str],
    error_description: Optional[str],
    db: Session,
) -> RedirectResponse:
    # The state is checked (and spent) before anything else, the IdP's error
    # included, so a callback link this server did not start a sign-in for is
    # refused the same way whatever else it carries.
    saved = _state_store.pop(state) if state else None
    if not saved:
        return _redirect_with_error(
            "invalid or expired login state" if state else "missing code or state"
        )
    if not _same_browser(request, saved):
        # A callback link opened in a browser other than the one that went to
        # the provider. Its state is spent, so the link is now dead.
        logger.warning("OIDC callback refused: it did not come from the browser that started it")
        return _redirect_with_error("sign-in was started in another browser - please try again")
    if error:
        # IdP refused before we even got a code (user denied, mis-config, etc.)
        logger.info("OIDC provider returned %s: %s", error, error_description or "")
        return _redirect_with_error(_IDP_ERRORS.get(error, _IDP_ERROR_FALLBACK))
    if not code:
        return _redirect_with_error("missing code or state")

    raw = get_raw(db)
    eff = oidc_effective(raw)
    secret = oidc_effective_client_secret(raw)

    if not oidc_is_configured(raw):
        return _redirect_with_error("OIDC is not configured")
    # The calls to the provider below can take seconds each; don't hold a
    # pooled connection through them (issue #701).
    release_connection(db)

    token_url = eff["oidc_token_endpoint"] or _try_endpoint(
        eff["oidc_issuer_url"], "token_endpoint"
    )
    if not token_url:
        return _redirect_with_error("token endpoint not configured")

    # Token exchange
    try:
        token_resp = httpx.post(
            token_url,
            data={
                "grant_type": "authorization_code",
                "code": code,
                "redirect_uri": oidc_redirect_uri(),
                "client_id": eff["oidc_client_id"],
                "client_secret": secret,
                "code_verifier": saved["code_verifier"],
            },
            timeout=15.0,
        )
        token_resp.raise_for_status()
        tokens = token_resp.json()
    except httpx.HTTPError as e:
        logger.warning("OIDC token exchange failed: %s", e)
        return _redirect_with_error("token exchange failed")

    id_token = tokens.get("id_token")
    access_token = tokens.get("access_token")
    if not id_token:
        return _redirect_with_error("no id_token returned")

    # Validate ID token — use the explicit token_issuer when set, otherwise
    # fetch the canonical issuer from the discovery doc so the iss claim
    # matches exactly regardless of what the admin typed as the issuer URL.
    token_issuer = eff["oidc_token_issuer"] or _discover_issuer(eff["oidc_issuer_url"])
    try:
        claims = _validate_id_token(
            id_token,
            issuer=token_issuer,
            client_id=eff["oidc_client_id"],
            jwks_uri=eff["oidc_jwks_uri"]
            or _try_endpoint(eff["oidc_issuer_url"], "jwks_uri"),
            expected_nonce=saved["nonce"],
            allowed_alg=eff["oidc_signing_alg"],
        )
    except _OIDCError as e:
        # The reason stays in the log: it can name the identity provider's
        # hosts or carry network errors, and this redirect is shown to anyone.
        logger.warning("OIDC id_token validation failed: %s", e)
        return _redirect_with_error(e.public or "the sign-in could not be verified")

    # Resolve / fetch userinfo (some IdPs put groups only in /userinfo)
    userinfo = _fetch_userinfo(
        eff["oidc_userinfo_endpoint"]
        or _try_endpoint(eff["oidc_issuer_url"], "userinfo_endpoint"),
        access_token,
    )
    merged = merge_userinfo(claims, userinfo, eff)

    # Resolve user
    try:
        user = _resolve_user(db, merged, eff)
    except _OIDCError as e:
        logger.info("OIDC login rejected: %s", e)
        return _redirect_with_error(str(e))

    # OIDC logins get a real session like every other login path, so they are
    # equally revocable (issue #157).
    session, refresh_token = create_session(
        db,
        user.id,
        origin="oidc",
        user_agent=client_user_agent(request),
        # Read like a password sign-in's, so Active Sessions shows where it
        # came from (X-Forwarded-For only from a trusted proxy).
        ip_address=client_ip(request),
    )
    note_sign_in(user.username, "oidc")
    token = create_token(user.id, user.username, user.role, session_id=session.id)
    # No token rides on the redirect: a token in the URL lands in browser
    # history, and the login page used to accept one from any link. The SPA
    # resumes the session from the HttpOnly refresh cookie set here, exactly as
    # it does for a returning user; the session cookie lets <img>/download GETs
    # authenticate meanwhile. return_to is re-validated in case anything odd
    # ended up in the state store.
    return_to = _safe_return_to(saved.get("return_to"))
    resp = RedirectResponse(return_to, status_code=302)
    set_auth_cookie(resp, token, request)
    set_refresh_cookie(resp, refresh_token, request)
    return resp
