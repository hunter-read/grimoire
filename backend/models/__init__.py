"""Database models for Grimoire.

Models are organised by domain (library, media, users, campaigns, settings)
and re-exported here so callers can keep using ``from backend.models import X``.
"""

from .base import Base
from .campaigns import (
    Campaign,
    CampaignCategory,
    CampaignFile,
    CampaignMember,
    CampaignResource,
    CampaignResourceShare,
    CampaignSchedule,
    GMSessionNote,
    PlayerSessionNote,
    SessionAvailability,
    SessionNote,
    WikiPage,
    WikiPageHidden,
    WikiPageLink,
    WikiPageShare,
    WikiTemplate,
)
from .db import init_db
from .library import (
    Book,
    BookFolder,
    DiceMaterial,
    GameSystem,
    Genre,
    License,
    ParentSystem,
    SystemFamily,
)
from .media import Audio, AudioFolder, GenericMap, MapFolder, Token, TokenFolder
from .settings import AppSetting
from .tags import RESOURCE_TYPES, SHARED_CATEGORY, TAG_CATEGORIES, ResourceTag, Tag
from .users import AuthSession, Bookmark, Favorite, SavedFilter, User, UserTheme

__all__ = [
    "Base",
    "init_db",
    # Library
    "GameSystem",
    "Book",
    "BookFolder",
    "Genre",
    "SystemFamily",
    "ParentSystem",
    "License",
    "DiceMaterial",
    # Media
    "GenericMap",
    "MapFolder",
    "Token",
    "TokenFolder",
    "Audio",
    "AudioFolder",
    # Users
    "User",
    "AuthSession",
    "Bookmark",
    "Favorite",
    "SavedFilter",
    "UserTheme",
    # Campaigns
    "Campaign",
    "CampaignMember",
    "CampaignResource",
    "CampaignResourceShare",
    "CampaignFile",
    "SessionNote",
    "PlayerSessionNote",
    "GMSessionNote",
    "WikiPage",
    "WikiPageShare",
    "WikiPageHidden",
    "WikiTemplate",
    "WikiPageLink",
    "CampaignCategory",
    "CampaignSchedule",
    "SessionAvailability",
    # Settings
    "AppSetting",
    # Tags
    "Tag",
    "ResourceTag",
    "RESOURCE_TYPES",
    "SHARED_CATEGORY",
    "TAG_CATEGORIES",
]
