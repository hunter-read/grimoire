"""OpenID Connect (OIDC) endpoint handlers.

Implements the authorization-code + PKCE flow against any standards-compliant
IdP (Keycloak, Authentik, Authelia, Auth0, Okta, etc.).

The IdP is configured at runtime via Settings → Authentication. Each individual
field can be locked by an environment variable; see backend/config.py.
"""
import json
import secrets
from typing import Optional
from urllib.parse import urlencode

import httpx
from fastapi import Depends, HTTPException, Query
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from ...auth import CurrentUser, create_token, require_admin, set_auth_cookie
from ...config import get_db
from ..settings._helpers import (
    _get_raw,
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
    _state_store,
    _try_endpoint,
    _validate_id_token,
    logger,
)
from ._schemas import DiscoverRequest


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
        raise HTTPException(502, f"Failed to fetch discovery document: {e}") from e
    except json.JSONDecodeError as e:
        raise HTTPException(502, f"Invalid discovery document: {e}") from e

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


def oidc_login(
    return_to: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    raw = _get_raw(db)

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
    verifier, challenge = _pkce_pair()
    _state_store.put(
        state,
        {"nonce": nonce, "code_verifier": verifier, "return_to": return_to or "/"},
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
    return RedirectResponse(f"{auth_url}?{urlencode(params)}", status_code=302)


def _redirect_with_error(msg: str) -> RedirectResponse:
    return RedirectResponse(f"/login?oidc_error={msg}", status_code=302)


def oidc_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
    db: Session = Depends(get_db),
):
    if error:
        # IdP refused before we even got a code (user denied, mis-config, etc.)
        return _redirect_with_error(error_description or error)
    if not code or not state:
        return _redirect_with_error("missing code or state")

    saved = _state_store.pop(state)
    if not saved:
        return _redirect_with_error("invalid or expired login state")

    raw = _get_raw(db)
    eff = oidc_effective(raw)
    secret = oidc_effective_client_secret(raw)

    if not oidc_is_configured(raw):
        return _redirect_with_error("OIDC is not configured")

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
        logger.warning("OIDC id_token validation failed: %s", e)
        return _redirect_with_error(str(e))

    # Resolve / fetch userinfo (some IdPs put groups only in /userinfo)
    userinfo = _fetch_userinfo(
        eff["oidc_userinfo_endpoint"]
        or _try_endpoint(eff["oidc_issuer_url"], "userinfo_endpoint"),
        access_token,
    )
    # Merge: claims wins for stable identifiers; userinfo wins for richer
    # claims that aren't in the ID token (groups, etc.).
    merged: dict = dict(claims)
    for k, v in (userinfo or {}).items():
        merged.setdefault(k, v)
        if k in (
            "groups",
            "roles",
            "email",
            eff["oidc_groups_claim"],
            eff["oidc_permissions_claim"],
        ):
            merged[k] = v  # prefer userinfo for these

    # Resolve user
    try:
        user = _resolve_user(db, merged, eff)
    except _OIDCError as e:
        logger.info("OIDC login rejected: %s", e)
        return _redirect_with_error(str(e))

    token = create_token(user.id, user.username, user.role)
    # Hand the token to the frontend via the URL fragment so it isn't
    # logged by intermediate proxies. Also set the session cookie so
    # <img>/download GETs authenticate without the JWT in the URL.
    return_to = saved.get("return_to") or "/"
    if not return_to.startswith("/"):
        return_to = "/"
    resp = RedirectResponse(f"{return_to}#oidc_token={token}", status_code=302)
    set_auth_cookie(resp, token)
    return resp
