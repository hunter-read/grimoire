"""Shared helpers for add-on metadata lookup endpoints (issue #203).

Systems and books expose the same three-step flow — list sources, search, fetch
a diff — against different targets. The error translation and diff assembly are
identical, so they live here rather than being duplicated per router.
"""
from typing import Any, Optional, Union

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import addons
from ..models import Book, GameSystem
from ..services import tag_service


class MetadataSource(BaseModel):
    """One installed add-on able to supply metadata, from `list_sources`."""

    id: str
    name: str
    # Optional manifest fields — an add-on need not declare any of them.
    description: Optional[str] = None
    homepage: Optional[str] = None
    attribution: Optional[str] = None
    supports_paste: bool


class MetadataSourcesResponse(BaseModel):
    sources: list[MetadataSource]


class MetadataCandidate(BaseModel):
    """One ranked search candidate (same shape from script and declarative paths)."""

    identity: str
    label: str
    score: float
    url: str


class MetadataSearchResponse(BaseModel):
    # The query actually used — the caller's, or the resource name it fell back to.
    query: str
    results: list[MetadataCandidate]


class MetadataDiffField(BaseModel):
    """One field compared against the resource, from `addons.build_diff`."""

    field: str
    # The resource's existing value; explicitly None when it has none. Typed
    # loosely because a field may be a string, int, list, or list of link dicts.
    current: Optional[Any] = None
    incoming: Any
    status: str


class MetadataFetchResponse(BaseModel):
    source_id: str
    identity: str
    url: str
    attribution: str
    fields: list[MetadataDiffField]


def list_sources(db: Session, target: str) -> dict:
    """Add-ons currently able to supply metadata for ``target``."""
    return {
        "sources": [
            {
                "id": manifest.id,
                "name": manifest.name,
                "description": manifest.description,
                "homepage": manifest.homepage,
                "attribution": manifest.attribution,
                # Drives the "paste a link or ID" input: only offered when the
                # definition knows how to extract an identity from a URL.
                "supports_paste": bool(
                    manifest.search is not None and manifest.search.identity_pattern
                ),
            }
            for manifest in addons.enabled_for_target(db, target)
        ]
    }


def _translate(exc: Exception) -> HTTPException:
    """Map an add-on failure onto a status code and a user-safe message.

    Source-side problems are 502 (the add-on is fine, the source is not);
    configuration problems — a disabled add-on, an unknown result — are 400.
    """
    if isinstance(exc, addons.AddonFetchError):
        return HTTPException(502, f"Could not reach the source: {exc}")
    if isinstance(exc, addons.AddonScriptError):
        return HTTPException(502, f"The add-on script failed: {exc}")
    if isinstance(exc, addons.AddonDataError):
        return HTTPException(502, f"The source returned unexpected data: {exc}")
    return HTTPException(400, str(exc))


def search(db: Session, source_id: str, query: str, fallback: str) -> dict:
    """Ranked candidates for ``query``, defaulting to ``fallback``."""
    effective = query.strip() or fallback
    try:
        results = addons.search(db, source_id, effective)
    except (
        addons.AddonFetchError,
        addons.AddonScriptError,
        addons.AddonDataError,
        addons.AddonError,
    ) as exc:
        raise _translate(exc) from exc
    return {"query": effective, "results": results}


def fetch(
    db: Session,
    resource: Union[GameSystem, Book],
    resource_type: str,
    source_id: str,
    identity: str,
    query: str = "",
    paste: str = "",
) -> dict:
    """Fetch one candidate's fields and diff them against ``resource``.

    ``identity`` normally comes from a previous search. ``paste`` is the
    alternative entry point: a source URL or bare ID the user supplied
    directly, which is resolved to an identity first — so someone who already
    knows exactly which item they want can skip searching entirely.

    Writes nothing — the caller's client applies its selection through the
    resource's own PATCH endpoint.
    """
    try:
        if paste.strip():
            identity = addons.resolve_identity(db, source_id, paste)
        if not identity:
            raise addons.AddonError("no result was chosen")
        result = addons.fetch_fields(db, source_id, identity, query=query)
    except (
        addons.AddonFetchError,
        addons.AddonScriptError,
        addons.AddonDataError,
        addons.AddonError,
    ) as exc:
        raise _translate(exc) from exc

    current_tags = tag_service.display_tags_for_resource(db, resource_type, resource.id)
    fields: list[dict[str, Any]] = addons.build_diff(
        resource, result["fields"], current_tags=current_tags
    )

    return {
        "source_id": source_id,
        "identity": identity,
        "url": result["url"],
        "attribution": result["attribution"],
        "fields": fields,
    }
