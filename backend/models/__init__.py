"""Database models for Grimoire.

Models are organised by domain (library, media, users, campaigns, settings)
and re-exported here so callers can keep using ``from backend.models import X``.
"""

from .access import FolderAccessRule, UserAccessGrant
from .api_keys import ApiKey
from .armies import Army, PublicationLink
from .audio_sets import SET_TYPES, AudioSet
from .base import Base
from .book_links import BookSystemLink
from .characters import Character, CharacterSchema, UserImporter
from .content import ContentEntry, ContentPack, Ruleset, RulesetEntry
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
from .duplicates import DuplicateDismissal, DuplicateGroup
from .factions import Faction, book_factions
from .leagues import League, LeagueGame, LeagueMember, LeagueResource, LeagueResourceShare
from .library import (
    Book,
    BookFolder,
    DiceMaterial,
    FolderNamingRule,
    GameSystem,
    Genre,
    License,
    ParentSystem,
    SystemFamily,
)
from .media import (
    Audio,
    AudioFolder,
    GenericMap,
    MapFolder,
    Model3D,
    Model3DFolder,
    Token,
    TokenFolder,
)
from .settings import AppSetting
from .share_links import ShareLink
from .tags import RESOURCE_TYPES, SHARED_CATEGORY, TAG_CATEGORIES, ResourceTag, Tag
from .variants import VARIANT_KINDS, VARIANT_KINDS_BY_TYPE, kinds_for
from .users import AuthSession, Bookmark, Favorite, Pin, SavedFilter, User, UserTheme
from .browse import register_sort_key_events

register_sort_key_events([GenericMap, Token, Audio, Model3D], Book)

__all__ = [
    "Base",
    "init_db",
    # Access control
    "UserAccessGrant",
    "FolderAccessRule",
    # Library
    "GameSystem",
    "Book",
    "BookFolder",
    "BookSystemLink",
    "FolderNamingRule",
    "Genre",
    "SystemFamily",
    "ParentSystem",
    "License",
    "DiceMaterial",
    # Wargames
    "Faction",
    "book_factions",
    # Armies and leagues
    "Army",
    "PublicationLink",
    "League",
    "LeagueMember",
    "LeagueGame",
    "LeagueResource",
    "LeagueResourceShare",
    # Media
    "GenericMap",
    "MapFolder",
    "Model3D",
    "Model3DFolder",
    "Token",
    "TokenFolder",
    "Audio",
    "AudioFolder",
    # Variants / duplicates
    "VARIANT_KINDS",
    "VARIANT_KINDS_BY_TYPE",
    "kinds_for",
    "DuplicateGroup",
    "DuplicateDismissal",
    # Users
    "User",
    "AuthSession",
    "Bookmark",
    "Favorite",
    "Pin",
    "SavedFilter",
    "UserTheme",
    # Saved audio sets
    "AudioSet",
    "SET_TYPES",
    # Characters
    "CharacterSchema",
    "Character",
    "UserImporter",
    # Character content catalog
    "ContentPack",
    "ContentEntry",
    "Ruleset",
    "RulesetEntry",
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
    "ApiKey",
    "ShareLink",
    # Tags
    "Tag",
    "ResourceTag",
    "RESOURCE_TYPES",
    "SHARED_CATEGORY",
    "TAG_CATEGORIES",
]
