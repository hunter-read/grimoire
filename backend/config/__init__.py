"""Grimoire's configuration, plus the database and cache it starts.

Split by concern, one module each:

* ``env`` - every environment variable the backend reads, typed, with its
  default. The one place ``os.environ`` is read (its docstring lists the few
  exceptions).
* ``paths`` - the data directories under DATA_PATH.
* ``defaults`` - fixed settings that are not environment variables.
* ``logs`` - logging set-up and the in-app log buffer.
* ``db`` - the engine and session factory.
* ``valkey`` - the optional page cache.

Importing this package only reads settings: it parses environment variables and
sets up logging, and does no file, database or network I/O (issue #585). That
makes it safe to import from anywhere, including the isolated worker processes
and one-off scripts, without migrating the database or creating directories.

Starting the application is a separate, explicit step: ``startup()`` creates
the data directories, opens and migrates the database, connects to Valkey and
logs any configuration problems. ``main.py``'s lifespan calls it before serving.
``SessionLocal`` still works without it, so scripts and tests keep working: the
first session opened initialises the database on demand.

``backend.config`` is a facade over those modules: ``config.X`` (and ``from
backend.config import X``) reads ``X`` from the module that defines it, and
assigning ``config.X`` assigns it there. So there is one copy of every setting,
and patching ``config.X`` in a test reaches the code inside ``db`` or
``valkey`` that reads it. ``importlib.reload(backend.config)`` re-reads the
environment by reloading every module, as it did when config was one file.
"""
import importlib
import sys
import types
from typing import TYPE_CHECKING, Any

from . import env, paths, defaults, logs, db, valkey

# In dependency order: each imports only from those before it. A name found in
# several (``logger``, imported from logs) belongs to the first.
_PARTS: tuple[types.ModuleType, ...] = (env, paths, defaults, logs, db, valkey)

if "_OWNERS" in globals():
    # importlib.reload(backend.config): re-read everything, not just this file.
    for _part in _PARTS:
        importlib.reload(_part)


def _owners() -> dict[str, types.ModuleType]:
    """Each setting's name -> the module that defines it."""
    owners: dict[str, types.ModuleType] = {}
    for part in reversed(_PARTS):
        # Annotated-only names (VERSION, SessionLocal) are resolved on first use.
        for name in getattr(part, "__annotations__", {}):
            owners[name] = part
        for name, value in vars(part).items():
            if name.startswith("__") or isinstance(value, types.ModuleType):
                continue
            if isinstance(value, (types.FunctionType, type)) and value.__module__ != part.__name__:
                continue  # imported from elsewhere, not a setting of this module
            owners[name] = part
    return owners


_OWNERS = _owners()


def startup() -> None:
    """Start the application: everything importing config deliberately doesn't do.

    Logs the configuration problems found while parsing, creates the data
    directories, opens and migrates the database, and connects to Valkey.
    Idempotent, so every uvicorn worker (and a test client) can call it.
    """
    while env._deferred_warnings:
        msg, args = env._deferred_warnings.pop(0)
        logs.logger.warning(msg, *args)
    paths.ensure_data_dirs()
    db.init_database()
    valkey.connect_valkey()


class _Facade(types.ModuleType):
    def __setattr__(self, name: str, value: Any) -> None:
        owner = _OWNERS.get(name)
        if owner is None:
            super().__setattr__(name, value)
        else:
            setattr(owner, name, value)

    def __delattr__(self, name: str) -> None:
        owner = _OWNERS.get(name)
        if owner is None:
            super().__delattr__(name)
        else:
            delattr(owner, name)

    def __dir__(self) -> list[str]:
        return sorted({*super().__dir__(), *_OWNERS})


sys.modules[__name__].__class__ = _Facade

if TYPE_CHECKING:
    from .env import (
        VERSION as VERSION,
        COMMIT_HASH as COMMIT_HASH,
        OPDS_ENABLED as OPDS_ENABLED,
        API_DOCS as API_DOCS,
        MCP_ENABLED as MCP_ENABLED,
        MCP_ALLOWED_HOSTS as MCP_ALLOWED_HOSTS,
        BASE_URL as BASE_URL,
        LIBRARY_PATH as LIBRARY_PATH,
        DATA_PATH as DATA_PATH,
        VALKEY_URL as VALKEY_URL,
        OCR_ENABLED as OCR_ENABLED,
        OCR_LANGUAGES as OCR_LANGUAGES,
        STARTUP_SCAN as STARTUP_SCAN,
        DISABLE_VERSION_CHECKING as DISABLE_VERSION_CHECKING,
        UMASK as UMASK,
        LIBRARY_FILE_MODE as LIBRARY_FILE_MODE,
        OCR_CONCURRENCY as OCR_CONCURRENCY,
        OCR_DPI as OCR_DPI,
        OCR_MIN_TEXT_COVERAGE as OCR_MIN_TEXT_COVERAGE,
        OCR_MIN_PAGE_CHARS as OCR_MIN_PAGE_CHARS,
        MAX_IMAGE_PIXELS as MAX_IMAGE_PIXELS,
        OCR_PAGE_TIMEOUT as OCR_PAGE_TIMEOUT,
        PAGE_RECLAIM_INTERVAL as PAGE_RECLAIM_INTERVAL,
        PAGE_IDLE_RELEASE as PAGE_IDLE_RELEASE,
        RENDER_WORKERS as RENDER_WORKERS,
        PAGE_CACHE_TTL as PAGE_CACHE_TTL,
        PAGE_CACHE_MAX_MB as PAGE_CACHE_MAX_MB,
        ALLOW_PASSWORD_AUTHENTICATION_ENV as ALLOW_PASSWORD_AUTHENTICATION_ENV,
        GUEST_ACCESS_ENABLED_ENV as GUEST_ACCESS_ENABLED_ENV,
        API_KEYS_ENABLED as API_KEYS_ENABLED,
        SHARE_LINKS_ENABLED as SHARE_LINKS_ENABLED,
        CORS_ALLOWED_ORIGINS as CORS_ALLOWED_ORIGINS,
        BACKUP_DIR_ENV as BACKUP_DIR_ENV,
        BACKUP_DIR as BACKUP_DIR,
        BACKUP_SCHEDULE_ENV as BACKUP_SCHEDULE_ENV,
        BACKUP_RETENTION_COUNT_ENV as BACKUP_RETENTION_COUNT_ENV,
        BACKUP_RETENTION_GB_ENV as BACKUP_RETENTION_GB_ENV,
        DISABLE_EXTERNAL_ADD_ON_INSTALL as DISABLE_EXTERNAL_ADD_ON_INSTALL,
        ADDON_INDEX_CREDENTIALS as ADDON_INDEX_CREDENTIALS,
        DISABLE_FOLDER_CATEGORY_INFERENCE_ENV as DISABLE_FOLDER_CATEGORY_INFERENCE_ENV,
        LIBRARY_WATCH_ENV as LIBRARY_WATCH_ENV,
        LIBRARY_WATCH_MODES as LIBRARY_WATCH_MODES,
        LIBRARY_WATCH_MODE_ENV as LIBRARY_WATCH_MODE_ENV,
        LIBRARY_WATCH_DELAY as LIBRARY_WATCH_DELAY,
        LIBRARY_WATCH_POLL_INTERVAL as LIBRARY_WATCH_POLL_INTERVAL,
        OIDC_ENV as OIDC_ENV,
        LOG_TIMEZONE as LOG_TIMEZONE,
        LOG_LEVEL as LOG_LEVEL,
        SECRET_KEY_ENV as SECRET_KEY_ENV,
        ACCESS_TOKEN_EXPIRE_MINUTES as ACCESS_TOKEN_EXPIRE_MINUTES,
        REFRESH_TOKEN_EXPIRE_DAYS as REFRESH_TOKEN_EXPIRE_DAYS,
        DEFAULT_PASSWORD_MIN_LENGTH as DEFAULT_PASSWORD_MIN_LENGTH,
        DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH as DEFAULT_SHARE_LINK_PASSWORD_MIN_LENGTH,
        PASSWORD_MIN_LENGTH as PASSWORD_MIN_LENGTH,
        SHARE_LINK_PASSWORD_MIN_LENGTH as SHARE_LINK_PASSWORD_MIN_LENGTH,
        AUTH_RATE_LIMIT as AUTH_RATE_LIMIT,
        ACCOUNT_RATE_LIMIT as ACCOUNT_RATE_LIMIT,
        UNDER_PYTEST as UNDER_PYTEST,
        RATE_LIMIT_ENABLED as RATE_LIMIT_ENABLED,
        TRUST_FORWARDED_FOR as TRUST_FORWARDED_FOR,
        DEFAULT_TRUSTED_PROXIES as DEFAULT_TRUSTED_PROXIES,
        TRUSTED_PROXIES as TRUSTED_PROXIES,
        CODEX_DB_API_TOKEN as CODEX_DB_API_TOKEN,
        CODEX_DB_ENV as CODEX_DB_ENV,
        FFMPEG_BINARY as FFMPEG_BINARY,
        under_test_run as under_test_run,
    )
    from .paths import (
        DB_PATH as DB_PATH,
        THUMB_DIR as THUMB_DIR,
        PAGE_CACHE_DIR as PAGE_CACHE_DIR,
        CAMPAIGN_UPLOAD_DIR as CAMPAIGN_UPLOAD_DIR,
        CHARACTER_PORTRAIT_DIR as CHARACTER_PORTRAIT_DIR,
        CHARACTER_IMAGE_DIR as CHARACTER_IMAGE_DIR,
        SYSTEM_COVER_DIR as SYSTEM_COVER_DIR,
        AUDIO_COVER_DIR as AUDIO_COVER_DIR,
        BRANDING_DIR as BRANDING_DIR,
        ensure_data_dirs as ensure_data_dirs,
    )
    from .defaults import (
        DEFAULT_WIKI_TEMPLATE_INDEX_URL as DEFAULT_WIKI_TEMPLATE_INDEX_URL,
        DEFAULT_THEME_INDEX_URL as DEFAULT_THEME_INDEX_URL,
        _PAGE_CACHE_HEADERS as _PAGE_CACHE_HEADERS,
        _MEDIA_FILE_CACHE_HEADERS as _MEDIA_FILE_CACHE_HEADERS,
        _THUMBNAIL_CACHE_HEADERS as _THUMBNAIL_CACHE_HEADERS,
    )
    from .logs import (
        logger as logger,
        _memory_handler as _memory_handler,
    )
    from .db import (
        engine as engine,
        SessionLocal as SessionLocal,
        init_database as init_database,
        get_db as get_db,
    )
    from .valkey import (
        valkey_errors as valkey_errors,
        redact_url as redact_url,
        VALKEY_CONNECT_TIMEOUT as VALKEY_CONNECT_TIMEOUT,
        VALKEY_SOCKET_TIMEOUT as VALKEY_SOCKET_TIMEOUT,
        connect_valkey as connect_valkey,
        valkey_client as valkey_client,
        valkey_cache_set as valkey_cache_set,
        purge_valkey_keys as purge_valkey_keys,
        purge_valkey_page_cache as purge_valkey_page_cache,
    )
else:

    def __getattr__(name: str) -> Any:
        owner = _OWNERS.get(name)
        if owner is None:
            raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
        return getattr(owner, name)
