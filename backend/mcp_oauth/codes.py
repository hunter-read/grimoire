"""Authorization requests: from ``/authorize`` through consent to the code exchange.

One ``oauth_codes`` row follows a sign-in:

1. ``/authorize`` (the SDK has checked the client, redirect address and PKCE)
   stores a pending row and sends the browser to the consent page with a
   random request id. Only the id's hash is kept.
2. The user approves on the consent page: the row gets the user, the access
   they chose, and a code - in one conditional update, so a request can be
   approved only once.
3. The client trades the code for tokens, once: ``used_at`` is set in another
   conditional update, so two workers can't both redeem it. A code presented
   again revokes the grant it produced, as OAuth recommends for a replayed code.

Rows expire (10 minutes pending, 5 once approved) and are deleted lazily.
"""
from __future__ import annotations

from typing import Any, Optional

from .tokens import CODE_TTL, REQUEST_TTL, SCOPE, aware, digest, new_token, now

# At most this many requests may wait for approval per client at once.
MAX_PENDING_PER_CLIENT = 10


class TooManyRequests(Exception):
    pass


def delete_expired(db: Any) -> None:
    from ..models import OAuthCode

    db.query(OAuthCode).filter(OAuthCode.expires_at < now()).delete(synchronize_session=False)


def create(db: Any, client_id: str, params: dict[str, Any]) -> str:
    """Store a pending request and return its id, for the consent page's URL."""
    from ..models import OAuthCode

    delete_expired(db)
    pending = (
        db.query(OAuthCode)
        .filter(OAuthCode.client_id == client_id, OAuthCode.user_id.is_(None))
        .count()
    )
    if pending >= MAX_PENDING_PER_CLIENT:
        db.commit()
        raise TooManyRequests()
    request_id = new_token()
    db.add(
        OAuthCode(
            client_id=client_id,
            request_hash=digest(request_id),
            params=params,
            created_at=now(),
            expires_at=now() + REQUEST_TTL,
        )
    )
    db.commit()
    return request_id


def pending(db: Any, request_id: str) -> Optional[Any]:
    """The pending, unexpired request with this id, or None."""
    from ..models import OAuthCode

    row = db.query(OAuthCode).filter_by(request_hash=digest(request_id)).first()
    if row is None or row.user_id is not None or aware(row.expires_at) <= now():
        return None
    return row


def approve(db: Any, request_id: str, user_id: str, permissions: dict[str, str]) -> Optional[str]:
    """Approve a pending request for ``user_id``; the code, or None if it's gone."""
    from ..models import OAuthCode

    code = new_token()
    updated = (
        db.query(OAuthCode)
        .filter(
            OAuthCode.request_hash == digest(request_id),
            OAuthCode.user_id.is_(None),
            OAuthCode.expires_at > now(),
        )
        .update(
            {
                "user_id": user_id,
                "permissions": permissions,
                "code_hash": digest(code),
                "expires_at": now() + CODE_TTL,
            },
            synchronize_session=False,
        )
    )
    db.commit()
    return code if updated == 1 else None


def deny(db: Any, request_id: str) -> Optional[dict[str, Any]]:
    """Drop a pending request; its params (for the redirect), or None if it's gone."""
    row = pending(db, request_id)
    if row is None:
        return None
    params = dict(row.params)
    db.delete(row)
    db.commit()
    return params


def by_code(db: Any, client_id: str, code: str) -> Optional[Any]:
    """The approved request a code belongs to, for this client, or None.

    A code already exchanged is answered as unknown, and the grant it produced
    is revoked: whoever presents it twice may have stolen it.
    """
    from ..models import ApiKey, OAuthCode

    row = (
        db.query(OAuthCode)
        .filter(OAuthCode.code_hash == digest(code), OAuthCode.client_id == client_id)
        .first()
    )
    if row is None or row.user_id is None:
        return None
    if row.used_at is not None:
        grant_id = (row.params or {}).get("grant_id")
        if grant_id:
            db.query(ApiKey).filter(ApiKey.id == grant_id, ApiKey.client_id == client_id).delete(
                synchronize_session=False
            )
            db.commit()
        return None
    return row


def claim(db: Any, row: Any, grant_id: str) -> bool:
    """Mark a code exchanged for ``grant_id``; False if another request got there first.

    Doesn't commit: the caller creates the grant in the same transaction, so a
    replay can never find the code used without the grant it produced.
    """
    from ..models import OAuthCode

    updated = (
        db.query(OAuthCode)
        .filter(OAuthCode.id == row.id, OAuthCode.used_at.is_(None))
        .update(
            {"used_at": now(), "params": {**(row.params or {}), "grant_id": grant_id}},
            synchronize_session=False,
        )
    )
    return updated == 1


def scopes(params: dict[str, Any]) -> list[str]:
    return list(params.get("scopes") or [SCOPE])
