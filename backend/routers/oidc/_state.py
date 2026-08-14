"""Shared state for the OIDC login flow — OAuth state store and JWKS cache.

Both pieces of state are per-flow rather than per-process, but the original
implementation kept them in module-level dicts. That only works for a single
replica: the app runs uvicorn with ``--workers 2`` (see ``Dockerfile``), so an
authorization callback can land on a different process than the one that
started the flow, and the ``state`` lookup misses.

Each store therefore has two implementations behind a small interface — one
backed by Valkey (shared across replicas/workers) and an in-memory fallback
that preserves the previous behavior for Valkey-less installs. The factories at
the bottom pick a backend based on Valkey availability, mirroring how the page
image cache degrades to disk in ``config.py``.
"""
import json
import logging
import time
from typing import Optional, Protocol

from ...config import _valkey


logger = logging.getLogger("grimoire.oidc")


# The authorization flow is short-lived; 10 minutes is generous for a user
# completing a login at the IdP.
_STATE_TTL = 600  # seconds
# Matches the previous in-process JWKS cache window.
_JWKS_TTL = 600  # seconds

_STATE_PREFIX = "oidc:state:"
_JWKS_PREFIX = "oidc:jwks:"


class StateStore(Protocol):
    """Single-use store for the per-flow OAuth state payload."""

    def put(self, state: str, payload: dict) -> None: ...

    def pop(self, state: str) -> Optional[dict]: ...


class JWKSCache(Protocol):
    """TTL cache for an identity provider's signing keys."""

    def get(self, jwks_uri: str) -> Optional[dict]: ...

    def set(self, jwks_uri: str, keys: dict) -> None: ...


# ---------------------------------------------------------------------------
# In-memory implementations
# ---------------------------------------------------------------------------


class MemoryStateStore:
    """Process-local state store. Entries expire after ``_STATE_TTL``."""

    def __init__(self) -> None:
        self._d: dict[str, dict] = {}

    def put(self, state: str, payload: dict) -> None:
        payload["_ts"] = time.time()
        self._d[state] = payload
        self._gc()

    def pop(self, state: str) -> Optional[dict]:
        self._gc()
        return self._d.pop(state, None)

    def _gc(self) -> None:
        cutoff = time.time() - _STATE_TTL
        for k, v in list(self._d.items()):
            if v.get("_ts", 0) < cutoff:
                self._d.pop(k, None)


class MemoryJWKSCache:
    """Process-local JWKS cache keyed by jwks_uri."""

    def __init__(self) -> None:
        self._d: dict[str, tuple[float, dict]] = {}

    def get(self, jwks_uri: str) -> Optional[dict]:
        cached = self._d.get(jwks_uri)
        if cached and (time.time() - cached[0]) < _JWKS_TTL:
            return cached[1]
        return None

    def set(self, jwks_uri: str, keys: dict) -> None:
        self._d[jwks_uri] = (time.time(), keys)

    def clear(self) -> None:
        self._d.clear()


# ---------------------------------------------------------------------------
# Valkey-backed implementations
# ---------------------------------------------------------------------------


class ValkeyStateStore:
    """State store shared across replicas via Valkey.

    Valkey's own key expiry handles the TTL, and ``GETDEL`` makes the pop
    single-use even when two callbacks race. A Valkey error on ``put`` is fatal
    to that login attempt (the callback would find no state), so it propagates
    rather than silently succeeding — unlike the page cache, this is correctness
    state, not an optimisation.
    """

    def __init__(self, client: object) -> None:
        self._client = client

    def put(self, state: str, payload: dict) -> None:
        payload["_ts"] = time.time()
        self._client.set(  # type: ignore[attr-defined]
            f"{_STATE_PREFIX}{state}", json.dumps(payload), ex=_STATE_TTL
        )

    def pop(self, state: str) -> Optional[dict]:
        key = f"{_STATE_PREFIX}{state}"
        try:
            raw = self._client.getdel(key)  # type: ignore[attr-defined]
        except Exception:
            # GETDEL needs Valkey/Redis 6.2+. Fall back to GET + DELETE, which
            # is not atomic but is equivalent for a flow the user drives once.
            raw = self._client.get(key)  # type: ignore[attr-defined]
            if raw is not None:
                self._client.delete(key)  # type: ignore[attr-defined]
        if raw is None:
            return None
        try:
            payload = json.loads(raw)
        except (TypeError, ValueError) as e:
            logger.warning("OIDC state payload could not be decoded: %s", e)
            return None
        return payload if isinstance(payload, dict) else None


class ValkeyJWKSCache:
    """JWKS cache shared across replicas via Valkey.

    Unlike the state store this *is* an optimisation — a miss just refetches
    from the IdP — so Valkey errors are logged and treated as a cache miss.
    """

    def __init__(self, client: object) -> None:
        self._client = client

    def get(self, jwks_uri: str) -> Optional[dict]:
        try:
            raw = self._client.get(f"{_JWKS_PREFIX}{jwks_uri}")  # type: ignore[attr-defined]
        except Exception as e:
            logger.warning("Valkey JWKS cache read failed: %s", e)
            return None
        if raw is None:
            return None
        try:
            keys = json.loads(raw)
        except (TypeError, ValueError):
            return None
        return keys if isinstance(keys, dict) else None

    def set(self, jwks_uri: str, keys: dict) -> None:
        try:
            self._client.set(  # type: ignore[attr-defined]
                f"{_JWKS_PREFIX}{jwks_uri}", json.dumps(keys), ex=_JWKS_TTL
            )
        except Exception as e:
            logger.warning("Valkey JWKS cache write failed: %s", e)


# ---------------------------------------------------------------------------
# Backend selection
# ---------------------------------------------------------------------------


def make_state_store(client: object = None) -> StateStore:
    """Return the Valkey-backed store when Valkey is configured, else in-memory."""
    client = client if client is not None else _valkey
    if client is None:
        return MemoryStateStore()
    logger.info("OIDC login state is shared through Valkey")
    return ValkeyStateStore(client)


def make_jwks_cache(client: object = None) -> JWKSCache:
    """Return the Valkey-backed JWKS cache when configured, else in-memory."""
    client = client if client is not None else _valkey
    if client is None:
        return MemoryJWKSCache()
    return ValkeyJWKSCache(client)


_state_store: StateStore = make_state_store()
_jwks_cache: JWKSCache = make_jwks_cache()
