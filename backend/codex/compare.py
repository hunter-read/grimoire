"""What sending a local record would change in Grimoire Codex DB.

The outbound mirror of fetching metadata: per field, what this library has, what
Grimoire Codex DB has, and whether they differ, so the send form can pre-select
exactly the fields worth sending instead of making someone tick them by hand.

    only_local   Grimoire Codex DB has nothing here: sending fills it in
    differs      both have a value and they disagree
    same         already matches: nothing to send
    only_remote  this library has nothing here: sending would clear Grimoire Codex DB's value

Values are compared the way Grimoire Codex DB stores them (a category as a slug,
an ISBN without hyphens, links merged rather than replaced), so a field that
would not change on the other side never reads as a difference.
"""
import re
from typing import Any, Optional, Union
from urllib.parse import urlsplit

from sqlalchemy.orm import Session

from .. import addons
from ..addons import diff as addon_diff
from ..models import Book, GameSystem
from ..text import slugs

STATUS_ONLY_LOCAL = "only_local"
STATUS_DIFFERS = "differs"
STATUS_SAME = "same"
STATUS_ONLY_REMOTE = "only_remote"
# The cover only: neither side has one.
STATUS_NONE = "none"

# Grimoire Codex DB stores uploads as ``covers/<sha256>.<ext>``, so the key alone says
# whether it already holds the exact image this library would send.
_COVER_KEY = re.compile(r"/covers/([0-9a-f]{64})\.[a-z]+$")
# "RPGGeek (System)" is the add-on, not who to credit: the credit is "RPGGeek".
_NAME_SUFFIX = re.compile(r"\s*\([^)]*\)\s*$")


def _slug(value: str) -> str:
    """Grimoire Codex DB's ``slugify``: how it stores a book's category."""
    return slugs.slugify(value, fold="accents", amp=" and ", max_len=100)


def _matches(field: str, local: Any, remote: Any) -> bool:
    if field == "category":
        return (_slug(str(local)) or "other") == (_slug(str(remote)) or "other")
    if field == "isbn":
        return re.sub(r"[\s-]", "", str(local)).upper() == re.sub(r"[\s-]", "", str(remote)).upper()
    if field == "description":
        return " ".join(str(local).split()) == " ".join(str(remote).split())
    return bool(addon_diff.normalise(field, local) == addon_diff.normalise(field, remote))


# Numbers where 0 means "not known": a page count Grimoire has not counted yet.
_ZERO_IS_EMPTY = frozenset({"page_count", "year", "month", "day"})


def _empty(field: str, value: Any) -> bool:
    return addon_diff.is_empty(value) or (field in _ZERO_IS_EMPTY and value == 0)


def field_status(field: str, local: Any, remote: Any) -> Optional[str]:
    """How ``field`` compares, or None when neither side has a value."""
    local_empty = _empty(field, local)
    remote_empty = _empty(field, remote)
    if local_empty and remote_empty:
        return None
    if remote_empty:
        return STATUS_ONLY_LOCAL
    if local_empty:
        return STATUS_ONLY_REMOTE
    if field in addon_diff.LINK_LIST_FIELDS:
        # Links are added on the other side, never replaced: a link it lacks is new, not a conflict.
        ours = addon_diff.normalise(field, local) or frozenset()
        theirs = addon_diff.normalise(field, remote) or frozenset()
        return STATUS_SAME if ours <= theirs else STATUS_ONLY_LOCAL
    return STATUS_SAME if _matches(field, local, remote) else STATUS_DIFFERS


def compare_fields(local: dict[str, Any], remote: Optional[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per field either side has, in ``local``'s order.

    ``remote`` is None for a record that is not linked yet: then every field this
    library has is new to Grimoire Codex DB.
    """
    rows = []
    for field, value in local.items():
        theirs = remote.get(field) if remote is not None else None
        status = field_status(field, value, theirs)
        if status is None:
            continue
        rows.append(
            {
                "field": field,
                "local": None if _empty(field, value) else value,
                "remote": None if _empty(field, theirs) else theirs,
                "status": status,
            }
        )
    return rows


def cover_status(local_sha256: Optional[str], remote_url: Optional[str]) -> str:
    """How the cover this library would send compares with Grimoire Codex DB's."""
    if not local_sha256:
        return STATUS_ONLY_REMOTE if remote_url else STATUS_NONE
    if not remote_url:
        return STATUS_ONLY_LOCAL
    found = _COVER_KEY.search(remote_url)
    return STATUS_SAME if found and found.group(1) == local_sha256.lower() else STATUS_DIFFERS


def _host(url: str) -> str:
    try:
        host = urlsplit(url).hostname or ""
    except ValueError:
        return ""
    return host.lower().removeprefix("www.")


def _record_urls(resource: Union[Book, GameSystem]) -> list[str]:
    urls = [str(u.get("url", "")) for u in (resource.urls or []) if isinstance(u, dict)]
    if isinstance(resource, Book) and resource.publisher_url:
        urls.append(resource.publisher_url)
    return [u for u in urls if u.startswith(("http://", "https://"))]


def attribution_sources(db: Session, resource: Union[Book, GameSystem], target: str) -> list[dict[str, str]]:
    """The enabled scrapers this record's data may have come from, for crediting it.

    Each carries the record's own link on that scraper's site when it has one, so
    picking the scraper also fills in the page to credit.
    """
    urls = _record_urls(resource)
    out = []
    for manifest in addons.enabled_for_target(db, target):
        home = _host(manifest.homepage or "")
        url = next((u for u in urls if home and (_host(u) == home or _host(u).endswith(f".{home}"))), "")
        out.append({"id": manifest.id, "name": _NAME_SUFFIX.sub("", manifest.name) or manifest.name, "url": url})
    return out
