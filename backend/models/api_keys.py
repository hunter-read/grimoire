"""Personal API keys (issue #489)."""
import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, String
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class ApiKey(Base):
    """A named key that lets a script or integration call the API as its owner.

    A key acts as ``user_id`` - their role, their campaigns, their favourites -
    narrowed by ``permissions``, a ``{permission: level}`` map where level is
    ``"read"`` or ``"write"`` and an absent permission means no access. It can
    never do more than its owner could; see ``backend/api_keys.py``. Keys are
    deleted with their owner.

    Only a SHA-256 hash of the key is stored; the plaintext is returned once, by
    create or regenerate, and never again. ``prefix`` is the first few characters
    of it, kept so the UI can tell keys apart.

    A row with ``client_id`` set is an **OAuth grant** (issue #906): a user
    approved an MCP client, and the client holds tokens instead of a key. Its
    ``key_hash`` is the hash of a value nobody was ever given, so it can't be
    used as ``X-API-Key``; the client authenticates with the access token in
    ``access_token_hash`` and renews it with the refresh token. The grant
    itself does not expire (``expires_at`` stays empty); its tokens do. See
    ``backend/mcp_oauth``.
    """

    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    prefix: Mapped[str] = mapped_column(String(16), nullable=False)
    key_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    permissions: Mapped[Optional[dict[str, Any]]] = mapped_column(JSON, default=dict)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    last_used_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)

    # OAuth grants only (issue #906); all empty for an ordinary key.
    client_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True, index=True)
    access_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    access_expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    refresh_token_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    # The refresh token this one replaced, accepted until prev_refresh_until so
    # two refreshes sent at once both succeed (see mcp_oauth/grants.py).
    prev_refresh_hash: Mapped[Optional[str]] = mapped_column(String(64), nullable=True, unique=True, index=True)
    prev_refresh_until: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    refresh_expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
