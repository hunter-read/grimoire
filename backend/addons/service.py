"""Search and fetch against an installed add-on.

The one place the two backends (declarative YAML source vs. Python script) are
resolved, so callers ask for "search this add-on" without caring which it is.
"""
import logging
from typing import Any, Optional
from urllib.parse import quote

from sqlalchemy.orm import Session

from . import fetch, interpreter, scripts
from .manifest import AddonManifest
from .registry import AddonError, get_runnable

logger = logging.getLogger("grimoire.addons")

# Marker a source URL uses to say "this endpoint is a search, substitute the
# user's query here" rather than "this is a whole catalogue to download once".
_QUERY_TOKEN = "{query}"


def is_query_source(manifest: AddonManifest) -> bool:
    """Whether the source URL is a per-query search endpoint."""
    return manifest.source is not None and _QUERY_TOKEN in manifest.source.url


def _source_url(manifest: AddonManifest, query: str) -> str:
    """The URL to fetch for ``query``.

    Catalogue sources ignore the query entirely (one file serves every lookup);
    search sources interpolate it, URL-encoded.
    """
    assert manifest.source is not None  # guarded by callers
    url = manifest.source.url
    if _QUERY_TOKEN in url:
        return url.replace(_QUERY_TOKEN, quote(query.strip(), safe=""))
    return url


def _document(manifest: AddonManifest, query: str = "", force: bool = False) -> Any:
    if manifest.source is None:
        raise AddonError(f"add-on '{manifest.id}' has no source to fetch")
    return fetch.fetch_document(
        _source_url(manifest, query),
        user_agent=manifest.source.user_agent,
        cache_ttl=manifest.source.cache_ttl,
        force=force,
    )


def search(db: Session, addon_id: str, query: str) -> list[dict]:
    """Ranked candidates for ``query`` from one add-on."""
    manifest = get_runnable(db, addon_id)
    if not query.strip():
        return []
    if manifest.requires_script:
        return scripts.search(query, manifest)
    return interpreter.search(query, _document(manifest, query), manifest)


def fetch_fields(
    db: Session, addon_id: str, identity: str, query: str = ""
) -> dict[str, Any]:
    """Mapped Grimoire fields for one candidate.

    Returns ``{"fields": {...}, "url": str, "attribution": str}``.

    ``query`` is only needed for search-backed sources, where the record lives
    in a per-query response rather than a catalogue the whole of which is
    cached; the client passes back the query its candidate came from.
    """
    manifest = get_runnable(db, addon_id)

    if manifest.requires_script:
        fields, url = scripts.fetch(identity, manifest)
        # A script is third-party code, so its output is filtered to the same
        # per-target allowlist the declarative path is constrained to by schema.
        fields = _allowed_only(fields, manifest)
    elif manifest.detail is not None:
        # Search returned a summary; the full fields live behind a per-item
        # endpoint. Mapping runs against that response.
        record = _detail_record(manifest, identity)
        fields = interpreter.map_record(record, manifest, identity)
        url = interpreter.record_url(record, identity, manifest)
    else:
        record_or_none = _find(manifest, identity, query)
        if record_or_none is None:
            raise AddonError("that result is no longer available from the source")
        fields = interpreter.map_record(record_or_none, manifest, identity)
        url = interpreter.record_url(record_or_none, identity, manifest)

    return {"fields": fields, "url": url, "attribution": manifest.attribution}


def resolve_identity(db: Session, addon_id: str, text: str) -> str:
    """Turn a pasted source URL or bare id into an identity for this add-on.

    Raises ``AddonError`` with a user-facing message when the add-on does not
    support pasting, or the text is not recognisable — the alternative is
    firing off a request that is certain to fail.
    """
    manifest = get_runnable(db, addon_id)
    if manifest.search is None or not manifest.search.identity_pattern:
        raise AddonError("this source does not support pasting a link or ID")

    identity = interpreter.resolve_identity(text, manifest)
    if not identity:
        raise AddonError("that does not look like a link or ID for this source")
    return identity


def _detail_record(manifest: AddonManifest, identity: str) -> dict:
    """Fetch and unwrap the chosen record's detail response."""
    assert manifest.detail is not None and manifest.source is not None
    url = manifest.detail.url.replace("{identity}", quote(str(identity), safe=""))
    try:
        document = fetch.fetch_document(
            url,
            user_agent=manifest.source.user_agent,
            cache_ttl=manifest.source.cache_ttl,
        )
    except fetch.AddonFetchError as exc:
        # A hand-entered identity that does not exist upstream is a user error,
        # not a broken source, so it reads as "no such item" rather than a 502.
        if "HTTP 404" in str(exc) or "HTTP 400" in str(exc):
            raise AddonError(
                "the source has no item with that ID - check the link and try again"
            ) from exc
        raise
    node = document
    if manifest.detail.root not in ("", "$"):
        for part in manifest.detail.root.split("."):
            node = node.get(part) if isinstance(node, dict) else None
            if node is None:
                break
    # Some APIs return the single item wrapped in a list.
    if isinstance(node, list):
        node = node[0] if node else None
    if not isinstance(node, dict):
        raise AddonError("that result is no longer available from the source")
    return node


def _find(manifest: AddonManifest, identity: str, query: str) -> Optional[dict]:
    """Locate a previously-returned candidate in the source."""
    document = _document(manifest, query)
    record = interpreter.find_record(identity, document, manifest)
    if record is not None:
        return record
    # The cached response may predate the candidate list; one forced re-fetch
    # distinguishes a stale cache from a genuinely gone record.
    document = _document(manifest, query, force=True)
    return interpreter.find_record(identity, document, manifest)


def _allowed_only(fields: dict, manifest: AddonManifest) -> dict:
    """Drop anything a script returned that its target cannot accept."""
    allowed = set(manifest.mappable_fields)
    return {k: v for k, v in fields.items() if k in allowed}
