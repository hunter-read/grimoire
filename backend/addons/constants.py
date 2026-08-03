"""Shared constants for the add-on subsystem.

Paths, network limits, subprocess timeouts, and the ``app_settings`` keys that
hold add-on configuration and install state.
"""
import multiprocessing
import os

from .. import config

# Installed add-ons live one directory per id: DATA_PATH/add-ons/<id>/.
ADDONS_DIR = os.path.join(config.DATA_PATH, "add-ons")

# Cached upstream responses, keyed by a hash of the request URL.
ADDON_CACHE_DIR = os.path.join(ADDONS_DIR, ".cache")

# app_settings keys.  Read/written directly via the AppSetting model rather than
# the settings router helpers, which enumerate their fields explicitly and would
# not surface these.
SETTING_INDEX_URL = "addons.index_url"
SETTING_ALLOW_SCRIPTS = "addons.allow_scripts"
SETTING_INSTALLED = "addons.installed"
SETTING_INDEX_CACHE = "addons.index_cache"

DEFAULT_INDEX_URL = (
    "https://raw.githubusercontent.com/grimoire-codex/community-add-ons/main/index.json"
)

# Network limits.  Applied to every add-on fetch regardless of what a manifest
# asks for, so a hostile or broken definition cannot stall a request worker or
# exhaust memory.
HTTP_TIMEOUT = 30  # seconds
HTTP_MAX_REDIRECTS = 3
# Generous enough for a whole-catalogue document (TTRPG Wiki's is ~600 KB) while
# still bounding what a single response can cost us.
HTTP_MAX_BYTES = 32 * 1024 * 1024  # 32 MiB

DEFAULT_CACHE_TTL = 3600  # seconds, when a manifest does not specify one

# Script execution.  Bounds mirror the schema's `script.timeout` limits.
DEFAULT_SCRIPT_TIMEOUT = 60  # seconds
MAX_SCRIPT_TIMEOUT = 300  # seconds

# Spawn (not fork) the script worker: the server holds a SQLite connection and
# many threads, and forking that state into a child is unsafe.  Spawn also means
# the child inherits none of our open handles — which is the point, for code we
# did not write.
MP_CONTEXT = multiprocessing.get_context("spawn")

# Search ranking defaults, used when a manifest omits them.
DEFAULT_MIN_SCORE = 0.5
DEFAULT_SEARCH_LIMIT = 10
MAX_SEARCH_LIMIT = 50

# "Paste a link or id" support.  A definition supplies the extraction regex, so
# both the pattern and the text it runs against are bounded: a community pattern
# is untrusted input, and an unbounded match is a denial-of-service waiting to
# happen.
MAX_PATTERN_LENGTH = 200
MAX_IDENTITY_INPUT = 2048
# A resolved identity becomes part of a URL path, so it stays short and plain.
MAX_IDENTITY_LENGTH = 200
