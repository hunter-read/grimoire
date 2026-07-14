"""ID-token validation, userinfo fetch, and user-resolution helpers."""
import base64
import hashlib
import logging
import secrets
import time
import warnings
from typing import Optional

import httpx

with warnings.catch_warnings():
    # Authlib 1.x exposes JOSE under authlib.jose. They've started warning that
    # it'll move to a separate `joserfc` package before Authlib 2.0 — until then
    # the current path is the supported import. Silence the deprecation noise.
    warnings.simplefilter("ignore")
    from authlib.jose import jwt as joseju  # noqa: E402
    from authlib.jose.errors import JoseError  # noqa: E402

from ...models import User


logger = logging.getLogger("grimoire.oidc")


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


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for S256 PKCE."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _discovery_doc(issuer: str) -> dict:
    """Fetch and return the OpenID Connect discovery document, or {} on failure."""
    if not issuer:
        return {}
    issuer = issuer.strip()
    if issuer.endswith("/.well-known/openid-configuration"):
        url = issuer
    else:
        url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    try:
        resp = httpx.get(url, timeout=5.0, follow_redirects=True)
        if resp.status_code == 200:
            return resp.json() or {}
    except httpx.HTTPError as e:
        # Discovery is best-effort (caller falls back to configured endpoints),
        # but log so a misconfigured/unreachable issuer is diagnosable.
        logger.warning("OIDC discovery fetch failed for %s: %s", url, e)
    return {}


def _try_endpoint(issuer: str, key: str) -> str:
    """Best-effort discovery fallback for a missing endpoint."""
    return _discovery_doc(issuer).get(key, "") or ""


def _discover_issuer(issuer_url: str) -> str:
    """Return the canonical issuer from the discovery document, falling back to issuer_url."""
    return _discovery_doc(issuer_url).get("issuer", "") or issuer_url


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
                "iss": {"essential": True, "value": issuer},
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
                    "iss": {"essential": True, "value": issuer},
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
        if "campaignAccess" in perms:
            user.campaign_access = bool(perms["campaignAccess"])

    db.commit()
    db.refresh(user)
    return user
