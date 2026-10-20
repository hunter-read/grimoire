"""Access tokens for private add-on index sources (issue #642).

A table that keeps licensed or non-SRD content in an invite-only repository
needs Grimoire to authenticate when it reads that repository's catalogue - and
every file the catalogue points at, since the manifests, sheets and pack files
live in the same repository.

A credential belongs to one configured index URL and is sent only to URLs
*inside that source*: the same scheme, host and port, under the source's root
directory (the index's own directory, or its parent when the index sits in one
of the sibling catalogue directories such as ``themes/``). So a private repo on
``raw.githubusercontent.com`` does not hand its token to the public community
repo on the same host, and a redirect that leaves the source drops the header
(see :meth:`SourceCredentials.apply`).

Only the catalogue fetchers pass credentials. A scraper add-on's requests to
its target site never do, so a token cannot leak to a third-party site that a
community definition names.

Tokens are stored sealed under SECRET_KEY (``token_vault.seal_secret``), like
the OIDC client secret, so a database backup alone does not carry them. They
can also be pinned with ``ADDON_INDEX_CREDENTIALS``. Neither is ever returned
by the API - only which header a source uses and whether it is pinned.
"""
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional
from urllib.parse import urlsplit

import httpx
from sqlalchemy.orm import Session

from .. import config, token_vault
from .constants import SETTING_INDEX_CREDENTIALS
from .fetch import clear_cache
from .registry import AddonError, _get_setting, _set_setting

logger = logging.getLogger("grimoire.addons")

DEFAULT_HEADER = "Authorization"
MAX_TOKEN_LENGTH = 4096

#: An HTTP field name (RFC 9110 token characters, without the rarely used
#: punctuation), bounded so a typo cannot become an enormous header.
_HEADER_NAME = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$")

#: Headers httpx or the server rely on. Letting a credential replace one would
#: break the request at best and smuggle something at worst.
_RESERVED_HEADERS = {
    "accept",
    "accept-encoding",
    "connection",
    "content-length",
    "content-type",
    "cookie",
    "host",
    "te",
    "transfer-encoding",
    "upgrade",
    "user-agent",
}

#: Catalogue directories that sit beside each other in a source repository. An
#: index inside one of them (``.../main/themes/index.json``) has the directory
#: above as its root, so the sibling catalogues derived from it stay in scope.
_SIBLING_DIRECTORIES = ("themes", "templates", "character-sheets", "content-packs")

# Sealed values already reported as unreadable, so a changed SECRET_KEY is
# logged once per token rather than on every fetch.
_unreadable: set[str] = set()


def _origin(url: str) -> tuple[str, str, Optional[int]]:
    parts = urlsplit(url.strip())
    scheme = parts.scheme.lower()
    try:
        port = parts.port
    except ValueError:
        port = None
    if port is None:
        port = {"https": 443, "http": 80}.get(scheme)
    return scheme, (parts.hostname or "").lower(), port


def source_root(url: str) -> str:
    """The path every file of the source at ``url`` lives under, ending in ``/``."""
    path = urlsplit(url.strip()).path
    segments = [s for s in path.split("/") if s]
    if segments and "." in segments[-1]:
        # An index file rather than a directory: its directory is the source.
        segments = segments[:-1]
        if segments and segments[-1] in _SIBLING_DIRECTORIES:
            segments = segments[:-1]
    return "/" + "".join(f"{s}/" for s in segments)


def _header_value(header: str, token: str) -> str:
    """``Authorization`` gets the Bearer scheme unless the token names its own
    (``token abc``, ``Basic ...``); any other header carries the token as is."""
    if header.lower() == "authorization" and " " not in token:
        return f"Bearer {token}"
    return token


@dataclass(frozen=True)
class SourceCredential:
    source_url: str
    header: str
    token: str

    def covers(self, url: str) -> bool:
        if _origin(url) != _origin(self.source_url):
            return False
        return urlsplit(url).path.startswith(source_root(self.source_url))


class SourceCredentials:
    """Every usable credential, loaded once per operation and passed to fetches."""

    def __init__(self, credentials: Optional[list[SourceCredential]] = None) -> None:
        self._credentials = list(credentials or [])

    def __bool__(self) -> bool:
        return bool(self._credentials)

    def for_url(self, url: str) -> Optional[SourceCredential]:
        """The credential for ``url``: the covering source with the deepest root."""
        matches = [c for c in self._credentials if c.covers(url)]
        if not matches:
            return None
        return max(matches, key=lambda c: len(source_root(c.source_url)))

    def headers_for(self, url: str) -> dict[str, str]:
        cred = self.for_url(url)
        if cred is None:
            return {}
        return {cred.header: _header_value(cred.header, cred.token)}

    def apply(self, request: httpx.Request) -> None:
        """An httpx request hook, run on the first request **and every redirect**.

        Every credential header is stripped first and the right one, if any, put
        back. httpx already drops ``Authorization`` on a cross-origin redirect,
        but a custom header (``PRIVATE-TOKEN``) would otherwise ride along to
        wherever the source redirects.
        """
        for cred in self._credentials:
            request.headers.pop(cred.header, None)
        request.headers.update(self.headers_for(str(request.url)))


# --- validation ----------------------------------------------------------


def _clean_header(header: Optional[str]) -> str:
    name = (header or "").strip() or DEFAULT_HEADER
    if not _HEADER_NAME.match(name) or name.lower() in _RESERVED_HEADERS:
        raise AddonError(f"'{name}' cannot be used as the token's header")
    return name


def _clean_token(token: Optional[str]) -> str:
    value = (token or "").strip()
    if not value:
        raise AddonError("Enter the access token")
    if len(value) > MAX_TOKEN_LENGTH:
        raise AddonError("That access token is too long")
    # A control character (a pasted newline above all) would split the header.
    if any(ord(c) < 0x20 or ord(c) == 0x7F for c in value):
        raise AddonError("That access token contains a line break or control character")
    return value


def _normalise(url: str) -> str:
    return url.strip().rstrip("/")


# --- environment pins ----------------------------------------------------


def _env_entries() -> dict[str, dict[str, str]]:
    """``ADDON_INDEX_CREDENTIALS``, parsed. Bad entries are logged and skipped.

    A JSON object mapping an index URL to a token, or to
    ``{"token": "...", "header": "PRIVATE-TOKEN"}``.
    """
    raw = (config.ADDON_INDEX_CREDENTIALS or "").strip()
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("ADDON_INDEX_CREDENTIALS is not valid JSON; ignoring it")
        return {}
    if not isinstance(data, dict):
        logger.warning("ADDON_INDEX_CREDENTIALS must be a JSON object; ignoring it")
        return {}

    out: dict[str, dict[str, str]] = {}
    for url, value in data.items():
        spec = value if isinstance(value, dict) else {"token": value}
        try:
            token = _clean_token(spec.get("token") if isinstance(spec.get("token"), str) else "")
            header = _clean_header(spec.get("header") if isinstance(spec.get("header"), str) else None)
        except AddonError as exc:
            logger.warning("Ignoring ADDON_INDEX_CREDENTIALS entry for %s: %s", url, exc)
            continue
        out[_normalise(str(url))] = {"token": token, "header": header}
    return out


# --- stored credentials --------------------------------------------------


def _stored(db: Session) -> dict[str, dict[str, str]]:
    raw = _get_setting(db, SETTING_INDEX_CREDENTIALS, "")
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except ValueError:
        logger.warning("Add-on setting '%s' is not valid JSON; ignoring it", SETTING_INDEX_CREDENTIALS)
        return {}
    if not isinstance(data, dict):
        return {}
    return {k: v for k, v in data.items() if isinstance(v, dict)}


def _save(db: Session, stored: dict[str, dict[str, str]]) -> None:
    _set_setting(db, SETTING_INDEX_CREDENTIALS, json.dumps(stored))


def _unseal(sealed: str, url: str) -> Optional[str]:
    token = token_vault.unseal_secret(sealed)
    if token is None and sealed not in _unreadable:
        _unreadable.add(sealed)
        logger.warning(
            "The access token saved for add-on source %s cannot be decrypted - "
            "SECRET_KEY has changed since it was saved. Enter it again in "
            "Settings > Add-ons.",
            url,
        )
    return token


def load(db: Session) -> SourceCredentials:
    """Every credential that can be used right now. Env pins win per URL."""
    creds: dict[str, SourceCredential] = {}
    for url, spec in _stored(db).items():
        token = _unseal(str(spec.get("token") or ""), url)
        if token:
            creds[url] = SourceCredential(url, str(spec.get("header") or DEFAULT_HEADER), token)
    for url, spec in _env_entries().items():
        creds[url] = SourceCredential(url, spec["header"], spec["token"])
    return SourceCredentials(list(creds.values()))


def describe(db: Session, urls: list[str]) -> dict[str, dict[str, Any]]:
    """What the UI may know about each configured source's credential.

    Keyed by the URL as configured. Never includes the token: only the header,
    whether ``ADDON_INDEX_CREDENTIALS`` pins it, and whether a stored token has
    become unreadable (SECRET_KEY changed) and needs entering again.
    """
    stored = _stored(db)
    pinned = _env_entries()
    out: dict[str, dict[str, Any]] = {}
    for url in urls:
        key = _normalise(url)
        if key in pinned:
            out[url] = {"header": pinned[key]["header"], "env_locked": True, "unreadable": False}
        elif key in stored:
            spec = stored[key]
            out[url] = {
                "header": str(spec.get("header") or DEFAULT_HEADER),
                "env_locked": False,
                "unreadable": _unseal(str(spec.get("token") or ""), key) is None,
            }
    return out


def _assert_settable(url: str, configured: list[str]) -> str:
    key = _normalise(url)
    if key not in {_normalise(u) for u in configured}:
        raise AddonError("Add this index URL as a source before giving it an access token")
    if key in _env_entries():
        raise AddonError(
            "This source's access token is set by ADDON_INDEX_CREDENTIALS and cannot be changed here"
        )
    return key


def set_credential(
    db: Session, url: str, token: str, header: Optional[str], configured: list[str]
) -> None:
    """Store (or replace) the token for one configured source.

    Clears the add-on response cache: a catalogue fetched with the old token -
    or without one - must not keep answering for the new one.
    """
    key = _assert_settable(url, configured)
    stored = _stored(db)
    stored[key] = {"header": _clean_header(header), "token": token_vault.seal_secret(_clean_token(token))}
    _save(db, stored)
    clear_cache()


def clear_credential(db: Session, url: str, configured: list[str]) -> None:
    """Forget one source's stored token, and the responses fetched with it."""
    key = _assert_settable(url, configured)
    stored = _stored(db)
    if stored.pop(key, None) is not None:
        _save(db, stored)
        clear_cache()


def prune(db: Session, configured: list[str]) -> None:
    """Drop stored tokens for sources that are no longer configured.

    A removed source should not leave a working credential behind in the
    database, and re-adding it later is a deliberate step that can take the
    token again.
    """
    keep = {_normalise(u) for u in configured}
    stored = _stored(db)
    kept = {url: spec for url, spec in stored.items() if url in keep}
    if len(kept) != len(stored):
        _save(db, kept)
        clear_cache()
