"""Compendium endpoints: a library system's rules content (issue #835).

Reading a compendium needs only what reading the system needs: a system hidden
from someone answers 404 here too. Changing which packs and sheets a system is
linked to is a GM's or an admin's, like editing the system itself.

The logic lives in ``services.characters.compendium``; these handlers parse the
request and shape the answer.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query, Request
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...models import CharacterSchema, GameSystem
from ...services import access_control
from ...services.characters import catalog_query
from ...services.characters import compendium as svc
from ._schemas import CompendiumLinks


def _summary(db: Session, comp: svc.Compendium, current_user: CurrentUser) -> dict:
    packs = {pack.pack_id: pack for pack in comp.packs}
    sheets = _sheet_rows(db, comp.sheet_ids, current_user.id)
    return {
        "system_id": comp.system.id,
        "packs": [_pack(packs.get(pid), pid) for pid in comp.pack_ids],
        "sheets": [
            _sheet(schema_id, sheets.get(schema_id, []), current_user.id)
            for schema_id in comp.sheet_ids
        ],
        "content_types": svc.content_types(db, comp),
        "can_edit": current_user.role in ("admin", "gm"),
    }


def _pack(pack, pack_id: str) -> dict:
    if pack is None:
        return {"pack_id": pack_id, "name": pack_id, "installed": False}
    return {
        "pack_id": pack.pack_id,
        "name": pack.name or pack.pack_id,
        "schema_id": pack.schema_id,
        "version": pack.version or "",
        "description": pack.description or "",
        "license": pack.license or "",
        "license_url": pack.license_url or "",
        "attribution": pack.attribution or "",
        "source_url": pack.source_url or "",
        "entry_count": pack.entry_count or 0,
        "installed": True,
    }


def _sheet_rows(db: Session, schema_ids: list[str], user_id: str) -> dict[str, list]:
    """schema id -> the caller's own and the server-wide copies of it."""
    if not schema_ids:
        return {}
    rows: dict[str, list] = {}
    for row in (
        db.query(CharacterSchema)
        .filter(CharacterSchema.schema_id.in_(schema_ids))
        .filter((CharacterSchema.user_id == user_id) | CharacterSchema.user_id.is_(None))
        .all()
    ):
        rows.setdefault(row.schema_id, []).append(row)
    return rows


def _sheet(schema_id: str, rows: list, user_id: str) -> dict:
    own = next((row for row in rows if row.user_id == user_id), None)
    server = next((row for row in rows if row.user_id is None), None)
    shown = own or server
    return {
        "schema_id": schema_id,
        "name": shown.name if shown else schema_id,
        "system": (shown.system or "") if shown else "",
        "available": shown is not None,
        "server_wide": server is not None,
    }


def _filters(request: Request) -> dict[str, str]:
    """`filter[field]=value` query parameters, as the sheet browser sends them."""
    return {
        key[7:-1]: value
        for key, value in request.query_params.items()
        if key.startswith("filter[") and key.endswith("]") and value
    }


def get_compendium(
    system_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The system's linked packs and sheets, and the content types they hold."""
    system = svc.readable_system(db, system_id, current_user)
    return _summary(db, svc.load(db, system, current_user.id), current_user)


def update_links(
    system_id: str,
    data: CompendiumLinks,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Set the packs that fill the system's compendium and the sheets it uses."""
    system = svc.readable_system(db, system_id, current_user)
    try:
        svc.set_links(
            db,
            system,
            current_user.id,
            pack_ids=data.pack_ids,
            sheet_ids=data.sheet_ids,
        )
    except svc.CompendiumError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    db.commit()
    return _summary(db, svc.load(db, system, current_user.id), current_user)


def browse_compendium(
    request: Request,
    system_id: str,
    content_type: str,
    search: str = "",
    sort: str = "",
    page: int = 1,
    page_size: int = catalog_query.DEFAULT_PAGE_SIZE,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One content type: search, filter (`filter[field]=value`), sort, paginate."""
    system = svc.readable_system(db, system_id, current_user)
    comp = svc.load(db, system, current_user.id)
    return svc.browse(
        db,
        comp,
        content_type,
        search=search,
        sort=sort,
        filters=_filters(request),
        page=page,
        page_size=page_size,
    )


def get_compendium_entry(
    system_id: str,
    content_type: str,
    entry_id: str,
    origin: Optional[str] = Query(
        None, description="A pack id, or `ruleset:<id>`, when two entries share an id"
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """One entry in full, with the definition it renders by."""
    system = svc.readable_system(db, system_id, current_user)
    entry = svc.find_entry(db, svc.load(db, system, current_user.id), content_type, entry_id, origin)
    if entry is None:
        raise HTTPException(status_code=404, detail="Entry not found")
    return entry


def search_system_compendium(
    system_id: str,
    q: str = Query("", description="Search text"),
    content_type: Optional[str] = None,
    limit: int = svc.MAX_SEARCH_RESULTS,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search every content type in one system's compendium."""
    system = svc.readable_system(db, system_id, current_user)
    comp = svc.load(db, system, current_user.id)
    return {"results": svc.search(db, [comp], q, content_type=content_type, limit=limit)}


def search_compendiums(
    q: str = Query("", description="Search text"),
    system_id: Optional[str] = None,
    limit: int = svc.MAX_SEARCH_RESULTS,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search the compendium of every system the caller can see, for global search.

    Systems with no linked pack are skipped; their compendium could still hold
    ruleset entries, but a global search over every ruleset of every sheet is a
    different feature from searching the shelves people set up.
    """
    if len(q.strip()) < 2:
        return {"results": []}
    linked = svc.systems_with_packs(db)
    if system_id:
        linked = {key: value for key, value in linked.items() if key == system_id}
    if not linked:
        return {"results": []}

    account = access_control.load_user(db, current_user)
    comps = []
    visible = access_control.visible_systems(
        db, db.query(GameSystem).filter(GameSystem.id.in_(list(linked))), account
    )
    for system in visible.order_by(GameSystem.name).all():
        try:
            readable = svc.readable_system(db, system.id, account)
        except HTTPException:
            continue
        comps.append(svc.load(db, readable, current_user.id))
    return {"results": svc.search(db, comps, q, limit=limit)}
