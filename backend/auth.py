"""Authentication utilities for Grimoire."""

import os
import datetime
import logging
import secrets
import stat
import threading
from typing import Any, Optional

import jwt
from fastapi import Cookie, Depends, Header, HTTPException, Request, Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from passlib.context import CryptContext

logger = logging.getLogger("grimoire.auth")

# Keys that must never sign real tokens: the historical hardcoded fallback and
# the placeholder shipped in the example compose files. Both are published in
# this repo, so anyone could forge an admin JWT for an instance using them.
REJECTED_SECRET_KEYS = frozenset(
    {
        "grimoire-dev-secret-change-in-production",
        "change-me",
        "replace-this-with-a-long-random-string",
        # Example values that appeared in the install guide and the dev compose
        # file before those switched to generating a key.
        "zx7k2mQpR9nLwT4vBcYeHs3JuAoDfGiN",
        "7ba05239cdd5752065eb6bd5db866bf8a0919d2760b1fcf158744f5ef5833834",
    }
)

# Shorter keys still start (refusing them would break running installs), but
# get a warning at start-up: `openssl rand -hex 32` gives 64 characters.
RECOMMENDED_SECRET_KEY_LENGTH = 32

# Where a self-generated key is persisted when SECRET_KEY is unset, so tokens
# survive restarts. Lives under DATA_PATH, which is a persistent volume in every
# documented deployment.
SECRET_KEY_FILENAME = "secret_key"

ALGORITHM = "HS256"

# Kept as the *cookie* lifetime only. Access tokens themselves are short-lived
# (see backend/sessions.py); the session cookie outlives any single access token
# so that a browser returning after an idle period still presents something the
# refresh flow can replace, rather than looking logged out.
TOKEN_EXPIRE_DAYS = 30


class InsecureSecretKeyError(RuntimeError):
    """Raised at start-up when SECRET_KEY is set to a published placeholder."""


def _load_or_create_secret_key(data_path: str) -> str:
    """Return the persisted auto-generated key, creating it on first boot.

    Written 0600 and read back on later boots so sessions survive restarts.
    Multi-replica deployments must set SECRET_KEY explicitly — a key generated
    here is only shared between replicas if they share DATA_PATH.
    """
    key_path = os.path.join(data_path, SECRET_KEY_FILENAME)

    try:
        with open(key_path, "r", encoding="utf-8") as fh:
            existing = fh.read().strip()
        if existing:
            logger.info(
                "SECRET_KEY not set - using the auto-generated key at %s. "
                "Set SECRET_KEY explicitly if you run more than one replica.",
                key_path,
            )
            return existing
    except FileNotFoundError:
        pass
    except OSError as exc:
        raise InsecureSecretKeyError(
            f"SECRET_KEY is not set and the generated key at {key_path} could not "
            f"be read ({exc}). Set the SECRET_KEY environment variable "
            f"(generate one with: openssl rand -hex 32)."
        ) from exc

    generated = secrets.token_hex(32)
    try:
        os.makedirs(data_path, exist_ok=True)
        # Create 0600 up front so the key is never briefly world-readable.
        fd = os.open(key_path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(generated)
    except OSError as exc:
        raise InsecureSecretKeyError(
            f"SECRET_KEY is not set and a generated key could not be written to "
            f"{key_path} ({exc}). Set the SECRET_KEY environment variable "
            f"(generate one with: openssl rand -hex 32)."
        ) from exc

    logger.warning(
        "SECRET_KEY was not set - generated a random key and saved it to %s. "
        "Sessions will survive restarts as long as that file persists. Set "
        "SECRET_KEY explicitly if you run more than one replica.",
        key_path,
    )
    return generated


def resolve_secret_key(env_value: Optional[str], data_path: str) -> str:
    """Pick the JWT signing key, refusing to fall back to a published default.

    An explicit SECRET_KEY is used as-is unless it is one of the placeholders we
    publish; those raise rather than silently signing forgeable tokens. With no
    SECRET_KEY at all we generate one and persist it under DATA_PATH.
    """
    key = (env_value or "").strip()

    if not key:
        return _load_or_create_secret_key(data_path)

    if key in REJECTED_SECRET_KEYS:
        raise InsecureSecretKeyError(
            f"SECRET_KEY is set to {key!r}, a placeholder published in Grimoire's "
            f"own documentation - anyone could forge admin sessions on this "
            f"instance. Set SECRET_KEY to a private random value "
            f"(generate one with: openssl rand -hex 32), or unset it entirely to "
            f"let Grimoire generate and persist one under DATA_PATH."
        )

    if len(key) < RECOMMENDED_SECRET_KEY_LENGTH:
        logger.warning(
            "SECRET_KEY is shorter than recommended (32 characters or more). Use a "
            "long random value (generate one with: openssl rand -hex 32), or unset "
            "it to let Grimoire generate one. Changing it signs everyone out and "
            "ends existing feed URLs and share links."
        )

    return key


# The JWT signing key. Resolved on first use (see __getattr__ at the bottom)
# rather than at import, since resolving it may read or create a file under
# DATA_PATH; main.py's lifespan touches it so a bad key still fails start-up.
SECRET_KEY: str
# Two first-boot requests resolving at once would each generate and write a key.
_secret_key_lock = threading.Lock()


def _secret_key() -> str:
    key = globals().get("SECRET_KEY")
    if key is None:
        with _secret_key_lock:
            key = globals().get("SECRET_KEY")
            if key is None:
                key = resolve_secret_key(
                    os.environ.get("SECRET_KEY"),
                    os.environ.get("DATA_PATH", "./data"),
                )
                globals()["SECRET_KEY"] = key
    return key

# Name of the HttpOnly session cookie that carries the JWT. This lets
# <img>/download GETs authenticate without the token appearing in the URL
# (query params leak into proxy/access logs, Referer headers, and history).
AUTH_COOKIE_NAME = "grimoire_session"

# Mark the cookie Secure whenever the instance is served over HTTPS, so it is
# never sent over plaintext. An https:// BASE_URL settles it for every response;
# without one, each response decides from its own request (cookie_secure). A
# bare "http://" self-host (e.g. behind a LAN reverse proxy without TLS) still
# needs the cookie to be sent, so Secure is off there.
COOKIE_SECURE = os.environ.get("BASE_URL", "http://localhost:9481").lower().startswith(
    "https://"
)


def cookie_secure(request: Optional[Request] = None) -> bool:
    """Whether a cookie set in response to ``request`` should be Secure.

    BASE_URL used to be the only signal, so an HTTPS site behind a proxy with no
    BASE_URL set sent every auth cookie without Secure. Now the request counts
    too: HTTPS on the connection, or ``X-Forwarded-Proto: https`` from a trusted
    proxy (see ``security.request_is_https``).
    """
    if COOKIE_SECURE:
        return True
    from .security import request_is_https

    return request_is_https(request)

# bcrypt_sha256 pre-hashes with SHA-256 so passwords >72 chars are handled correctly
pwd_context = CryptContext(
    schemes=["bcrypt_sha256"],
    deprecated="auto",
)

bearer_scheme = HTTPBearer(auto_error=False)

ROLES = ("admin", "gm", "player", "guest")


def hash_password(password: str) -> str:
    return pwd_context.hash(password)


def verify_password(plain: str, hashed: Optional[str]) -> bool:
    """False for a user with no password (OIDC-only, guest): passlib treats a None hash as a miss."""
    return pwd_context.verify(plain, hashed)


# The ``typ`` claim of a session access token.
ACCESS_TOKEN_TYPE = "access"


def create_token(
    user_id: str,
    username: str,
    role: Optional[str],
    session_id: Optional[str] = None,
    expires_minutes: Optional[int] = None,
) -> str:
    """Mint a short-lived access token.

    ``session_id`` ties the token to the ``auth_sessions`` row it was issued
    under, so a token can be traced back to the session that produced it. It is
    optional so that callers which predate sessions still work, but every login
    path passes it.

    The token stays stateless — nothing here is checked against the database on
    the request path. Revocation works by cutting off the refresh that would
    renew it; see backend/sessions.py.
    """
    from .sessions import ACCESS_TOKEN_EXPIRE_MINUTES

    minutes = ACCESS_TOKEN_EXPIRE_MINUTES if expires_minutes is None else expires_minutes
    now = datetime.datetime.now(datetime.timezone.utc)
    payload = {
        # Names what the token is for, so a token minted for something else
        # under the same key can never pass as a session (see get_current_user).
        "typ": ACCESS_TOKEN_TYPE,
        "sub": str(user_id),
        "username": username,
        "role": role,
        "iat": now,
        # Per-token unique id: lets a specific token be identified in logs, and
        # leaves the door open to a denylist without another claim change.
        "jti": secrets.token_urlsafe(16),
        "exp": now + datetime.timedelta(minutes=minutes),
    }
    if session_id:
        payload["sid"] = str(session_id)
    return jwt.encode(payload, _secret_key(), algorithm=ALGORITHM)


def decode_token(token: str) -> dict:
    return jwt.decode(token, _secret_key(), algorithms=[ALGORITHM])


def set_auth_cookie(response: Response, token: str, request: Optional[Request] = None) -> None:
    """Attach the session JWT as an HttpOnly cookie on a login/setup response.

    HttpOnly keeps it out of reach of JS (XSS can't exfiltrate it); SameSite=Lax
    prevents it riding cross-site requests (CSRF) while still being sent on the
    top-level navigations that download links rely on; Secure is set when served
    over HTTPS (see ``cookie_secure``). Lifetime matches the JWT's own expiry.
    """
    response.set_cookie(
        AUTH_COOKIE_NAME,
        token,
        max_age=TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/",
    )


def clear_auth_cookie(response: Response, request: Optional[Request] = None) -> None:
    """Remove the session cookie (logout). Attributes must match set_auth_cookie
    so the browser matches and deletes the right cookie."""
    response.delete_cookie(
        AUTH_COOKIE_NAME,
        httponly=True,
        secure=cookie_secure(request),
        samesite="lax",
        path="/",
    )


def set_refresh_cookie(response: Response, token: str, request: Optional[Request] = None) -> None:
    """Attach the refresh token as an HttpOnly cookie.

    Scoped to ``/api/auth`` rather than ``/`` so the long-lived credential is
    only sent to the endpoints that consume it, instead of riding along on every
    API call, image load, and download. SameSite=Strict is safe here (unlike the
    session cookie, which needs Lax for download navigations) because the
    refresh endpoint is only ever called by our own XHR.
    """
    from .sessions import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH, REFRESH_TOKEN_EXPIRE_DAYS

    response.set_cookie(
        REFRESH_COOKIE_NAME,
        token,
        max_age=REFRESH_TOKEN_EXPIRE_DAYS * 24 * 60 * 60,
        httponly=True,
        secure=cookie_secure(request),
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )


def clear_refresh_cookie(response: Response, request: Optional[Request] = None) -> None:
    """Remove the refresh cookie. Attributes must match set_refresh_cookie."""
    from .sessions import REFRESH_COOKIE_NAME, REFRESH_COOKIE_PATH

    response.delete_cookie(
        REFRESH_COOKIE_NAME,
        httponly=True,
        secure=cookie_secure(request),
        samesite="strict",
        path=REFRESH_COOKIE_PATH,
    )


class CurrentUser:
    def __init__(
        self,
        id: str,
        username: str,
        role: str,
        session_id: Optional[str] = None,
        api_key_id: Optional[str] = None,
        key_permissions: Optional[dict[str, str]] = None,
    ):
        self.id = id
        self.username = username
        self.role = role
        # The auth_sessions row this token was issued under, when the token
        # carries a "sid" claim. None for tokens minted before sessions existed.
        self.session_id = session_id
        # Set when the request authenticated with an API key rather than a
        # session; ``id`` is then the key's owner.
        self.api_key_id = api_key_id
        # The key's own permission map, for a handler that reaches into another
        # area than its route's (a share link to a book). None for a session.
        self.key_permissions = key_permissions

    @property
    def is_api_key(self) -> bool:
        return self.api_key_id is not None


# Methods on which the session cookie may stand in for the Authorization
# header (see get_current_user).
_AMBIENT_AUTH_METHODS = frozenset({"GET", "HEAD"})


def get_current_user(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
    cookie_token: Optional[str] = Cookie(None, alias=AUTH_COOKIE_NAME),
    x_api_key: Optional[str] = Header(
        None,
        alias="X-API-Key",
        description="An API key, for external integrations (instead of a session).",
    ),
) -> CurrentUser:
    # An explicit X-API-Key wins over any session, so a request is always held
    # to the key's own permissions rather than silently riding the owner's
    # ambient cookie (issue #489).
    if x_api_key:
        from .api_keys import authenticate

        key = authenticate(x_api_key, request)
        # The key acts as its owner, so their role guards and handlers apply as
        # for their own session; the permission check above only narrows that.
        return CurrentUser(
            id=key.user_id,
            username=key.username,
            role=key.role,
            api_key_id=key.id,
            key_permissions=key.permissions,
        )

    # Header (normal API calls) → cookie (image/download GETs). A token in the
    # URL (the old ?token= parameter) is not accepted: it leaks into proxy logs,
    # Referer headers and history.
    #
    # The cookie only counts for reads. A browser attaches it by itself, and
    # SameSite=Lax still lets a page on a sibling subdomain (same *site*) send
    # a cookie-bearing POST, so accepting it on a write would make every write
    # route a CSRF target. The SPA always sends the Authorization header, which
    # no other page can add for it.
    ambient = cookie_token if request.method in _AMBIENT_AUTH_METHODS else None
    raw = (credentials.credentials if credentials else None) or ambient
    if not raw:
        raise HTTPException(401, "Not authenticated")

    try:
        payload = decode_token(raw)
    except jwt.ExpiredSignatureError:
        # The client is expected to answer this by calling /api/auth/refresh and
        # retrying, so it must stay distinguishable from other 401s.
        raise HTTPException(
            401,
            "Token expired - please log in again",
            headers={"X-Token-Expired": "1"},
        )
    except jwt.InvalidTokenError:
        raise HTTPException(401, "Invalid token")
    # A token minted before ``typ`` existed has none; those expire within one
    # access-token lifetime of upgrading, so a missing claim is accepted until
    # the next release. Anything else must say it is an access token.
    typ = payload.get("typ")
    sub, username, role = payload.get("sub"), payload.get("username"), payload.get("role")
    if (typ is not None and typ != ACCESS_TOKEN_TYPE) or not (sub and username and role):
        raise HTTPException(401, "Invalid token")
    user = CurrentUser(
        id=str(sub), username=username, role=role, session_id=payload.get("sid")
    )
    # GM and admin tokens are checked against the account as it is now (see
    # _refresh_role); player and guest tokens are trusted until they expire.
    if user.role in ("admin", "gm"):
        _refresh_role(user)
    return user


def _refresh_role(user: CurrentUser) -> CurrentUser:
    """Bring ``user.role`` up to date from the database.

    An access token carries the role it was issued with, and is trusted until it
    expires (see backend/sessions.py) - for players and guests, whose requests
    (page images, map tiles) are the many. A GM or admin token is looked up on
    each request instead, so a role change, a deleted account or an ended
    session applies to everything those roles can do straight away. API-key
    requests already carry the owner's current role.
    """
    if user.is_api_key:
        return user
    from .config import SessionLocal
    from .models import AuthSession, User

    db = SessionLocal()
    try:
        row = db.query(User).filter_by(id=user.id).first()
        if row is None:
            raise HTTPException(401, "User no longer exists")
        if user.session_id:
            session = db.query(AuthSession).filter_by(id=user.session_id).first()
            if session is not None and session.revoked_at is not None:
                raise HTTPException(401, "Session has ended - please log in again")
        user.role = row.role or "player"
    finally:
        db.close()
    return user


def require_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.role != "admin":
        raise HTTPException(403, "Admin access required")
    return user


def require_gm_or_admin(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    if user.role not in ("admin", "gm"):
        raise HTTPException(403, "GM or admin access required")
    return user


def require_not_guest(
    user: CurrentUser = Depends(get_current_user),
) -> CurrentUser:
    """Block guest accounts from areas outside their invited campaign(s).

    Guests have no access to the shared library, maps, tokens, search, or
    settings — only the campaign they hold an invite code for.
    """
    if user.role == "guest":
        raise HTTPException(403, "Guests cannot access this area")
    return user


def __getattr__(name: str) -> Any:
    if name == "SECRET_KEY":
        return _secret_key()
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
