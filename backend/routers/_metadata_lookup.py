"""Shared helpers for metadata lookup endpoints (issue #203).

Systems and books expose the same three-step flow — list sources, search, fetch
a diff — against different targets. The error translation and diff assembly are
identical, so they live here rather than being duplicated per router.

Sources are the installed community add-ons plus GrimoireCodexDB, which is built
in (issue #35) under the reserved id ``codex.SOURCE_ID`` and listed first while
it is enabled.
"""
from typing import Any, Optional, Union

from fastapi import HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from .. import addons, codex
from ..codex import lookup as codex_lookup
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
    """Sources currently able to supply metadata for ``target``: GrimoireCodexDB, then add-ons."""
    settings = codex.load(db)
    builtin = [codex_lookup.source(settings)] if settings.enabled else []
    return {
        "sources": builtin + [
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


def _codex_error(exc: Exception) -> HTTPException:
    """GrimoireCodexDB unreachable or failing is a 502; turned off or bad input is a 400."""
    if isinstance(exc, codex.CodexError):
        return codex.http_error(exc)
    return HTTPException(400, str(exc))


def search(
    db: Session,
    source_id: str,
    query: str,
    fallback: str,
    target: str = "book",
    resource: Optional[Union[GameSystem, Book]] = None,
) -> dict:
    """Ranked candidates for ``query``, defaulting to ``fallback``.

    ``target`` and ``resource`` are only used by GrimoireCodexDB, which matches a book on
    everything known about it rather than on the query text alone.
    """
    effective = query.strip() or fallback
    if source_id == codex.SOURCE_ID:
        try:
            results = codex_lookup.search(db, codex.load(db), target, query, resource)
        except codex.CodexError as exc:
            raise _codex_error(exc) from exc
        return {"query": effective, "results": results}
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
    if source_id == codex.SOURCE_ID:
        target = "book" if resource_type == "book" else "game-system"
        try:
            if paste.strip():
                identity = codex_lookup.resolve_paste(target, paste)
            if not identity:
                raise ValueError("no result was chosen")
            result = codex_lookup.fetch(codex.load(db), target, identity)
        except (codex.CodexError, ValueError) as exc:
            raise _codex_error(exc) from exc
        identity = result["identity"]
    else:
        result = _fetch_addon(db, source_id, identity, query, paste)
        identity = result.pop("identity")

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


def _fetch_addon(db: Session, source_id: str, identity: str, query: str, paste: str) -> dict:
    """An add-on's fields for one candidate, with the identity it resolved to."""
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
    return {**result, "identity": identity}
