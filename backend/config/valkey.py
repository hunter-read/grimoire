"""The optional Valkey (Redis-compatible) page cache.

``connect_valkey()`` (run by ``backend.config.startup()``) connects when
VALKEY_URL is set. Everything here degrades to "no cache" without it.
"""
import urllib.parse
from typing import Any, Optional

from . import env
from .logs import logger

# A redis.Redis client once connected. redis is imported lazily, so it is untyped here.
_valkey: Any = None


def valkey_errors() -> tuple:
    """Exception types a Valkey/Redis call raises for connection/protocol failures.

    Resolved on first use rather than at import: ``redis.exceptions`` loads the
    whole client package (~6 MB per worker), which a server without
    ``VALKEY_URL`` never needs. Use it directly in ``except`` clauses -- the
    expression is only evaluated while an exception is being handled.
    """
    global _VALKEY_ERRORS
    if _VALKEY_ERRORS is None:
        try:
            from redis.exceptions import RedisError
        except ImportError:  # redis not installed: _valkey is always None
            _VALKEY_ERRORS = ()
        else:
            _VALKEY_ERRORS = (RedisError,)
    return _VALKEY_ERRORS


_VALKEY_ERRORS: Optional[tuple] = None


def redact_url(url: str) -> str:
    """``url`` with any username and password replaced, for logging.

    A Valkey with ``requirepass`` is configured as ``redis://:password@host``,
    and the log is readable in-app and by API keys with the logs permission
    (issue #583). The host stays, so the line still says where it connected.
    """
    parts = urllib.parse.urlsplit(url)
    if "@" not in parts.netloc:
        return url
    host = parts.netloc.rsplit("@", 1)[1]
    return urllib.parse.urlunsplit(parts._replace(netloc=f"***@{host}"))


# Seconds to wait for Valkey to accept a connection, and for any one command.
# Without them an unreachable host that drops packets blocks start-up until the
# OS gives up on the TCP connect (about two minutes on Linux), before uvicorn
# has bound its port. The cache is an optimisation, so a dead one should cost a
# couple of seconds and then fall back to the disk cache. The command timeout
# is longer: a page render is a few hundred KB, and a busy Valkey should not
# count as a dead one.
VALKEY_CONNECT_TIMEOUT = 2.0
VALKEY_SOCKET_TIMEOUT = 5.0


def connect_valkey() -> Optional[Any]:
    """Connect to Valkey when VALKEY_URL is set. Returns the client, or None.

    Called by startup(). A failure is logged and leaves the disk cache in
    charge; it never stops Grimoire starting. Idempotent.
    """
    global _valkey
    if not env.VALKEY_URL or _valkey is not None:
        return _valkey
    try:
        import redis as _redis_mod  # type: ignore[import-untyped]

        # Note: redis-py 7+ probes for "maintenance notifications" (a Redis
        # Enterprise feature) on connect under RESP3; Valkey/OSS Redis reject it
        # and redis-py logs a benign DEBUG line. That logger is quieted in logs.py —
        # we only use this as a page cache and don't need the feature.
        client = _redis_mod.from_url(
            env.VALKEY_URL,
            decode_responses=False,
            socket_connect_timeout=VALKEY_CONNECT_TIMEOUT,
            socket_timeout=VALKEY_SOCKET_TIMEOUT,
        )
        client.ping()
    except Exception as e:
        logger.warning(f"Valkey connection failed, falling back to disk cache: {e}")
        return None
    _valkey = client
    logger.info(f"Valkey page cache connected: {redact_url(env.VALKEY_URL)}")
    return _valkey


def valkey_client() -> Optional[Any]:
    """The Valkey client, or None when it isn't configured or couldn't connect.

    Call it where the client is used rather than importing ``_valkey``: that
    name is bound by startup(), after most modules have been imported.
    """
    return _valkey


# Key prefixes for regenerable render caches. Scan state lives under "grimoire:"
# and is deliberately excluded — purging it would wipe a running scan's status.
_CACHE_KEY_PREFIXES = ("page:", "mappage:")


def valkey_cache_set(key: str, value: bytes) -> bool:
    """Store a rendered page in Valkey under the configured TTL.

    Returns whether the write succeeded, so callers can fall back to the disk
    cache. Errors are logged rather than raised: the cache is an optimisation
    and a Valkey blip must never fail the request populating it.
    """
    if _valkey is None:
        return False
    try:
        if env.PAGE_CACHE_TTL > 0:
            _valkey.set(key, value, ex=env.PAGE_CACHE_TTL)
        else:
            _valkey.set(key, value)
        return True
    except Exception as e:
        logger.warning(f"Valkey set error: {e}")
        return False


def purge_valkey_keys(pattern: str) -> int:
    """UNLINK every Valkey key matching ``pattern``. Returns the number removed.

    Uses SCAN rather than KEYS so a large cache doesn't block the Valkey server,
    and UNLINK (falling back to DEL) so reclaim happens off the main thread.
    Errors are logged rather than raised — this is a cache, and a Valkey blip
    must never fail the scan or request that triggered the purge.
    """
    if _valkey is None:
        return 0
    removed = 0
    try:
        batch: list = []
        for key in _valkey.scan_iter(match=pattern, count=500):
            batch.append(key)
            if len(batch) >= 500:
                removed += _valkey_unlink(batch)
                batch = []
        if batch:
            removed += _valkey_unlink(batch)
    except Exception as e:
        logger.warning(f"Valkey purge of '{pattern}' failed: {e}")
    return removed


def purge_valkey_page_cache() -> int:
    """Drop every cached render from Valkey. Returns the number of keys removed.

    Runs once at startup, as a backstop. Page keys now carry a content hash, so
    a file replaced while the server was down is no longer *reachable* under its
    old key — but the superseded entries would still sit there until their TTL,
    and a pre-upgrade row (no hash yet) still falls back to an id-only key. A
    boot-time sweep keeps both cases bounded.
    """
    if _valkey is None:
        return 0
    removed = sum(purge_valkey_keys(f"{prefix}*") for prefix in _CACHE_KEY_PREFIXES)
    if removed:
        logger.info(f"Cleared {removed} cached page render(s) from Valkey")
    return removed


def _valkey_unlink(keys: list) -> int:
    """UNLINK a batch of keys, falling back to DEL on older servers."""
    try:
        return int(_valkey.unlink(*keys))
    except Exception:
        return int(_valkey.delete(*keys))
