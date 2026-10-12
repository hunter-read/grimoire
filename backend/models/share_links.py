"""Share links (issue #541)."""
from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String

from .base import Base, _utcnow, _uuid


class ShareLink(Base):
    """A public URL for one library item, usable without logging in.

    The token is a capability: anyone holding the URL can fetch the item, and
    nothing else. Whether the link still works is decided on every request,
    never stored: the instance switch, ``revoked_at``, ``expires_at``, whether
    its creator may still create share links, and whether they can still read
    the item. A link whose creator loses either right stops resolving but is
    kept, so it comes back if the right does.

    ``token`` is stored in plaintext, like the calendar and OPDS tokens, so the
    creator can copy the link again from their list. ``password_hash`` (bcrypt,
    as for account passwords) makes the link require a password on top.

    ``filename`` is the name the direct-file URL ends in. Some tools pick the
    decoder from the URL's extension, so it carries the extension of what is
    actually served - a PDF map's link ends in ``.webp``, its rendered page.
    """

    __tablename__ = "share_links"

    id = Column(String(36), primary_key=True, default=_uuid)
    token = Column(String(64), nullable=False, unique=True, index=True)
    # The creator. Links are deleted with their user.
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # book | map | token | audio | model
    resource_type = Column(String(20), nullable=False)
    resource_id = Column(String(36), nullable=False)
    label = Column(String(200), default="")
    filename = Column(String(255), default="")
    password_hash = Column(String(255), nullable=True)
    created_at = Column(DateTime, default=_utcnow)
    expires_at = Column(DateTime, nullable=True)
    revoked_at = Column(DateTime, nullable=True)
    revoked_by_id = Column(String(36), nullable=True)
    last_used_at = Column(DateTime, nullable=True)
    use_count = Column(Integer, default=0)

    __table_args__ = (Index("ix_share_links_resource", "resource_type", "resource_id"),)
