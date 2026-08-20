"""Refresh-token session lifecycle.

Issue #157. A login now produces two credentials:

* a short-lived **access token** (a JWT, ``ACCESS_TOKEN_EXPIRE_MINUTES``), which
  stays stateless — validated by signature and ``exp`` alone, so the hot path
  costs no database round trip; and
* a long-lived **refresh token** (opaque random bytes, ``REFRESH_TOKEN_EXPIRE_DAYS``)
  bound to an ``auth_sessions`` row.

Revoking the row ends the session: the refresh token stops working immediately,
and the access token dies on its own within at most one access lifetime. That
bounded window is the deliberate trade for keeping access-token checks stateless
— shorten ``ACCESS_TOKEN_EXPIRE_MINUTES`` to narrow it.

Refresh tokens are single-use and rotate on every exchange. Replaying a token
that was already exchanged is taken as evidence the token leaked, and revokes
the whole session rather than merely refusing the call.

Only a SHA-256 of each refresh token is stored, so a leaked database backup
yields no usable sessions.
"""

import datetime
import hashlib
import logging
import os
import secrets
from typing import Optional, Tuple

from sqlalchemy.orm import Session

from .models import AuthSession

logger = logging.getLogger("grimoire.sessions")


def _int_env(name: str, default: int, minimum: int = 1) -> int:
    """Read a positive int from the environment, falling back on junk values."""
    raw = (os.environ.get(name) or "").strip()
    if not raw:
        return default
    try:
        value = int(raw)
    except ValueError:
        logger.warning("%s=%r is not an integer - using the default of %d", name, raw, default)
        return default
    if value < minimum:
        logger.warning("%s=%d is below the minimum of %d - using %d", name, value, minimum, minimum)
        return minimum
    return value


# How long an access token is valid. This is also the worst-case window between
# revoking a session and the last access token going dead, so it is deliberately
# short. Configurable because self-hosters on a trusted LAN may prefer fewer
# refreshes over a tighter revocation window.
ACCESS_TOKEN_EXPIRE_MINUTES = _int_env("ACCESS_TOKEN_EXPIRE_MINUTES", 30)

# How long a session can live without any activity before the refresh token
# expires and the user must log in again. Matches the old JWT lifetime, so a
# normally-active user sees no behaviour change from before this feature.
REFRESH_TOKEN_EXPIRE_DAYS = _int_env("REFRESH_TOKEN_EXPIRE_DAYS", 30)

# Name of the HttpOnly cookie carrying the refresh token. Scoped to the refresh
# and logout endpoints so it is not sent on every API call — a refresh token is
# strictly more valuable than an access token and should travel as little as
# possible.
REFRESH_COOKIE_NAME = "grimoire_refresh"
REFRESH_COOKIE_PATH = "/api/auth"

# Longest User-Agent we keep for the session list. The header is entirely
# attacker-controlled, so it is truncated rather than stored unbounded.
_MAX_USER_AGENT = 255


def _utcnow() -> datetime.datetime:
    """Naive UTC, matching the DateTime columns elsewhere in the schema."""
    return datetime.datetime.now(datetime.timezone.utc).replace(tzinfo=None)


def hash_refresh_token(token: str) -> str:
    """SHA-256 of a refresh token, as stored in the database.

    A plain hash (no salt/KDF) is correct here where it would be wrong for a
    password: the token is 256 bits of `secrets` randomness, so there is no
    dictionary to attack and nothing for a KDF to slow down.
    """
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def generate_refresh_token() -> str:
    return secrets.token_urlsafe(32)


def create_session(
    db: Session,
    user_id: str,
    *,
    origin: str = "password",
    user_agent: Optional[str] = None,
    ip_address: Optional[str] = None,
) -> Tuple[AuthSession, str]:
    """Open a session and return it alongside the raw (unhashed) refresh token.

    The raw token is returned exactly once, here — only its hash is persisted,
    so it cannot be recovered afterwards.
    """
    token = generate_refresh_token()
    session = AuthSession(
        user_id=str(user_id),
        refresh_token_hash=hash_refresh_token(token),
        origin=origin,
        user_agent=(user_agent or "")[:_MAX_USER_AGENT] or None,
        ip_address=(ip_address or "")[:45] or None,
        expires_at=_utcnow() + datetime.timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS),
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session, token


def get_active_session(db: Session, token: str) -> Optional[AuthSession]:
    """Look up a live session by raw refresh token.

    Returns None when the token is unknown, already rotated away, revoked, or
    expired. Reuse of a previously-rotated token is not merely refused: it
    revokes the session, on the assumption the token leaked.
    """
    token_hash = hash_refresh_token(token)
    session = db.query(AuthSession).filter_by(refresh_token_hash=token_hash).first()

    if session is None:
        # Not a current token — but it may be one we already rotated away, which
        # means the same token was exchanged twice. Treat that as theft.
        replayed = db.query(AuthSession).filter_by(previous_token_hash=token_hash).first()
        if replayed is not None and replayed.revoked_at is None:
            logger.warning(
                "Refresh token reuse detected for session %s (user %s) - revoking the session",
                replayed.id,
                replayed.user_id,
            )
            revoke_session(db, replayed)
        return None

    if session.revoked_at is not None:
        return None
    if session.expires_at is not None and session.expires_at <= _utcnow():
        return None
    return session


def rotate_session(db: Session, session: AuthSession) -> str:
    """Issue a fresh refresh token for a session, invalidating the old one.

    The replaced hash is retained in ``previous_token_hash`` so a replay of it
    is recognisable. The idle window also extends from now, so an active session
    stays alive while an abandoned one still ages out.
    """
    token = generate_refresh_token()
    session.previous_token_hash = session.refresh_token_hash
    session.refresh_token_hash = hash_refresh_token(token)
    session.last_used_at = _utcnow()
    session.expires_at = _utcnow() + datetime.timedelta(days=REFRESH_TOKEN_EXPIRE_DAYS)
    db.commit()
    return token


def revoke_session(db: Session, session: AuthSession) -> None:
    """End one session. Idempotent — re-revoking keeps the original timestamp."""
    if session.revoked_at is None:
        session.revoked_at = _utcnow()
    # Drop the replay-detection hash: the session is dead, so there is nothing
    # left to distinguish a replay from any other unknown token.
    session.previous_token_hash = None
    db.commit()


def revoke_session_by_token(db: Session, token: str) -> bool:
    """Revoke whichever live session owns this refresh token. True if one did."""
    session = get_active_session(db, token)
    if session is None:
        return False
    revoke_session(db, session)
    return True


def revoke_user_sessions(
    db: Session, user_id: str, *, except_session_id: Optional[str] = None
) -> int:
    """Revoke every live session for a user. Returns how many were ended.

    This is the kill switch behind "log out everywhere", and behind the
    account changes that must not leave old sessions usable — a role change, a
    password reset, or an account being disabled or deleted.
    """
    query = db.query(AuthSession).filter(
        AuthSession.user_id == str(user_id),
        AuthSession.revoked_at.is_(None),
    )
    if except_session_id:
        query = query.filter(AuthSession.id != except_session_id)

    now = _utcnow()
    sessions = query.all()
    for session in sessions:
        session.revoked_at = now
        session.previous_token_hash = None
    if sessions:
        db.commit()
    return len(sessions)


def delete_user_sessions(db: Session, user_id: str) -> int:
    """Hard-delete a user's sessions. Returns how many rows went.

    Used when the user row itself is being deleted, where revoking is not
    enough: the rows carry a foreign key to ``users.id`` and must go with it.
    """
    deleted = (
        db.query(AuthSession)
        .filter(AuthSession.user_id == str(user_id))
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
    return int(deleted)


def list_user_sessions(db: Session, user_id: str) -> list:
    """Live sessions for a user, newest first, for the session-management UI."""
    return (
        db.query(AuthSession)
        .filter(
            AuthSession.user_id == str(user_id),
            AuthSession.revoked_at.is_(None),
            AuthSession.expires_at > _utcnow(),
        )
        .order_by(AuthSession.last_used_at.desc())
        .all()
    )


def purge_expired_sessions(db: Session, *, retain_days: int = 7) -> int:
    """Delete rows for sessions long dead, so the table stays bounded.

    Keeps recently-revoked rows for ``retain_days`` so refresh-token reuse
    right after a logout is still detectable rather than looking like an
    unrecognised token.
    """
    cutoff = _utcnow() - datetime.timedelta(days=retain_days)
    deleted = (
        db.query(AuthSession)
        .filter(
            (AuthSession.expires_at < cutoff)
            | (AuthSession.revoked_at.isnot(None) & (AuthSession.revoked_at < cutoff))
        )
        .delete(synchronize_session=False)
    )
    if deleted:
        db.commit()
        logger.info("Purged %d expired auth session(s)", deleted)
    return int(deleted)
