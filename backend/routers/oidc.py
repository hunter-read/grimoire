"""OpenID Connect (OIDC) authentication.

Implements the authorization-code + PKCE flow against any standards-compliant
IdP (Keycloak, Authentik, Authelia, Auth0, Okta, etc.).

The IdP is configured at runtime via Settings → Authentication. Each individual
field can be locked by an environment variable; see backend/config.py.
"""
import json
import logging
import secrets
import time
from typing import Optional
from urllib.parse import urlencode

import warnings

import httpx

with warnings.catch_warnings():
    # Authlib 1.x exposes JOSE under authlib.jose. They've started warning that
    # it'll move to a separate `joserfc` package before Authlib 2.0 — until then
    # the current path is the supported import. Silence the deprecation noise.
    warnings.simplefilter("ignore")
    from authlib.jose import jwt as joseju  # noqa: E402
    from authlib.jose.errors import JoseError  # noqa: E402
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import RedirectResponse
from pydantic import BaseModel

from ..config import SessionLocal
from ..models import User
from ..auth import require_admin, CurrentUser, create_token
from .settings._helpers import (
    _get_raw,
    oidc_effective,
    oidc_effective_client_secret,
    oidc_redirect_uri,
    oidc_is_configured,
)


logger = logging.getLogger("grimoire.oidc")

router = APIRouter(prefix="/auth/openid", tags=["auth"])
public_router = APIRouter(prefix="/api/auth/openid", tags=["auth"])


# ---------------------------------------------------------------------------
# Discovery — admin-only autopopulate
# ---------------------------------------------------------------------------


class DiscoverRequest(BaseModel):
    issuer_url: str


@router.post(
    "/discover",
    summary="Fetch OIDC discovery document",
    description=(
        "Admin-only. Fetches `.well-known/openid-configuration` from the issuer "
        "URL and returns the relevant endpoint URLs so the admin UI can autofill "
        "the form. The server makes the request so the browser does not hit a "
        "CORS wall."
    ),
)
def discover(data: DiscoverRequest, _: CurrentUser = Depends(require_admin)):
    issuer = (data.issuer_url or "").strip().rstrip("/")
    if not issuer:
        raise HTTPException(400, "Issuer URL is required")
    if not (issuer.startswith("https://") or issuer.startswith("http://")):
        raise HTTPException(400, "Issuer URL must start with http:// or https://")

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


# ---------------------------------------------------------------------------
# In-memory state store
# ---------------------------------------------------------------------------
# We store the per-flow state (nonce, code_verifier, optional return-to URL)
# in process memory keyed by the OAuth `state` value. For a single-replica
# deployment this is sufficient. Entries expire after 10 minutes.

_STATE_TTL = 600  # seconds


class _StateStore:
    def __init__(self):
        self._d: dict[str, dict] = {}

    def put(self, state: str, payload: dict) -> None:
        payload["_ts"] = time.time()
        self._d[state] = payload
        self._gc()

    def pop(self, state: str) -> Optional[dict]:
        self._gc()
        return self._d.pop(state, None)

    def _gc(self) -> None:
        cutoff = time.time() - _STATE_TTL
        for k, v in list(self._d.items()):
            if v.get("_ts", 0) < cutoff:
                self._d.pop(k, None)


_state_store = _StateStore()


# ---------------------------------------------------------------------------
# Login start — redirect to the IdP
# ---------------------------------------------------------------------------


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for S256 PKCE."""
    import base64
    import hashlib

    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


@public_router.get(
    "/login",
    summary="Start an OIDC login",
    description="Redirects the user-agent to the IdP authorization endpoint.",
)
def oidc_login(request: Request, return_to: Optional[str] = Query(None)):
    db = SessionLocal()
    try:
        raw = _get_raw(db)
    finally:
        db.close()

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
        # Some IdPs (Keycloak, Authentik) expose groups via a dedicated scope;
        # asking for it is harmless if unsupported.
        scopes.append("groups")

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


def _try_endpoint(issuer: str, key: str) -> str:
    """Best-effort discovery fallback for a missing endpoint."""
    if not issuer:
        return ""
    try:
        resp = httpx.get(
            f"{issuer.rstrip('/')}/.well-known/openid-configuration",
            timeout=5.0,
            follow_redirects=True,
        )
        if resp.status_code == 200:
            return resp.json().get(key, "") or ""
    except httpx.HTTPError:
        pass
    return ""


# ---------------------------------------------------------------------------
# Callback — exchange code, validate ID token, find/create user, mint JWT
# ---------------------------------------------------------------------------


@public_router.get(
    "/callback",
    summary="OIDC callback",
    description=(
        "Receives the authorization code from the IdP, exchanges it for tokens, "
        "validates the ID token, resolves or creates the local user, and "
        "redirects to the frontend with a one-time grimoire token."
    ),
)
def oidc_callback(
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
):
    if error:
        # IdP refused before we even got a code (user denied, mis-config, etc.)
        return _redirect_with_error(error_description or error)
    if not code or not state:
        return _redirect_with_error("missing code or state")

    saved = _state_store.pop(state)
    if not saved:
        return _redirect_with_error("invalid or expired login state")

    db = SessionLocal()
    try:
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

        # Validate ID token
        try:
            claims = _validate_id_token(
                id_token,
                issuer=eff["oidc_issuer_url"],
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
            if k in ("groups", "roles", "email", eff["oidc_groups_claim"], eff["oidc_permissions_claim"]):
                merged[k] = v  # prefer userinfo for these

        # Resolve user
        try:
            user = _resolve_user(db, merged, eff)
        except _OIDCError as e:
            logger.info("OIDC login rejected: %s", e)
            return _redirect_with_error(str(e))

        token = create_token(user.id, user.username, user.role)
        # Hand the token to the frontend via the URL fragment so it isn't
        # logged by intermediate proxies.
        return_to = saved.get("return_to") or "/"
        if not return_to.startswith("/"):
            return_to = "/"
        return RedirectResponse(f"{return_to}#oidc_token={token}", status_code=302)
    finally:
        db.close()


def _redirect_with_error(msg: str) -> RedirectResponse:
    return RedirectResponse(f"/login?oidc_error={msg}", status_code=302)


# ---------------------------------------------------------------------------
# ID token validation
# ---------------------------------------------------------------------------


class _OIDCError(Exception):
    pass


# Cached JWKS — refreshed when key id is unknown.
_jwks_cache: dict[str, tuple[float, dict]] = {}


def _get_jwks(jwks_uri: str, force: bool = False) -> dict:
    cached = _jwks_cache.get(jwks_uri)
    if cached and not force and (time.time() - cached[0]) < 600:
        return cached[1]
    try:
        resp = httpx.get(jwks_uri, timeout=10.0, follow_redirects=True)
        resp.raise_for_status()
        keys = resp.json()
    except httpx.HTTPError as e:
        raise _OIDCError(f"jwks fetch failed: {e}") from e
    _jwks_cache[jwks_uri] = (time.time(), keys)
    return keys


def _validate_id_token(
    id_token: str,
    *,
    issuer: str,
    client_id: str,
    jwks_uri: str,
    expected_nonce: str,
    allowed_alg: str,
) -> dict:
    if not jwks_uri:
        raise _OIDCError("jwks uri is not configured")

    keys = _get_jwks(jwks_uri)
    try:
        claims = joseju.decode(
            id_token,
            keys,
            claims_options={
                "iss": {"essential": True, "value": issuer.rstrip("/")},
                "aud": {"essential": True, "value": client_id},
                "exp": {"essential": True},
            },
        )
    except JoseError:
        # Try once with a forced JWKS refresh — handles key rotation.
        keys = _get_jwks(jwks_uri, force=True)
        try:
            claims = joseju.decode(
                id_token,
                keys,
                claims_options={
                    "iss": {"essential": True, "value": issuer.rstrip("/")},
                    "aud": {"essential": True, "value": client_id},
                    "exp": {"essential": True},
                },
            )
        except JoseError as e:
            raise _OIDCError(f"id_token signature invalid: {e}") from e

    # validate() raises on expired/invalid claims
    try:
        claims.validate(leeway=30)
    except JoseError as e:
        raise _OIDCError(f"id_token claims invalid: {e}") from e

    # Algorithm check (defense-in-depth — joseju enforces signing already)
    header = claims.header or {}
    alg = header.get("alg")
    if allowed_alg and alg and alg != allowed_alg:
        raise _OIDCError(f"id_token alg {alg} != configured {allowed_alg}")

    if claims.get("nonce") != expected_nonce:
        raise _OIDCError("id_token nonce mismatch")

    return dict(claims)


def _fetch_userinfo(userinfo_url: Optional[str], access_token: Optional[str]) -> dict:
    if not userinfo_url or not access_token:
        return {}
    try:
        resp = httpx.get(
            userinfo_url,
            headers={"Authorization": f"Bearer {access_token}"},
            timeout=10.0,
            follow_redirects=True,
        )
        resp.raise_for_status()
        return resp.json() or {}
    except httpx.HTTPError as e:
        logger.warning("OIDC userinfo fetch failed: %s", e)
        return {}


# ---------------------------------------------------------------------------
# User resolution
# ---------------------------------------------------------------------------


_ROLE_PRIORITY = {"admin": 3, "gm": 2, "player": 1}


def _role_from_groups(claims: dict, groups_claim: str) -> Optional[str]:
    """Return the highest-priority role found in the configured groups claim, or None."""
    if not groups_claim:
        return None
    val = claims.get(groups_claim)
    if val is None:
        return None
    if isinstance(val, str):
        # Some IdPs return a comma- or space-separated string.
        groups = [g.strip() for g in val.replace(",", " ").split() if g.strip()]
    elif isinstance(val, list):
        groups = [str(g) for g in val]
    else:
        return None

    best: Optional[str] = None
    best_rank = 0
    for g in groups:
        gl = g.lower()
        # Match directly, or strip common prefix (e.g. "/admin", "grimoire-admin")
        for role in ("admin", "gm", "player"):
            if gl == role or gl.endswith(f"/{role}") or gl.endswith(f"-{role}"):
                rank = _ROLE_PRIORITY[role]
                if rank > best_rank:
                    best, best_rank = role, rank
    return best


def _permissions_from_claim(claims: dict, perm_claim: str) -> Optional[dict]:
    """Pull the permissions object from a configured claim. Returns None if unset."""
    if not perm_claim:
        return None
    val = claims.get(perm_claim)
    if not isinstance(val, dict):
        return None
    return val


def _resolve_user(db, claims: dict, eff: dict) -> User:
    """Find or create the local user from the validated OIDC claims.

    Raises _OIDCError if access is denied (no group match, auto-register off, etc.).
    """
    sub = str(claims.get("sub") or "").strip()
    if not sub:
        raise _OIDCError("id_token missing sub claim")

    email = (claims.get("email") or "").strip().lower() or None
    preferred_username = (
        claims.get("preferred_username")
        or claims.get("nickname")
        or claims.get("name")
        or (email.split("@")[0] if email else None)
    )

    # 1. Identity match: subject is the most stable identifier.
    user = db.query(User).filter_by(oidc_subject=sub).first()

    # 2. Existing-user matching (admin-configured)
    if user is None and eff["oidc_match_by"] == "email" and email:
        user = db.query(User).filter_by(email=email).first()
    if user is None and eff["oidc_match_by"] == "username" and preferred_username:
        user = db.query(User).filter_by(username=preferred_username).first()

    # 3. Group-based role (returns None if no groups claim configured)
    role_from_groups = _role_from_groups(claims, eff["oidc_groups_claim"])
    if eff["oidc_groups_claim"] and role_from_groups is None:
        # Groups claim is configured but the user has none of admin/gm/player.
        raise _OIDCError("no matching group in OIDC claims")

    # 4. Permissions claim (returns None when unset)
    perms = _permissions_from_claim(claims, eff["oidc_permissions_claim"])
    if eff["oidc_permissions_claim"] and perms is None:
        # Per spec: missing claim → access denied
        raise _OIDCError("permissions claim missing from OIDC response")

    if user is None:
        if not eff["oidc_auto_register"]:
            raise _OIDCError("no matching user and auto-register is disabled")
        # Username collision avoidance
        username = preferred_username or f"oidc-{sub[:8]}"
        if db.query(User).filter_by(username=username).first():
            username = f"{username}-{sub[:6]}"
        # Email collision avoidance: drop the email rather than fail registration
        if email and db.query(User).filter_by(email=email).first():
            email = None
        user = User(
            username=username,
            email=email,
            oidc_subject=sub,
            hashed_password=None,
            role=role_from_groups or "player",
        )
        db.add(user)
    else:
        # Re-link the OIDC subject if this is the first time matching
        if not user.oidc_subject:
            user.oidc_subject = sub
        if email and user.email != email:
            # Only update email if it doesn't conflict
            existing = db.query(User).filter_by(email=email).first()
            if existing is None or existing.id == user.id:
                user.email = email

    # Re-sync role from groups on every login when the claim is configured
    if eff["oidc_groups_claim"] and role_from_groups:
        # Demoting the last admin would lock the system; we still apply the
        # change but only if it doesn't violate that invariant.
        if user.role == "admin" and role_from_groups != "admin":
            admin_count = db.query(User).filter_by(role="admin").count()
            if admin_count > 1:
                user.role = role_from_groups
        else:
            user.role = role_from_groups

    # Permissions claim → per-field user state
    if perms is not None:
        if "viewNSFW" in perms:
            user.allow_explicit = bool(perms["viewNSFW"])

    db.commit()
    db.refresh(user)
    return user
