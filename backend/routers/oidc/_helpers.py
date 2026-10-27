"""ID-token validation, userinfo fetch, and user-resolution helpers."""
import base64
import hashlib
import logging
import secrets
import time
import warnings
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from sqlalchemy import or_

with warnings.catch_warnings():
    # Authlib 1.x exposes JOSE under authlib.jose. They've started warning that
    # it'll move to a separate `joserfc` package before Authlib 2.0 — until then
    # the current path is the supported import. Silence the deprecation noise.
    warnings.simplefilter("ignore")
    from authlib.jose import JsonWebToken  # noqa: E402
    from authlib.jose.errors import JoseError  # noqa: E402

from ...models import User
from ...usernames import match_username, username_taken
from ..settings._helpers import _VALID_SIGNING_ALGS
from ._state import _jwks_cache, _state_store  # noqa: F401  (re-exported)


logger = logging.getLogger("grimoire.oidc")


def _pkce_pair() -> tuple[str, str]:
    """Return (code_verifier, code_challenge) for S256 PKCE."""
    verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(verifier.encode("ascii")).digest()
    challenge = base64.urlsafe_b64encode(digest).rstrip(b"=").decode("ascii")
    return verifier, challenge


def _safe_return_to(value: Optional[str]) -> str:
    """Return ``value`` if it is a same-origin path, else ``"/"``.

    The callback redirects to ``return_to`` straight after setting the session
    cookies, so anything a browser could resolve to another origin would make
    the sign-in an open redirect (and, before the token left the URL, handed
    that origin the token). A bare ``startswith("/")`` is not enough: ``//evil.example`` is
    protocol-relative, browsers treat ``\\`` as ``/`` (so ``/\\evil.example``
    is too), and they strip tabs/newlines anywhere in a URL (so
    ``/\\t/evil.example`` collapses to ``//evil.example``).
    """
    if not value or not value.startswith("/") or len(value) > 2048:
        return "/"
    if value[1:2] in ("/", "\\"):
        return "/"
    # Reject backslashes, control characters and whitespace outright rather
    # than reasoning about how each browser normalises them.
    if any(c == "\\" or c == "#" or ord(c) < 0x21 or ord(c) == 0x7F for c in value):
        return "/"
    parts = urlsplit(value)
    if parts.scheme or parts.netloc:
        return "/"
    return value


# Discovery documents fetched recently, by URL: (fetched at, document). Without
# it, every sign-in on an instance with only the issuer configured fetched the
# document again, once per endpoint looked up. Failures are not cached.
_DISCOVERY_TTL = 3600  # seconds
_discovery_cache: dict[str, tuple[float, dict]] = {}


def _discovery_doc(issuer: str) -> dict:
    """Fetch and return the OpenID Connect discovery document, or {} on failure."""
    if not issuer:
        return {}
    issuer = issuer.strip()
    if issuer.endswith("/.well-known/openid-configuration"):
        url = issuer
    else:
        url = f"{issuer.rstrip('/')}/.well-known/openid-configuration"
    cached = _discovery_cache.get(url)
    if cached and time.monotonic() - cached[0] < _DISCOVERY_TTL:
        return cached[1]
    try:
        resp = httpx.get(url, timeout=5.0, follow_redirects=True)
        if resp.status_code == 200:
            doc = resp.json() or {}
            if isinstance(doc, dict) and doc:
                _discovery_cache[url] = (time.monotonic(), doc)
            return doc
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
    """A sign-in that can't go ahead.

    ``str(e)`` is for the server log. ``public`` is what the login page may
    show, set only for messages that are safe and useful to anyone - a setting
    to fix, say - and None where the detail belongs in the log alone.
    """

    def __init__(self, message: str, public: Optional[str] = None) -> None:
        super().__init__(message)
        self.public = public


def _get_jwks(jwks_uri: str, force: bool = False) -> dict:
    """Return the IdP's signing keys, from cache unless ``force`` (key rotation)."""
    if not force:
        cached = _jwks_cache.get(jwks_uri)
        if cached is not None:
            return cached
    try:
        resp = httpx.get(jwks_uri, timeout=10.0, follow_redirects=True)
        resp.raise_for_status()
        keys = resp.json()
    except httpx.HTTPError as e:
        raise _OIDCError(f"jwks fetch failed: {e}") from e
    _jwks_cache.set(jwks_uri, keys)
    return keys


# What decoding a token can raise. Authlib reports most problems as JoseError,
# but a key that doesn't fit the token's algorithm (an HS256 token checked
# against RSA keys, say) surfaces as ValueError, TypeError or KeyError.
_DECODE_ERRORS = (JoseError, ValueError, TypeError, KeyError)


def _decode(id_token: str, keys: dict, alg: str, claims_options: dict) -> Any:
    """Verify ``id_token`` against ``keys``, accepting only the ``alg`` algorithm.

    Pinned rather than taken from the token's header, so a token in any other
    algorithm - ``none`` included - is refused before its signature is looked at.
    """
    return JsonWebToken([alg]).decode(id_token, keys, claims_options=claims_options)


def _validate_id_token(
    id_token: str,
    *,
    issuer: str,
    client_id: str,
    jwks_uri: str,
    expected_nonce: str,
    allowed_alg: str,
) -> dict:
    if allowed_alg not in _VALID_SIGNING_ALGS:
        # HS256 used to be offered, but a shared-secret token can't be checked
        # against the provider's published keys, so it could never sign in.
        unsupported = (
            f"signing algorithm {allowed_alg or '(none)'} is not supported - "
            "choose RS256 or another listed algorithm in Settings"
        )
        raise _OIDCError(unsupported, public=unsupported)
    if not jwks_uri:
        raise _OIDCError("jwks uri is not configured", public="jwks uri is not configured")

    claims_options = {
        "iss": {"essential": True, "value": issuer},
        "aud": {"essential": True, "value": client_id},
        "exp": {"essential": True},
    }
    keys = _get_jwks(jwks_uri)
    try:
        claims = _decode(id_token, keys, allowed_alg, claims_options)
    except _DECODE_ERRORS:
        # Try once with a forced JWKS refresh — handles key rotation.
        keys = _get_jwks(jwks_uri, force=True)
        try:
            claims = _decode(id_token, keys, allowed_alg, claims_options)
        except _DECODE_ERRORS as e:
            raise _OIDCError(f"id_token signature invalid: {e}") from e

    # validate() raises on expired/invalid claims
    try:
        claims.validate(leeway=30)
    except JoseError as e:
        raise _OIDCError(f"id_token claims invalid: {e}") from e

    # Algorithm check (defense-in-depth - _decode already accepts only allowed_alg)
    header = claims.header or {}
    alg = header.get("alg")
    if allowed_alg and alg and alg != allowed_alg:
        raise _OIDCError(f"id_token alg {alg} != configured {allowed_alg}")

    if claims.get("nonce") != expected_nonce:
        raise _OIDCError("id_token nonce mismatch")

    # OIDC Core §3.1.3.7: a token for several audiences must name us as the
    # party it was issued to, and an azp that is present must be us.
    aud = claims.get("aud")
    azp = claims.get("azp")
    if (isinstance(aud, list) and len(aud) > 1 and azp is None) or (
        azp is not None and azp != client_id
    ):
        raise _OIDCError("id_token azp does not name this client")

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
# The group each role comes from unless an admin names another one.
DEFAULT_ROLE_GROUPS = {"admin": "admin", "gm": "gm", "player": "player"}


def role_group_names(eff: dict) -> dict[str, str]:
    """The group name each role is granted by, from the effective OIDC settings."""
    return {
        role: (eff.get(f"oidc_{role}_group") or "").strip() or default
        for role, default in DEFAULT_ROLE_GROUPS.items()
    }


def _group_key(name: str) -> str:
    """How a group name is compared: case-insensitively, and with Keycloak's
    leading slash dropped from a top-level group's full path (``/admin``).

    Only one leading slash, and only when nothing else in the name is a path
    separator - ``/team/admin`` is a subgroup of ``team``, not ``admin``.
    """
    key = name.strip().casefold()
    if key.startswith("/") and "/" not in key[1:]:
        key = key[1:]
    return key


def _role_from_groups(
    claims: dict, groups_claim: str, group_names: Optional[dict[str, str]] = None
) -> Optional[str]:
    """Return the highest-priority role found in the configured groups claim, or None.

    A group grants a role only when its name is exactly the one configured for
    that role (``group_names``, default ``admin``/``gm``/``player``), ignoring
    case and Keycloak's leading ``/`` on a top-level group. Names that merely
    end in a role name (``jellyfin-admin``, ``/media/admin``) belong to other
    applications and grant nothing.
    """
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

    names = role_group_names(
        {f"oidc_{role}_group": name for role, name in (group_names or {}).items()}
    )
    wanted = {role: _group_key(name) for role, name in names.items()}
    present = {_group_key(g) for g in groups}

    best: Optional[str] = None
    best_rank = 0
    for role, key in wanted.items():
        if key in present and _ROLE_PRIORITY[role] > best_rank:
            best, best_rank = role, _ROLE_PRIORITY[role]
    return best


def _permissions_from_claim(claims: dict, perm_claim: str) -> Optional[dict]:
    """Pull the permissions object from a configured claim. Returns None if unset."""
    if not perm_claim:
        return None
    val = claims.get(perm_claim)
    if not isinstance(val, dict):
        return None
    return val


def _email_verified(claims: dict) -> bool:
    """Whether the provider vouches for the email claim, for account matching.

    A provider that reports ``email_verified`` as false is saying the address
    was never confirmed, so it can't identify an existing account. Providers
    that omit the claim entirely (Entra ID, for one) are taken at their word,
    as before.
    """
    if "email_verified" not in claims:
        return True
    value = claims.get("email_verified")
    if isinstance(value, str):
        return value.strip().lower() == "true"
    return value is True


def _resolve_user(db, claims: dict, eff: dict) -> User:
    """Find or create the local user from the validated OIDC claims.

    Raises _OIDCError if access is denied (no group match, auto-register off, etc.).
    """
    sub = str(claims.get("sub") or "").strip()
    if not sub:
        raise _OIDCError("id_token missing sub claim")

    email = (claims.get("email") or "").strip().lower() or None
    # Only the provider's login name is used to find an existing account; the
    # looser display fields below are just for naming a newly registered one.
    login_name = str(claims.get("preferred_username") or "").strip() or None
    preferred_username = (
        login_name
        or claims.get("nickname")
        or claims.get("name")
        or (email.split("@")[0] if email else None)
    )

    # 1. Identity match: subject is the most stable identifier.
    user = db.query(User).filter_by(oidc_subject=sub).first()

    # 2. Existing-user matching (admin-configured). This links an account to
    # the provider for the first time, so it only considers accounts that are
    # not linked yet and are full accounts rather than campaign guests.
    if user is None and eff["oidc_match_by"] in ("email", "username"):
        unlinked = db.query(User).filter(
            User.oidc_subject.is_(None), User.is_guest.is_not(True)
        )
        if eff["oidc_match_by"] == "email" and email and _email_verified(claims):
            user = unlinked.filter(User.email == email).first()
        elif eff["oidc_match_by"] == "username" and login_name:
            # Most providers let people pick their own login name, so a name
            # alone never links an admin account: whoever registered "admin"
            # at the provider would sign in as Grimoire's admin.
            user = match_username(
                unlinked.filter(or_(User.role.is_(None), User.role != "admin")), login_name
            )

    # 3. Group-based role (returns None if no groups claim configured)
    role_from_groups = _role_from_groups(
        claims, eff["oidc_groups_claim"], role_group_names(eff)
    )
    if eff["oidc_groups_claim"] and role_from_groups is None:
        # Groups claim is configured but the user is in none of the role groups.
        raise _OIDCError("no matching group in OIDC claims")

    # 4. Permissions claim (returns None when unset)
    perms = _permissions_from_claim(claims, eff["oidc_permissions_claim"])
    if eff["oidc_permissions_claim"] and perms is None:
        # Per spec: missing claim → access denied
        raise _OIDCError("permissions claim missing from OIDC response")

    created = user is None
    if user is None:
        if not eff["oidc_auto_register"]:
            raise _OIDCError("no matching user and auto-register is disabled")
        # Username collision avoidance
        username = preferred_username or f"oidc-{sub[:8]}"
        if username_taken(db, username):
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
        if email and user.email != email and _email_verified(claims):
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
        if "viewNSFW" in perms or created:
            # The provider decides, so the user can't override a "no". A new
            # account whose claim leaves viewNSFW out gets a "no" too, so
            # explicit content stays opt-in; an existing one keeps its value.
            user.allow_explicit = bool(perms.get("viewNSFW", False))
            user.explicit_locked = not user.allow_explicit
        if "campaignAccess" in perms:
            user.campaign_access = bool(perms["campaignAccess"])
        if "apiKeys" in perms:
            user.api_keys_enabled = bool(perms["apiKeys"])

    db.commit()
    db.refresh(user)
    return user
