"""Share links (issue #541)."""
import datetime
from typing import Any, Optional

from sqlalchemy import JSON, DateTime, ForeignKey, Index, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, _utcnow, _uuid


class ShareLink(Base):
    """A public URL for one library item, usable without logging in.

    The token is a capability: anyone holding the URL can fetch the item, and
    nothing else. Whether the link still works is decided on every request,
    never stored: the instance switch, ``revoked_at``, ``expires_at``, whether
    its creator may still create share links, and whether they can still read
    the item. A link whose creator loses either right stops resolving but is
    kept, so it comes back if the right does.

    The token itself is never stored (issue #583): ``token_hash`` is what
    requests are matched on and ``token_sealed`` the token encrypted, so the
    creator can copy the link again from their list. Both need SECRET_KEY,
    which backups do not contain - see ``backend/token_vault.py``.
    ``password_hash`` (bcrypt, as for account passwords) makes the link
    require a password on top.

    ``filename`` is the name the direct-file URL ends in. Some tools pick the
    decoder from the URL's extension, so it carries the extension of what is
    actually served - a PDF map's link ends in ``.webp``, its rendered page.

    ``variant`` makes a link serve a derived form of the item rather than the
    item itself; the access rules are the item's either way.
    """

    __tablename__ = "share_links"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    token_hash: Mapped[str] = mapped_column(String(64), nullable=False, unique=True, index=True)
    token_sealed: Mapped[str] = mapped_column(Text, nullable=False)
    # The creator. Links are deleted with their user.
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"), nullable=False, index=True)
    # book | map | token | audio | model
    resource_type: Mapped[str] = mapped_column(String(20), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(36), nullable=False)
    label: Mapped[Optional[str]] = mapped_column(String(200), default="")
    filename: Mapped[Optional[str]] = mapped_column(String(255), default="")
    # A derived form of the item to serve instead of the item itself (issue
    # #551). NULL serves the item as-is; "otfbm" serves a map resized for an
    # OTFBM background at ``variant_options["cell"]`` pixels per cell.
    variant: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    variant_options: Mapped[Optional[Any]] = mapped_column(JSON, nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    created_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, default=_utcnow)
    expires_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    revoked_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    revoked_by_id: Mapped[Optional[str]] = mapped_column(String(36), nullable=True)
    last_used_at: Mapped[Optional[datetime.datetime]] = mapped_column(DateTime, nullable=True)
    use_count: Mapped[Optional[int]] = mapped_column(Integer, default=0)

    __table_args__ = (Index("ix_share_links_resource", "resource_type", "resource_id"),)
