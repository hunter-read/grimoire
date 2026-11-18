"""Clients that registered themselves through dynamic client registration.

Registration is open while ``MCP_OAUTH_ENABLED`` is on: it grants nothing, as
a user must still sign in and approve. The risk is phishing - a client named
"Claude" with someone else's redirect address - which the consent page answers
by showing the redirect host. ``MCP_OAUTH_REDIRECT_HOSTS`` can narrow which
hosts may register at all.

A client is kept only while it is useful. claude.ai registers a new client
every time a user reconnects, so one that has gone a day without a grant (it
never got one, or its grant was revoked) is deleted on the next registration,
and the number waiting without one is capped.

Only a SHA-256 hash of a client secret is stored. The SDK checks the secret by
comparing it with the one :func:`get` returns, so the route wrapper hands the
secret the client presented to :data:`presented_secret`, and :func:`get`
returns it only when it hashes to the stored one (``routes.py``).
"""
from __future__ import annotations

import contextvars
import datetime
import hmac
import ipaddress
from typing import Any, Optional
from urllib.parse import urlsplit

from .tokens import digest, now

# Clients registered more than this long ago without a grant are deleted.
UNUSED_CLIENT_TTL = datetime.timedelta(days=1)
# At most this many clients may be waiting for a grant at once, so open
# registration can't fill the database.
MAX_UNUSED_CLIENTS = 500

# The client secret sent with the current /token or /revoke request.
presented_secret: contextvars.ContextVar[Optional[str]] = contextvars.ContextVar(
    "mcp_oauth_presented_secret", default=None
)


class RedirectRefused(ValueError):
    pass


def _is_loopback(host: str) -> bool:
    if host == "localhost":
        return True
    try:
        return ipaddress.ip_address(host.strip("[]")).is_loopback
    except ValueError:
        return False


def check_redirect_uri(uri: str, allowed_hosts: list[str]) -> None:
    """Refuse a redirect address a client may not register.

    ``https`` anywhere, or ``http`` on loopback for a client running on the
    user's own machine. With ``allowed_hosts`` set, the host must be one of
    them. No fragment, as OAuth requires.
    """
    parts = urlsplit(uri)
    host = (parts.hostname or "").lower()
    if not host:
        raise RedirectRefused(f"Redirect address has no host: {uri}")
    if parts.fragment:
        raise RedirectRefused("A redirect address may not have a fragment")
    if parts.scheme == "https":
        pass
    elif parts.scheme == "http" and _is_loopback(host):
        pass
    else:
        raise RedirectRefused("A redirect address must use https (or http on loopback)")
    if allowed_hosts and host not in allowed_hosts:
        raise RedirectRefused(f"{host} is not an allowed redirect host on this server")


def delete_unused(db: Any) -> int:
    """Delete clients that have had no grant for a day, with their requests."""
    from ..models import ApiKey, OAuthClient, OAuthCode

    cutoff = now() - UNUSED_CLIENT_TTL
    granted = db.query(ApiKey.client_id).filter(ApiKey.client_id.isnot(None))
    stale = [
        cid
        for (cid,) in db.query(OAuthClient.client_id)
        .filter(OAuthClient.created_at < cutoff, OAuthClient.client_id.notin_(granted))
        .all()
    ]
    if not stale:
        return 0
    db.query(OAuthCode).filter(OAuthCode.client_id.in_(stale)).delete(synchronize_session=False)
    db.query(OAuthClient).filter(OAuthClient.client_id.in_(stale)).delete(
        synchronize_session=False
    )
    return len(stale)


def unused_count(db: Any) -> int:
    from ..models import ApiKey, OAuthClient

    granted = db.query(ApiKey.client_id).filter(ApiKey.client_id.isnot(None))
    return db.query(OAuthClient).filter(OAuthClient.client_id.notin_(granted)).count()


def register(db: Any, info: dict[str, Any], secret: Optional[str]) -> None:
    """Store a client the SDK has validated. ``info`` excludes the secret."""
    from ..models import OAuthClient

    db.add(
        OAuthClient(
            client_id=info["client_id"],
            client_name=(info.get("client_name") or "")[:200] or None,
            info=info,
            client_secret_hash=digest(secret) if secret else None,
            created_at=now(),
        )
    )
    db.commit()


def get(db: Any, client_id: str) -> Optional[tuple[dict[str, Any], Optional[str]]]:
    """A client's registered metadata, and the secret to check against.

    The secret is the one presented with this request when it matches the
    stored hash, and None otherwise - which the SDK refuses for any client
    registered with a secret.
    """
    from ..models import OAuthClient

    row = db.query(OAuthClient).filter_by(client_id=client_id).first()
    if row is None:
        return None
    secret = None
    presented = presented_secret.get()
    if row.client_secret_hash and presented:
        if hmac.compare_digest(digest(presented), row.client_secret_hash):
            secret = presented
    return dict(row.info), secret


def redirect_host(info: dict[str, Any], redirect_uri: Optional[str] = None) -> str:
    uri = redirect_uri or next(iter(info.get("redirect_uris") or []), "")
    return (urlsplit(str(uri)).hostname or "").lower()
