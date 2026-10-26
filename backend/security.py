"""Security hardening: auth rate limiting and HTTP response headers.

Two pieces of hardening live here:

1. A :class:`slowapi.Limiter` used to throttle the unauthenticated,
   credential-checking endpoints (login / setup / guest-login, and failed
   ``X-API-Key`` attempts on any endpoint) against online brute-forcing. It is
   keyed on the real client IP (honoring ``X-Forwarded-For`` from a trusted
   reverse proxy) and, when Valkey is configured, backed by a shared store so
   the limit is enforced consistently across replicas — falling back to
   in-memory when Valkey is absent or unreachable. Failed sign-ins and share
   unlocks are also counted per account and per link, which holds however
   many addresses the attempts come from.

2. A middleware that sets security headers (CSP, X-Frame-Options, nosniff,
   Referrer-Policy, and HSTS on HTTPS) on every response.
"""
import ipaddress
from typing import Any, Optional

from limits import parse as parse_limit
from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import (
    ACCOUNT_RATE_LIMIT,
    AUTH_RATE_LIMIT,
    RATE_LIMIT_ENABLED,
    TRUST_FORWARDED_FOR,
    TRUSTED_PROXIES,
    VALKEY_CONNECT_TIMEOUT,
    VALKEY_SOCKET_TIMEOUT,
    VALKEY_URL,
    logger,
)

# --- Rate limiting -----------------------------------------------------------

# AUTH_RATE_LIMIT is the per-IP limit on the auth endpoints, read with the
# other settings in backend/config/env.py, as are TRUST_FORWARDED_FOR and
# TRUSTED_PROXIES: whether, and from which connecting addresses, a reverse
# proxy's X-Forwarded-For is believed. The default trusts loopback and Docker's
# bridge networks only.
#
# Any client connecting from a trusted range is believed, though: behind a port
# forwarder that swaps each client's address for a gateway inside one, every
# client - internet ones included - counts as a proxy. docs/security.md
# recommends TRUST_FORWARDED_FOR=false for those setups.


def _parse_trusted(raw: str) -> tuple[list[Any], frozenset[str]]:
    """``(networks, literal names)`` from a comma-separated list."""
    networks: list[Any] = []
    names: set[str] = set()
    for part in raw.split(","):
        entry = part.strip()
        if not entry:
            continue
        try:
            networks.append(ipaddress.ip_network(entry, strict=False))
        except ValueError:
            # Not an address: a literal peer name (a Unix socket path, or the
            # test client), matched exactly.
            names.add(entry)
    return networks, frozenset(names)


_TRUSTED_NETWORKS, _TRUSTED_NAMES = (
    _parse_trusted(TRUSTED_PROXIES) if TRUST_FORWARDED_FOR else ([], frozenset())
)

# Off by default under pytest (see RATE_LIMIT_ENABLED in backend/config/env.py).
_RATE_LIMIT_ENABLED = RATE_LIMIT_ENABLED


def _is_trusted_proxy(host: str) -> bool:
    if host in _TRUSTED_NAMES:
        return True
    try:
        addr = ipaddress.ip_address(host.strip("[]"))
    except ValueError:
        return False
    return any(addr in net for net in _TRUSTED_NETWORKS)


def request_is_https(request: Any) -> bool:
    """Whether ``request`` reached the browser over HTTPS.

    True when the connection itself is HTTPS (uvicorn's ``--proxy-headers``
    sets that for proxies it trusts), or when a trusted proxy
    (``TRUSTED_PROXIES``) says so in ``X-Forwarded-Proto``. The header is
    ignored from anyone else, who could otherwise claim HTTPS for a plaintext
    connection.
    """
    if request is None:
        return False
    if getattr(request.url, "scheme", "") == "https":
        return True
    peer = request.client.host if request.client and request.client.host else None
    if not peer or not _is_trusted_proxy(peer):
        return False
    proto = request.headers.get("x-forwarded-proto", "")
    return proto.split(",")[0].strip().lower() == "https"


def client_ip(request: Any) -> str:
    """Best-effort real client IP, for rate-limit keying and the session list.

    ``X-Forwarded-For`` is only read when the connection comes from a trusted
    proxy (``TRUSTED_PROXIES``). Each proxy appends the address it received the
    request from, so the header is read from the right, skipping trusted hops;
    the first address that isn't one is the client. The same rule uvicorn's own
    ``--forwarded-allow-ips`` handling uses.
    """
    peer = request.client.host if request.client and request.client.host else None
    if not peer:
        return "127.0.0.1"
    if not _is_trusted_proxy(peer):
        if TRUST_FORWARDED_FOR and request.headers.get("x-forwarded-for"):
            _hint_untrusted_proxy(peer)
        return peer
    # Some proxies add a second header line rather than extending the first;
    # read them all, in order.
    getlist = getattr(request.headers, "getlist", None)
    lines = getlist("x-forwarded-for") if getlist else [request.headers.get("x-forwarded-for") or ""]
    hops = [hop.strip() for line in lines for hop in line.split(",") if hop.strip()]
    for hop in reversed(hops):
        if not _is_trusted_proxy(hop):
            return hop
    # Every hop is a trusted address: the client itself is on the private
    # network, and the left-most hop is the closest we have to it.
    return hops[0] if hops else peer


# Private addresses already told about, so each is logged once. Bounded: a LAN
# has few proxies, and past that the hint has been made.
_HINTED_PEERS: set[str] = set()
_MAX_HINTED_PEERS = 16


def _hint_untrusted_proxy(peer: str) -> None:
    """Log, once per address, a private peer sending X-Forwarded-For untrusted.

    That is usually a reverse proxy on another machine on the LAN, or on a
    Kubernetes or Podman network, which the default TRUSTED_PROXIES does not
    cover. Its header is ignored, so every client behind it shares its address.
    """
    if peer in _HINTED_PEERS or len(_HINTED_PEERS) >= _MAX_HINTED_PEERS:
        return
    try:
        if not ipaddress.ip_address(peer.strip("[]")).is_private:
            return
    except ValueError:
        return
    _HINTED_PEERS.add(peer)
    logger.info(
        "Ignoring X-Forwarded-For from %s, which is not in TRUSTED_PROXIES. If it is "
        "your reverse proxy, add it there, or every client behind it shares its "
        "address for rate limiting and Active Sessions.",
        peer,
    )


# An IPv6 host is usually given a whole /64 and can pick any address in it, so
# one client could otherwise rotate through fresh rate-limit buckets.
_IPV6_RATE_LIMIT_PREFIX = 64


def rate_limit_key(request: Any) -> str:
    """The client's rate-limit bucket: :func:`client_ip`, widened to its /64 for a
    global IPv6 address.

    Private, link-local and loopback IPv6 addresses keep their own bucket, as
    every device on one LAN segment shares a /64. Active Sessions still shows
    the full address from :func:`client_ip`.
    """
    ip = client_ip(request)
    try:
        addr = ipaddress.ip_address(ip.strip("[]"))
    except ValueError:
        return ip
    if isinstance(addr, ipaddress.IPv6Address):
        if addr.ipv4_mapped is not None:
            return str(addr.ipv4_mapped)
        if addr.is_global:
            net = ipaddress.IPv6Network((addr, _IPV6_RATE_LIMIT_PREFIX), strict=False)
            return str(net)
    return ip


# The timeouts make "down" mean seconds: without them a login against an
# unreachable host waits out the OS TCP connect timeout first. slowapi annotates
# storage_options as Dict[str, str], but it is passed to the redis client as
# keyword arguments, where the timeouts must be numbers.
_storage_options: dict[str, Any] = (
    {
        "socket_connect_timeout": VALKEY_CONNECT_TIMEOUT,
        "socket_timeout": VALKEY_SOCKET_TIMEOUT,
    }
    if VALKEY_URL
    else {}
)

# swallow_errors + in_memory_fallback: if the Valkey store is down, degrade to
# in-memory limiting instead of erroring the request open or closed.
limiter = Limiter(
    key_func=rate_limit_key,
    storage_uri=VALKEY_URL or "memory://",
    storage_options=_storage_options,
    in_memory_fallback_enabled=True,
    swallow_errors=True,
    enabled=_RATE_LIMIT_ENABLED,
)

if _RATE_LIMIT_ENABLED:
    logger.info(
        f"Auth rate limiting enabled ({AUTH_RATE_LIMIT}), "
        f"store={'valkey' if VALKEY_URL else 'in-memory'}"
    )


# Failed API-key attempts share the auth limit, counted per client IP across
# every endpoint (issue #489). Only failures count, so a working integration is
# never throttled however often it polls, and a correct key keeps working even
# from an address that is over the limit: keys are long random values, and
# several people can share one address (a VPN exit, a household router).
_API_KEY_FAILURE_LIMIT = parse_limit(AUTH_RATE_LIMIT)
_API_KEY_FAILURE_SCOPE = "api-key-failure"


def api_key_attempts_blocked(request: Request) -> bool:
    """Whether this client has used up its failed-key allowance."""
    if not limiter.enabled:
        return False
    try:
        return not limiter.limiter.test(
            _API_KEY_FAILURE_LIMIT, _API_KEY_FAILURE_SCOPE, rate_limit_key(request)
        )
    except Exception:
        # Match the limiter's own swallow_errors: a broken store fails open
        # rather than locking every integration out.
        return False


def record_api_key_failure(request: Request) -> None:
    if not limiter.enabled:
        return
    try:
        limiter.limiter.hit(_API_KEY_FAILURE_LIMIT, _API_KEY_FAILURE_SCOPE, rate_limit_key(request))
    except Exception:
        pass


# Share links (issue #541). Two separate allowances, both on the auth limit:
#   - "share-lookup" counts requests for tokens that do not exist, per client IP.
#     Only unknown tokens count. A link that was revoked, expired or suspended is
#     still a known token, so a tool that keeps fetching a dead link (OTFBM, a
#     VTT scene, an old Discord message) never throttles that tool's other,
#     working links - those tools fetch every link from the same server IP.
#   - "share-unlock" counts wrong passwords, per client IP *and* link, so a
#     password cannot be guessed faster than the login form allows.
_SHARE_LIMIT = parse_limit(AUTH_RATE_LIMIT)
SHARE_LOOKUP_SCOPE = "share-lookup"
SHARE_UNLOCK_SCOPE = "share-unlock"


def share_attempts_blocked(request: Request, scope: str, key: str = "") -> bool:
    """Whether this client has used up its allowance in ``scope``."""
    if not limiter.enabled:
        return False
    try:
        return not limiter.limiter.test(_SHARE_LIMIT, scope, f"{rate_limit_key(request)}:{key}")
    except Exception:
        return False


def record_share_failure(request: Request, scope: str, key: str = "") -> None:
    if not limiter.enabled:
        return
    try:
        limiter.limiter.hit(_SHARE_LIMIT, scope, f"{rate_limit_key(request)}:{key}")
    except Exception:
        pass


# Per-account and per-link allowances. The IP limits above slow one client, but
# attempts can arrive from many addresses, and many people can share one. These
# count failures against what is being signed in to, whatever address they come
# from: an account (by the username typed, existing or not), a recognised device
# of that account (see backend/login_devices.py), or a password-protected share
# link. Tunable with ACCOUNT_RATE_LIMIT.
_ACCOUNT_LIMIT = parse_limit(ACCOUNT_RATE_LIMIT)
LOGIN_ACCOUNT_SCOPE = "login-account"
LOGIN_DEVICE_SCOPE = "login-device"
SHARE_LINK_SCOPE = "share-unlock-link"


def account_attempts_blocked(scope: str, key: str) -> bool:
    """Whether ``key`` (an account, device or link) has used up its allowance."""
    if not limiter.enabled:
        return False
    try:
        return not limiter.limiter.test(_ACCOUNT_LIMIT, scope, key)
    except Exception:
        return False


def record_account_failure(scope: str, key: str) -> None:
    if not limiter.enabled:
        return
    try:
        limiter.limiter.hit(_ACCOUNT_LIMIT, scope, key)
    except Exception:
        pass


# --- Security headers --------------------------------------------------------

# CSP scoped to what the SPA actually loads:
#   - scripts: only our own bundle ('self'); no inline/eval.
#   - styles: 'self' + inline (React sets many inline styles) + Google Fonts CSS.
#   - fonts: 'self' + Google Fonts file host + data: (inlined icon fonts).
#   - images: 'self' + data:/blob: (rendered PDF pages are fetched as blobs).
#   - connect: 'self' for the same-origin API/XHR.
#   - frame-ancestors 'none' is the CSP equivalent of X-Frame-Options: DENY.
_CSP = "; ".join(
    [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com data:",
        "img-src 'self' data: blob:",
        "connect-src 'self'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
    ]
)

_SECURITY_HEADERS = {
    "Content-Security-Policy": _CSP,
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "strict-origin-when-cross-origin",
}

# Framing override for same-origin-embeddable responses (e.g. the raw book file
# served into the reader's PDF-mode <iframe>). The global policy is
# frame-ancestors 'none' / X-Frame-Options: DENY, which Firefox strictly enforces
# on framed subresources and so blocks the reader's same-origin iframe. Endpoints
# that are legitimately framed by our own SPA set these headers on their response;
# SecurityHeadersMiddleware leaves any header the response already set untouched.
# Cross-origin framing stays blocked ('self' / SAMEORIGIN).
SAME_ORIGIN_FRAME_HEADERS = {
    "Content-Security-Policy": _CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'"),
    "X-Frame-Options": "SAMEORIGIN",
}

# Per-response policy for user-supplied files a browser can also open as a page
# of their own (SVG images, campaign uploads). Opened that way the file is a
# static document: no script, no requests beyond inline styles and data: images,
# no framing. An <img> already renders SVG like this, so pages that embed these
# files are unaffected. The middleware below keeps it in place of the app-wide
# policy, as it does for SAME_ORIGIN_FRAME_HEADERS.
INERT_DOCUMENT_CSP = (
    "default-src 'none'; style-src 'unsafe-inline'; img-src data:; sandbox; "
    "frame-ancestors 'none'"
)
INERT_DOCUMENT_HEADERS = {"Content-Security-Policy": INERT_DOCUMENT_CSP}
# The same, for a file the reader frames (see SAME_ORIGIN_FRAME_HEADERS).
INERT_SAME_ORIGIN_FRAME_HEADERS = {
    "Content-Security-Policy": INERT_DOCUMENT_CSP.replace(
        "frame-ancestors 'none'", "frame-ancestors 'self'"
    ),
    "X-Frame-Options": "SAMEORIGIN",
}


def inert_svg_headers(
    media_type: Optional[str], name: str = "", *, same_origin_frame: bool = False
) -> dict[str, str]:
    """``INERT_DOCUMENT_HEADERS`` for an SVG response, and nothing otherwise.

    Matched on the media type or the file name, since some routes label an SVG
    ``image/svg`` from its suffix rather than ``image/svg+xml``.
    """
    base = (media_type or "").split(";")[0].strip().lower()
    if base != "image/svg+xml" and not name.lower().endswith(".svg"):
        return {}
    return dict(INERT_SAME_ORIGIN_FRAME_HEADERS if same_origin_frame else INERT_DOCUMENT_HEADERS)

_HSTS = "max-age=31536000; includeSubDomains"


def _is_https(scope: Scope) -> bool:
    return request_is_https(Request(scope))


class SecurityHeadersMiddleware:
    """Pure-ASGI middleware that adds security headers to every response.

    Implemented at the ASGI layer (rather than BaseHTTPMiddleware) so it does not
    buffer streaming responses such as PDF page images or file downloads.
    """

    def __init__(self, app: ASGIApp):
        self.app = app

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        if scope["type"] != "http":
            await self.app(scope, receive, send)
            return

        https = _is_https(scope)

        async def send_with_headers(message: Message) -> None:
            if message["type"] == "http.response.start":
                headers = message.setdefault("headers", [])
                existing = {k.lower() for k, _ in headers}
                for name, value in _SECURITY_HEADERS.items():
                    if name.lower().encode() not in existing:
                        headers.append((name.encode(), value.encode()))
                if https and b"strict-transport-security" not in existing:
                    headers.append((b"Strict-Transport-Security", _HSTS.encode()))
            await send(message)

        await self.app(scope, receive, send_with_headers)


# --- CORS ---------------------------------------------------------------------

# Options for Starlette's CORSMiddleware when CORS_ALLOWED_ORIGINS is set (issue
# #502), so browser-based integrations such as a Foundry VTT module can call the
# API from their own origin.
#   - No allow_credentials: browsers then never send cookies cross-origin, so
#     another site cannot ride a user's logged-in session (the refresh cookie).
#     Integrations authenticate with an X-API-Key or bearer token instead, which
#     the key's own permissions already scope.
#   - X-Token-Expired is exposed so a bearer-token client can tell an expired
#     token (refresh and retry) from a bad one.
# Installed outermost, so preflights are answered before any auth dependency
# runs and 401/403/429 responses carry the headers too.
def cors_middleware_options(origins: list[str]) -> dict[str, Any]:
    return {
        "allow_origins": origins,
        "allow_methods": ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE"],
        "allow_headers": ["Authorization", "Content-Type", "X-API-Key"],
        "expose_headers": ["X-Token-Expired"],
        "allow_credentials": False,
    }


__all__ = [
    "ACCOUNT_RATE_LIMIT",
    "AUTH_RATE_LIMIT",
    "INERT_DOCUMENT_CSP",
    "INERT_DOCUMENT_HEADERS",
    "INERT_SAME_ORIGIN_FRAME_HEADERS",
    "RateLimitExceeded",
    "Response",
    "SAME_ORIGIN_FRAME_HEADERS",
    "SecurityHeadersMiddleware",
    "cors_middleware_options",
    "inert_svg_headers",
    "limiter",
]
