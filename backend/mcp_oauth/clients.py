"""Clients that registered themselves through dynamic client registration.

Registration is open while ``MCP_OAUTH_ENABLED`` is on: it grants nothing, as
a user must still sign in and approve. The risk is phishing - a client named
"Claude" with someone else's redirect address - which the consent page answers
by showing the redirect host. ``MCP_OAUTH_REDIRECT_HOSTS`` can narrow which
hosts may register at all.

A client is kept only while it is useful. claude.ai registers a new client
every time a user reconnects, so clients without a grant are deleted on the
next registration (:func:`make_room`):

- one that never even started a sign-in, after an hour;
- one that started but was never approved, after a day;
- one that was approved but whose grant is gone, 30 days after its last
  approval - long enough for a client that keeps its registration (a desktop or
  command-line client) to be approved again under the same client_id.

The number without a grant is capped too. At the cap, the oldest that never
started a sign-in make way; only if none can is a registration refused. So a
flood of registrations can push out other unused ones, but never a client
whose user is signing in. Expired sign-in requests and lapsed grants (whose
refresh token has expired) are deleted first, so neither keeps a client.

Only a SHA-256 hash of a client secret is stored. The SDK checks the secret by
comparing it with the one :func:`get` returns, so the route wrapper hands the
secret the client presented to :data:`presented_secret`, and :func:`get`
returns it only when it hashes to the stored one (``routes.py``). A client
registered with a secret then gets none back when the wrong one, or none, was
presented, which the SDK refuses; the tests pin that.
"""
from __future__ import annotations

import contextvars
import datetime
import hmac
import ipaddress
from typing import Any, Optional
from urllib.parse import urlsplit

from .tokens import digest, now

# How long a client without a grant is kept (see the module docstring).
NEVER_STARTED_TTL = datetime.timedelta(hours=1)
NEVER_APPROVED_TTL = datetime.timedelta(days=1)
LAPSED_TTL = datetime.timedelta(days=30)
# At most this many clients without a grant at once, so open registration
# can't fill the database.
MAX_UNUSED_CLIENTS = 1000

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


def _delete(db: Any, client_ids: list[str]) -> None:
    from ..models import OAuthClient, OAuthCode

    if client_ids:
        db.query(OAuthCode).filter(OAuthCode.client_id.in_(client_ids)).delete(
            synchronize_session=False
        )
        db.query(OAuthClient).filter(OAuthClient.client_id.in_(client_ids)).delete(
            synchronize_session=False
        )


def _without_grant(db: Any) -> Any:
    from ..models import ApiKey, OAuthClient

    granted = db.query(ApiKey.client_id).filter(ApiKey.client_id.isnot(None))
    return db.query(OAuthClient).filter(OAuthClient.client_id.notin_(granted))


def _never_started(db: Any) -> Any:
    from ..models import OAuthClient, OAuthCode

    started = db.query(OAuthCode.client_id)
    return _without_grant(db).filter(
        OAuthClient.granted_at.is_(None), OAuthClient.client_id.notin_(started)
    )


def make_room(db: Any) -> bool:
    """Delete clients past their keep (see the module docstring); False if full.

    Commits. False only when the cap is reached and every client without a
    grant has a sign-in under way.
    """
    from ..models import OAuthClient
    from . import codes, grants

    # First what can never be used again, so it doesn't count: an expired
    # sign-in request would otherwise keep its client "started" (and out of
    # reach of the cap) for a day, and a lapsed grant would keep its client
    # forever.
    codes.delete_expired(db)
    grants.delete_lapsed(db)
    stamp = now()
    stale = _never_started(db).filter(OAuthClient.created_at < stamp - NEVER_STARTED_TTL)
    unapproved = _without_grant(db).filter(
        OAuthClient.granted_at.is_(None), OAuthClient.created_at < stamp - NEVER_APPROVED_TTL
    )
    lapsed = _without_grant(db).filter(OAuthClient.granted_at < stamp - LAPSED_TTL)
    for query in (stale, unapproved, lapsed):
        _delete(db, [c.client_id for c in query.all()])
    excess = _without_grant(db).count() - MAX_UNUSED_CLIENTS + 1
    if excess > 0:
        oldest = _never_started(db).order_by(OAuthClient.created_at).limit(excess).all()
        _delete(db, [c.client_id for c in oldest])
        excess -= len(oldest)
    db.commit()
    return excess <= 0


def mark_granted(db: Any, client_id: str) -> None:
    """Note that a user approved this client just now. Doesn't commit."""
    from ..models import OAuthClient

    db.query(OAuthClient).filter_by(client_id=client_id).update(
        {"granted_at": now()}, synchronize_session=False
    )


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


def get(
    db: Any, client_id: str, presented: Optional[str]
) -> Optional[tuple[dict[str, Any], Optional[str]]]:
    """A client's registered metadata, and the secret to check against.

    The secret is ``presented`` (sent with this request) when it matches the
    stored hash, and None otherwise - which the SDK refuses for any client
    registered with a secret.
    """
    from ..models import OAuthClient

    row = db.query(OAuthClient).filter_by(client_id=client_id).first()
    if row is None:
        return None
    secret = None
    if row.client_secret_hash and presented:
        if hmac.compare_digest(digest(presented), row.client_secret_hash):
            secret = presented
    return dict(row.info), secret


def redirect_host(info: dict[str, Any], redirect_uri: Optional[str] = None) -> str:
    """The host a client signs in through: ``redirect_uri``'s, or its first registered one's."""
    uri = redirect_uri or next(iter(info.get("redirect_uris") or []), "")
    return (urlsplit(str(uri)).hostname or "").lower()
