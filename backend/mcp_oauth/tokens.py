"""Token values, their hashes, and lifetimes for MCP OAuth.

Every secret handed out - access token, refresh token, authorization code,
consent request id, client secret - is stored only as its SHA-256 hash, like an
API key: they are long random values, so a fast hash is enough and lookup keys
on it.

A refresh hands out a pair *derived* from the refresh token presented
(:func:`derive`), with an HMAC keyed by the server's secret. Two refreshes sent
at once with the same token therefore get the same new pair, so whichever
answer the client keeps, its tokens work. That is what lets a short grace
window accept the previous refresh token without signing anyone out
(see ``grants.py``). Without the server's secret the next token can't be
worked out from an old one.
"""
from __future__ import annotations

import base64
import datetime
import hashlib
import hmac
import secrets

from ..api_keys import as_utc, hash_key

ACCESS_PREFIX = "grim_at_"
REFRESH_PREFIX = "grim_rt_"

# An access token is good for an hour; the client renews it with the refresh
# token, which is good for 30 days from its last use. A grant itself never
# expires: it lasts until revoked.
ACCESS_TTL = datetime.timedelta(hours=1)
REFRESH_TTL = datetime.timedelta(days=30)
# How long the refresh token just replaced is still accepted, for two
# refreshes sent at once. Its reuse after that revokes the grant.
REFRESH_GRACE = datetime.timedelta(seconds=60)
# A pending request waits this long for the user to approve it; an approved
# code this long for the client to exchange it.
REQUEST_TTL = datetime.timedelta(minutes=10)
CODE_TTL = datetime.timedelta(minutes=5)

SCOPE = "mcp"


def new_token(prefix: str = "") -> str:
    return prefix + secrets.token_urlsafe(32)


def digest(value: str) -> str:
    """The stored form of any secret: the same SHA-256 as an API key."""
    return hash_key(value)


def _key() -> bytes:
    from .. import auth

    # A key of its own, derived from the server's secret, so these MACs can
    # never be confused with anything else signed with it.
    return hmac.new(
        auth._secret_key().encode("utf-8"), b"grimoire-mcp-oauth-refresh", hashlib.sha256
    ).digest()


def derive(kind: str, refresh_token: str) -> str:
    """The access (``"at"``) or refresh (``"rt"``) token that follows ``refresh_token``."""
    mac = hmac.new(_key(), f"{kind}:{refresh_token}".encode("utf-8"), hashlib.sha256).digest()
    prefix = ACCESS_PREFIX if kind == "at" else REFRESH_PREFIX
    return prefix + base64.urlsafe_b64encode(mac).decode("ascii").rstrip("=")


def now() -> datetime.datetime:
    return datetime.datetime.now(datetime.timezone.utc)


def aware(value: datetime.datetime | None) -> datetime.datetime:
    """A stored UTC time as aware (SQLite hands it back naive); never None.

    For columns this package always fills; a missing one reads as long past,
    so whatever it guards counts as expired.
    """
    utc = as_utc(value)
    return utc if utc is not None else datetime.datetime.min.replace(tzinfo=datetime.timezone.utc)
