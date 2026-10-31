"""Where Grimoire keeps its data: the directories under DATA_PATH.

Paths are worked out at import; ``ensure_data_dirs()`` (run by
``backend.config.startup()``) is what creates them.
"""
import os

from . import env

DB_PATH = os.path.join(env.DATA_PATH, "grimoire.db")
THUMB_DIR = os.path.join(env.DATA_PATH, "thumbnails")
PAGE_CACHE_DIR = os.path.join(env.DATA_PATH, "page_cache")
CAMPAIGN_UPLOAD_DIR = os.path.join(env.DATA_PATH, "campaign_uploads")
CHARACTER_PORTRAIT_DIR = os.path.join(env.DATA_PATH, "character_portraits")
# Pictures a sheet's `image` fields hold, one subdirectory per character.
CHARACTER_IMAGE_DIR = os.path.join(env.DATA_PATH, "character_images")
SYSTEM_COVER_DIR = os.path.join(env.DATA_PATH, "system_covers")
AUDIO_COVER_DIR = os.path.join(env.DATA_PATH, "audio_covers")
# Covers an admin uploaded for a single book, replacing the generated thumbnail.
# Kept apart from THUMB_DIR on purpose: everything under thumbnails/ is derived
# and may be regenerated or swept by a scan, while these are user-authored.
BOOK_COVER_DIR = os.path.join(env.DATA_PATH, "book_covers")
# Admin-uploaded login-page assets (the OIDC button icon, issue #377).
BRANDING_DIR = os.path.join(env.DATA_PATH, "branding")

# Data directories Grimoire writes into, created by startup(). Character
# portraits sit beside the campaign uploads rather than inside them, because a
# character may have no campaign.
_DATA_DIRS = (
    env.DATA_PATH,
    THUMB_DIR,
    os.path.join(THUMB_DIR, "books"),
    os.path.join(THUMB_DIR, "maps"),
    PAGE_CACHE_DIR,
    os.path.join(CAMPAIGN_UPLOAD_DIR, "banners"),
    os.path.join(CAMPAIGN_UPLOAD_DIR, "art"),
    os.path.join(CAMPAIGN_UPLOAD_DIR, "tokens"),
    os.path.join(CAMPAIGN_UPLOAD_DIR, "sheets"),
    os.path.join(CAMPAIGN_UPLOAD_DIR, "files"),
    CHARACTER_PORTRAIT_DIR,
    CHARACTER_IMAGE_DIR,
    SYSTEM_COVER_DIR,
    AUDIO_COVER_DIR,
    BOOK_COVER_DIR,
    BRANDING_DIR,
)


def ensure_data_dirs() -> None:
    for path in _DATA_DIRS:
        os.makedirs(path, exist_ok=True)

