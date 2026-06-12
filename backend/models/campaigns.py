"""Campaign, session note, schedule, and availability models."""
from sqlalchemy import (
    Boolean,
    Column,
    DateTime,
    ForeignKey,
    Index,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .base import Base, _utcnow, _uuid


class Campaign(Base):
    """A campaign — either a GM-run campaign or a player's personal campaign."""

    __tablename__ = "campaigns"

    id = Column(String(36), primary_key=True, default=_uuid)
    name = Column(String(255), nullable=False)
    description = Column(Text, default="")
    owner_id = Column(String(36), ForeignKey("users.id"), nullable=False, index=True)

    is_gm_campaign = Column(Boolean, default=False)
    gm_title = Column(String(100), default="Game Master")
    parent_campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=True)
    system_id = Column(String(36), ForeignKey("game_systems.id"), nullable=True)

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    deleted_at = Column(DateTime, nullable=True)
    deleted_by_id = Column(String(36), ForeignKey("users.id"), nullable=True)
    deletion_reason = Column(Text, nullable=True)

    members = relationship(
        "CampaignMember", back_populates="campaign", cascade="all, delete-orphan"
    )
    resources = relationship(
        "CampaignResource", back_populates="campaign", cascade="all, delete-orphan"
    )
    session_notes = relationship(
        "SessionNote",
        back_populates="campaign",
        cascade="all, delete-orphan",
        order_by="SessionNote.session_date",
    )
    schedule = relationship(
        "CampaignSchedule", back_populates="campaign", uselist=False, cascade="all, delete-orphan"
    )
    availability = relationship(
        "SessionAvailability", back_populates="campaign", cascade="all, delete-orphan"
    )


class CampaignMember(Base):
    """A player invited to (or who has joined) a GM-run campaign."""

    __tablename__ = "campaign_members"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    status = Column(String(20), default="invited")
    character_name = Column(String(100), nullable=True)

    created_at = Column(DateTime, default=_utcnow)

    campaign = relationship("Campaign", back_populates="members")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id"),)


class CampaignResource(Base):
    """A book, map, token, or system linked to a campaign."""

    __tablename__ = "campaign_resources"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    resource_type = Column(String(20), nullable=False)
    resource_id = Column(String(36), nullable=False)
    shared = Column(Boolean, default=False)

    campaign = relationship("Campaign", back_populates="resources")

    __table_args__ = (UniqueConstraint("campaign_id", "resource_type", "resource_id"),)


class SessionNote(Base):
    """Notes for a single session of a campaign."""

    __tablename__ = "session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    session_date = Column(String(10), nullable=False)
    title = Column(String(255), default="")

    created_at = Column(DateTime, default=_utcnow)
    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign = relationship("Campaign", back_populates="session_notes")
    player_notes = relationship(
        "PlayerSessionNote", back_populates="session", cascade="all, delete-orphan"
    )
    gm_note = relationship(
        "GMSessionNote", back_populates="session", uselist=False, cascade="all, delete-orphan"
    )


class PlayerSessionNote(Base):
    """Per-player scratch pad for a session — readable by all, writable only by owner."""

    __tablename__ = "player_session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("session_notes.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    content = Column(Text, default="")

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    session = relationship("SessionNote", back_populates="player_notes")

    __table_args__ = (UniqueConstraint("session_id", "user_id"),)


class GMSessionNote(Base):
    """GM-only internal notes + shared external notes for a session."""

    __tablename__ = "gm_session_notes"

    id = Column(String(36), primary_key=True, default=_uuid)
    session_id = Column(String(36), ForeignKey("session_notes.id"), nullable=False, unique=True)
    internal_content = Column(Text, default="")
    external_content = Column(Text, default="")

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    session = relationship("SessionNote", back_populates="gm_note")


class CampaignSchedule(Base):
    """Recurrence definition for a GM campaign's sessions."""

    __tablename__ = "campaign_schedules"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, unique=True)
    definition = Column(JSON, default=dict)

    updated_at = Column(DateTime, default=_utcnow, onupdate=_utcnow)

    campaign = relationship("Campaign", back_populates="schedule")


class SessionAvailability(Base):
    """A player's (or GM's) availability for a specific session date."""

    __tablename__ = "session_availability"

    id = Column(String(36), primary_key=True, default=_uuid)
    campaign_id = Column(String(36), ForeignKey("campaigns.id"), nullable=False, index=True)
    user_id = Column(String(36), ForeignKey("users.id"), nullable=False)
    session_date = Column(String(10), nullable=False)
    status = Column(String(20), default="available")
    is_cancelled = Column(Boolean, default=False)

    campaign = relationship("Campaign", back_populates="availability")

    __table_args__ = (UniqueConstraint("campaign_id", "user_id", "session_date"),)
