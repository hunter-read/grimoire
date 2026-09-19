"""Content catalog endpoints.

The catalog is **server-wide content described by a per-user schema**: packs are
installed once by an admin, but which content types exist, what shape their
entries have, and how they are sorted and filtered all come from the calling
user's own copy of the sheet. Two people may have different versions of a schema
installed, and each should browse what their copy declares.

Reading the catalog needs only an account. Installing packs is an admin action
and lives with the rest of maintenance; nothing here writes.
"""
import logging
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_admin
from ...config import get_db
from ...models import ContentEntry, ContentPack, HomebrewEntry, User
from ...services.characters import homebrew as hb
from . import _helpers as helpers

logger = logging.getLogger("grimoire.content")


class _CatalogRow:
    """A pack entry or a homebrew entry, seen the same way.

    Homebrew is first-class: it is the same data, so the catalog should not care
    which table a row came from. This wrapper gives both the handful of
    attributes the sort, filter and serialize helpers read, plus the
    `homebrew`/`owner` markers the UI uses to label a row.
    """

    __slots__ = ("id", "entry_id", "source", "name", "data", "content_type",
                 "homebrew", "owner_name", "row_id")

    def __init__(self, *, id, entry_id, source, name, data, content_type,
                 homebrew=False, owner_name="", row_id=None):
        self.id = id
        self.entry_id = entry_id
        self.source = source
        self.name = name
        self.data = data
        self.content_type = content_type
        self.homebrew = homebrew
        self.owner_name = owner_name
        self.row_id = row_id


def _catalog_rows(
    db: Session, user_id: str, schema_id: str, content_type: str, *, include_homebrew: bool
) -> list:
    """Every entry of one type this user can see, pack and homebrew together."""
    rows = [
        _CatalogRow(
            id=row.id,
            entry_id=row.entry_id,
            source=row.source,
            name=row.name,
            data=row.data if isinstance(row.data, dict) else {},
            content_type=row.content_type,
        )
        for row in db.query(ContentEntry)
        .filter_by(schema_id=schema_id, content_type=content_type)
        .all()
    ]
    if not include_homebrew:
        return rows

    homebrew = (
        db.query(HomebrewEntry)
        .filter_by(schema_id=schema_id, content_type=content_type)
        .filter(hb.visible_filter(db, user_id))
        .all()
    )
    names = {}
    if homebrew:
        owner_ids = {entry.owner_id for entry in homebrew}
        names = {
            row[0]: (row[1] or row[2] or "")
            for row in db.query(User.id, User.display_name, User.username)
            .filter(User.id.in_(owner_ids))
            .all()
        }

    rows.extend(
        _CatalogRow(
            id=entry.id,
            entry_id=entry.entry_id,
            source="homebrew",
            name=entry.name,
            data=entry.data if isinstance(entry.data, dict) else {},
            content_type=entry.content_type,
            homebrew=True,
            owner_name=names.get(entry.owner_id, ""),
            row_id=entry.id,
        )
        for entry in homebrew
    )
    return rows


def list_packs(
    schema_id: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every installed content pack, with its licence and credit."""
    query = db.query(ContentPack)
    if schema_id:
        query = query.filter_by(schema_id=schema_id)
    packs = query.order_by(ContentPack.name).all()
    return {
        "packs": [
            {
                "pack_id": pack.pack_id,
                "schema_id": pack.schema_id,
                "name": pack.name,
                "version": pack.version or "",
                "description": pack.description or "",
                "license": pack.license or "",
                "license_url": pack.license_url or "",
                "attribution": pack.attribution or "",
                "source_url": pack.source_url or "",
                "entry_count": pack.entry_count or 0,
            }
            for pack in packs
        ]
    }


def list_content_types(
    schema_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The content types this user's copy of a schema declares."""
    document = helpers.user_schema_document(db, current_user.id, schema_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Schema not found")

    content_types = document.get("content_types") or {}

    # One grouped count rather than a query per declared type.
    counts: dict[str, int] = {}
    for (name,) in db.query(ContentEntry.content_type).filter_by(schema_id=schema_id).all():
        counts[name] = counts.get(name, 0) + 1

    return {
        "content_types": [
            {
                "name": name,
                "label": definition.get("label", name),
                "label_plural": definition.get("label_plural", ""),
                "icon": definition.get("icon", ""),
                "identity_field": definition.get("identity_field", "name"),
                "sort_default": definition.get("sort_default", []),
                "search_fields": definition.get("search_fields", []),
                "filter_fields": definition.get("filter_fields", []),
                "compact_display": definition.get("compact_display", ""),
                "fields": definition.get("fields", {}),
                "entry_count": counts.get(name, 0),
            }
            for name, definition in sorted(content_types.items())
        ]
    }


def browse_content(
    request: Request,
    schema_id: str,
    content_type: str,
    search: str = "",
    sort: str = "",
    page: int = 1,
    page_size: int = helpers.DEFAULT_PAGE_SIZE,
    include_homebrew: bool = True,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Browse one content type: search, filter, sort, paginate.

    Filters arrive as `filter[field]=value` query parameters, which is why this
    handler takes the raw request — FastAPI cannot express that bracketed shape
    as a typed parameter.
    """
    document = helpers.user_schema_document(db, current_user.id, schema_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Schema not found")

    content_types = document.get("content_types") or {}
    definition = content_types.get(content_type)
    if definition is None:
        raise HTTPException(
            status_code=404, detail=f"This schema declares no content type {content_type!r}"
        )

    entries = _catalog_rows(
        db, current_user.id, schema_id, content_type, include_homebrew=include_homebrew
    )

    # Facets describe the whole catalog, not the current page, so they are built
    # before filtering — otherwise choosing one value would empty every other
    # facet and leave no way back.
    facets = helpers.build_facets(entries, definition.get("filter_fields", []))

    filters = {
        key[7:-1]: value
        for key, value in request.query_params.items()
        if key.startswith("filter[") and key.endswith("]") and value
    }
    if filters:
        entries = [
            entry
            for entry in entries
            if helpers.matches_filters(entry.data or {}, filters)
        ]

    if search.strip():
        ranked = helpers.search_entry_ids(db, schema_id, content_type, search)
        order = {row_id: index for index, row_id in enumerate(ranked)}
        # The FTS index covers pack content; homebrew is matched here on the
        # same terms rather than being indexed, because it changes on every
        # edit and the per-user set is small.
        definition_fields = definition.get("search_fields") or []
        matched = [
            entry
            for entry in entries
            if entry.id in order
            or (entry.homebrew and helpers.matches_text(entry, search, definition_fields))
        ]
        matched.sort(key=lambda entry: order.get(entry.id, len(order)))
        entries = matched
    else:
        sort_fields = (
            [field.strip() for field in sort.split(",") if field.strip()]
            if sort
            else definition.get("sort_default", [])
        )
        entries = helpers.sort_entries(entries, sort_fields)

    total = len(entries)
    size = max(1, min(page_size, helpers.MAX_PAGE_SIZE))
    current = max(1, page)
    window = entries[(current - 1) * size : current * size]

    return {
        "entries": [helpers.serialize_entry(entry, definition) for entry in window],
        "total": total,
        "page": current,
        "page_size": size,
        "filters_available": facets,
    }


def get_entry(
    schema_id: str,
    content_type: str,
    entry_id: str,
    source: Optional[str] = None,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One catalog entry in full."""
    document = helpers.user_schema_document(db, current_user.id, schema_id)
    if document is None:
        raise HTTPException(status_code=404, detail="Schema not found")

    query = db.query(ContentEntry).filter_by(
        schema_id=schema_id, content_type=content_type, entry_id=entry_id
    )
    if source:
        query = query.filter_by(source=source)
    entry = query.first()
    if not entry:
        raise HTTPException(status_code=404, detail="Entry not found")

    definition = (document.get("content_types") or {}).get(content_type) or {}
    return helpers.serialize_entry(entry, definition)


def resolve_entries(
    schema_id: str,
    ids: str = Query("", description="Comma-separated entry ids"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Resolve many references at once, for rendering a sheet.

    A sheet with twenty referenced spells must not make twenty requests. Ids
    that no installed pack provides come back marked `missing` rather than being
    omitted, so the sheet can say "this entry is not installed" instead of
    silently dropping something the player chose.
    """
    wanted = [item.strip() for item in ids.split(",") if item.strip()]
    if not wanted:
        return {"entries": {}}

    ids = wanted[: helpers.MAX_PAGE_SIZE]
    rows = (
        db.query(ContentEntry)
        .filter(ContentEntry.schema_id == schema_id)
        .filter(ContentEntry.entry_id.in_(ids))
        .all()
    )
    found = {
        row.entry_id: {
            "entry_id": row.entry_id,
            "source": row.source,
            "name": row.name,
            "content_type": row.content_type,
            "data": row.data if isinstance(row.data, dict) else {},
            "missing": False,
        }
        for row in rows
    }

    # Homebrew resolves too, or a sheet built on someone's own spell would show
    # it as missing. Visible homebrew only, enforced by the shared filter.
    for row in (
        db.query(HomebrewEntry)
        .filter(HomebrewEntry.schema_id == schema_id)
        .filter(HomebrewEntry.entry_id.in_(ids))
        .filter(hb.visible_filter(db, current_user.id))
        .all()
    ):
        found.setdefault(
            row.entry_id,
            {
                "entry_id": row.entry_id,
                "source": "homebrew",
                "name": row.name,
                "content_type": row.content_type,
                "data": row.data if isinstance(row.data, dict) else {},
                "missing": False,
            },
        )
    for entry_id in wanted:
        found.setdefault(
            entry_id,
            {
                "entry_id": entry_id,
                "source": None,
                "name": entry_id,
                "content_type": "",
                "data": {},
                "missing": True,
            },
        )
    return {"entries": found}


def reload_packs(
    current_user: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Re-read every content pack from disk.

    Packs load at startup and on rescan, but an admin who has just dropped a
    directory in should not have to restart to see it. The directory is the
    source of truth, so this is a re-read rather than a merge: a pack whose
    files changed is replaced, and one whose directory is gone loses its rows.
    """
    from ...services.characters import packs as pack_service

    try:
        loaded = pack_service.sync_packs(db)
    except Exception as exc:  # a bad pack must not 500 the admin page
        logger.exception("Content pack reload failed")
        raise HTTPException(status_code=500, detail=str(exc)) from exc

    return {
        "packs": [
            {
                "pack_id": pack.pack_id,
                "schema_id": pack.schema_id,
                "name": pack.name,
                "version": pack.version or "",
                "description": pack.description or "",
                "license": pack.license or "",
                "license_url": pack.license_url or "",
                "attribution": pack.attribution or "",
                "source_url": pack.source_url or "",
                "entry_count": pack.entry_count or 0,
            }
            for pack in loaded
        ]
    }
