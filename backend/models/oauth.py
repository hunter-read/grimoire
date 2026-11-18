"""OAuth clients and authorization requests for /mcp sign-in (issue #906).

The grant a user approves is an ``ApiKey`` row (``client_id`` set); these two
tables hold what comes before it. Both live in the database rather than in a
worker's memory, so any worker can answer any step of a sign-in.
"""
import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class OAuthClient(Base):
    """A client that registered itself through dynamic client registration.

    ``info`` is the registered metadata as the client sent it (redirect
    addresses, grant types, name), minus the secret: only the secret's SHA-256
    hash is kept. Registering grants nothing - a user still has to sign in and
    approve - and a client left without a grant is deleted after a while (see
    ``mcp_oauth/clients.py``).
    """

    __tablename__ = "oauth_clients"

    client_id: Mapped[str] = mapped_column(String(36), primary_key=True)
    client_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    info: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    client_secret_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow, index=True)
    # When a user last approved it; null until then. Decides how long it is
    # kept once it has no grant.
    granted_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)


class OAuthCode(Base):
    """One authorization request, from ``/authorize`` to the code exchange.

    Created pending when the client sends the user to ``/authorize``; the
    consent page finds it by ``request_hash``. Approving it sets ``user_id``,
    the chosen ``permissions`` and ``code_hash``; the client then trades the
    code for tokens once (``used_at``). Rows are short-lived and deleted when
    they expire. ``params`` holds what the SDK validated: redirect address,
    PKCE challenge, state, scopes and resource.
    """

    __tablename__ = "oauth_codes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    client_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("oauth_clients.client_id"), nullable=False, index=True
    )
    request_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    code_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True, index=True)
    params: Mapped[dict[str, Any]] = mapped_column(JSON, nullable=False)
    permissions: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, nullable=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[datetime.datetime] = mapped_column(DateTime, nullable=False, index=True)
    used_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
