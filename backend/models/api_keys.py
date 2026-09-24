"""Personal API keys (issue #489)."""
from sqlalchemy import JSON, Column, DateTime, ForeignKey, String

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
    """

    __tablename__ = "api_keys"

    id = Column(String(36), primary_key=True, default=_uuid)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    name = Column(String(100), nullable=False)
    prefix = Column(String(16), nullable=False)
    key_hash = Column(String(64), nullable=False, unique=True, index=True)
    permissions = Column(JSON, default=dict)
    created_at = Column(DateTime, default=_utcnow)
    last_used_at = Column(DateTime, nullable=True)
    expires_at = Column(DateTime, nullable=True)
