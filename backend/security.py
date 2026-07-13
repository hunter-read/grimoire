"""Security hardening: auth rate limiting and HTTP response headers.

Two pieces of hardening live here:

1. A :class:`slowapi.Limiter` used to throttle the unauthenticated,
   credential-checking endpoints (login / setup / guest-login and the
   API-key-guarded ``/api/stats``) against online brute-forcing. It is
   keyed on the real client IP (honoring ``X-Forwarded-For`` when behind a
   reverse proxy) and, when Valkey is configured, backed by a shared store so
   the limit is enforced consistently across replicas — falling back to
   in-memory when Valkey is absent or unreachable.

2. A middleware that sets security headers (CSP, X-Frame-Options, nosniff,
   Referrer-Policy, and HSTS on HTTPS) on every response.
"""
import os
import sys

from slowapi import Limiter
from slowapi.errors import RateLimitExceeded
from starlette.requests import Request
from starlette.responses import Response
from starlette.types import ASGIApp, Message, Receive, Scope, Send

from .config import VALKEY_URL, logger

# --- Rate limiting -----------------------------------------------------------

# Per-IP limit applied to the auth endpoints. Tunable via env var; the default
# is generous enough for legitimate retyping-your-password use but shuts down
# automated credential stuffing. Format is a slowapi/limits string.
AUTH_RATE_LIMIT = os.environ.get("AUTH_RATE_LIMIT", "10/minute")

# Trust the reverse proxy's forwarded-for header. Default on so all clients
# don't share the proxy's single IP bucket. Operators terminating TLS directly
# (no proxy) can set this to "false" so a spoofed header can't be used to
# sidestep the limit.
_TRUST_FORWARDED = os.environ.get("TRUST_FORWARDED_FOR", "true").strip().lower() != "false"

# Disabled automatically under pytest so the many auth-touching tests don't trip
# the limit; the dedicated rate-limit test re-enables it explicitly. Detected via
# sys.modules because this module is imported at collection time, before any
# individual test sets PYTEST_CURRENT_TEST.
_UNDER_PYTEST = "pytest" in sys.modules
_RATE_LIMIT_ENABLED = os.environ.get(
    "RATE_LIMIT_ENABLED",
    "false" if _UNDER_PYTEST else "true",
).strip().lower() == "true"


def client_ip(request: Request) -> str:
    """Best-effort real client IP for rate-limit keying.

    When ``TRUST_FORWARDED_FOR`` is on, use the left-most entry of
    ``X-Forwarded-For`` (the original client) rather than the proxy's socket
    address, so every client gets its own bucket. Falls back to the socket peer.
    """
    if _TRUST_FORWARDED:
        fwd = request.headers.get("x-forwarded-for")
        if fwd:
            first = fwd.split(",")[0].strip()
            if first:
                return first
    if request.client and request.client.host:
        return request.client.host
    return "127.0.0.1"


# swallow_errors + in_memory_fallback: if the Valkey store is down, degrade to
# in-memory limiting instead of erroring the request open or closed.
limiter = Limiter(
    key_func=client_ip,
    storage_uri=VALKEY_URL or "memory://",
    in_memory_fallback_enabled=True,
    swallow_errors=True,
    enabled=_RATE_LIMIT_ENABLED,
)

if _RATE_LIMIT_ENABLED:
    logger.info(
        f"Auth rate limiting enabled ({AUTH_RATE_LIMIT}), "
        f"store={'valkey' if VALKEY_URL else 'in-memory'}"
    )


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

_HSTS = "max-age=31536000; includeSubDomains"


def _is_https(scope: Scope) -> bool:
    if scope.get("scheme") == "https":
        return True
    # Behind a TLS-terminating proxy the original scheme arrives in a header.
    for name, value in scope.get("headers", []):
        if name == b"x-forwarded-proto" and value.split(b",")[0].strip() == b"https":
            return True
    return False


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


__all__ = [
    "AUTH_RATE_LIMIT",
    "RateLimitExceeded",
    "Response",
    "SAME_ORIGIN_FRAME_HEADERS",
    "SecurityHeadersMiddleware",
    "limiter",
]
