"""Army builder endpoint handlers."""
import os
from typing import Literal, Optional

from fastapi import Depends, File, Form, HTTPException, Query, Response, UploadFile
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user, require_gm_or_admin
from ...config import get_db
from ...http_headers import content_disposition
from ...models import Army
from ...models.armies import SOURCE_BATTLESCRIBE, SOURCE_MANUAL
from ...services import factions as faction_service
from ...services.armies import battlescribe, export, links, manual, matching, storage
from ._helpers import check_system_and_faction, detail, get_army, recount, summary
from ._schemas import ArmyCreate, ArmyUpdate, ManualUnitIn, PublicationLinkIn, UnitProgress

#: The largest roster upload accepted, as sent (zipped or not).
MAX_UPLOAD_BYTES = battlescribe.MAX_ROSTER_BYTES


def _manual_list(units: list[ManualUnitIn], cost_name: str = "pts") -> dict:
    try:
        return manual.build_manual([u.model_dump() for u in units], cost_name)
    except manual.ManualListError as exc:
        raise HTTPException(400, str(exc)) from exc


def list_armies(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The caller's own armies, most recently changed first."""
    rows = (
        db.query(Army)
        .filter(Army.user_id == current_user.id)
        .order_by(Army.updated_at.desc(), Army.id)
        .all()
    )
    return [summary(db, a, current_user) for a in rows]


def create_army(
    data: ArmyCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Build an army by hand."""
    system_id, faction_id = check_system_and_faction(
        db, current_user, data.game_system_id, data.faction_id
    )
    army = Army(
        user_id=current_user.id,
        name=data.name.strip(),
        game_system_id=system_id,
        faction_id=faction_id,
        points_limit=data.points_limit,
        cost_name="pts",
        source=SOURCE_MANUAL,
        data=_manual_list(data.units),
        progress={},
        notes=data.notes,
    )
    recount(army)
    db.add(army)
    db.commit()
    return detail(db, army, current_user)


async def import_army(
    file: UploadFile = File(..., description="A BattleScribe or New Recruit roster, .ros or .rosz"),
    name: Optional[str] = Form(None, description="Name for the army; the roster's own otherwise."),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Import a roster. Its system and faction are matched to the library when they can be."""
    raw = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(raw) > MAX_UPLOAD_BYTES:
        raise HTTPException(413, "That roster is too large")
    try:
        document = battlescribe.parse_roster(battlescribe.roster_xml(raw))
    except battlescribe.RosterError as exc:
        raise HTTPException(400, str(exc)) from exc

    cost_name = battlescribe.main_cost_name(document)
    system = matching.match_system(db, current_user, document.get("game_system_name", ""))
    catalogue = next((f.get("catalogue") for f in document.get("forces") or []), "") or ""
    faction = matching.match_faction(db, current_user, system.id if system else None, catalogue)
    filename = os.path.basename(file.filename or "roster.rosz")
    title = (name or "").strip() or document.get("name") or os.path.splitext(filename)[0]
    army = Army(
        user_id=current_user.id,
        name=(title or "Army").strip()[:255],
        game_system_id=system.id if system else None,
        faction_id=faction.id if faction else None,
        system_name=(document.get("game_system_name") or "")[:255],
        points_limit=battlescribe.roster_limit(document, cost_name),
        cost_name=cost_name[:40],
        source=SOURCE_BATTLESCRIBE,
        source_filename=filename[:255],
        data=document,
        progress={},
    )
    recount(army)
    db.add(army)
    db.flush()
    storage.save(army.id, raw, ".rosz" if raw[:2] == b"PK" else ".ros")
    try:
        db.commit()
    except Exception:
        storage.delete(army.id)
        raise
    return detail(db, army, current_user)


def get_army_detail(
    army_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """An army: its list, progress, and the library books its rules cite."""
    return detail(db, get_army(db, army_id, current_user), current_user)


def update_army(
    army_id: str,
    data: ArmyUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename, re-match, set the limit and notes, or replace a hand-built list."""
    army = get_army(db, army_id, current_user, edit=True)
    fields = data.model_fields_set
    system_id = data.game_system_id if "game_system_id" in fields else army.game_system_id
    faction_id = data.faction_id if "faction_id" in fields else army.faction_id
    if "game_system_id" in fields and "faction_id" not in fields and system_id != army.game_system_id:
        # A faction belongs to one system; moving systems leaves it behind.
        faction_id = None
    army.game_system_id, army.faction_id = check_system_and_faction(
        db, current_user, system_id, faction_id
    )
    if data.name:
        army.name = data.name.strip() or army.name
    if "points_limit" in fields:
        army.points_limit = data.points_limit
    if "notes" in fields:
        army.notes = data.notes or ""
    if data.units is not None:
        if army.source != SOURCE_MANUAL:
            raise HTTPException(
                400, "An imported army's list comes from its roster; import it again"
            )
        army.data = _manual_list(data.units, army.cost_name or "pts")
        recount(army)
    db.commit()
    return detail(db, army, current_user)


def update_unit_progress(
    army_id: str,
    unit_id: str,
    data: UnitProgress,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Set a unit's experience, honours and notes."""
    army = get_army(db, army_id, current_user, edit=True)
    progress = dict(army.progress or {})
    honours = [h.strip()[:200] for h in data.honours if h and h.strip()]
    progress[unit_id[:64]] = {
        "experience": data.experience,
        "honours": honours,
        "notes": data.notes,
    }
    army.progress = progress
    db.commit()
    return progress[unit_id[:64]]


def delete_army(
    army_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete an army and its roster file."""
    army = get_army(db, army_id, current_user, edit=True)
    db.delete(army)
    db.commit()
    storage.delete(army_id)
    return Response(status_code=204)


def export_army(
    army_id: str,
    format: Literal["roster", "text"] = Query(
        "text", description="`text` (a readable list) or `roster` (the imported file, unchanged)"
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The army as its original roster file, or as a plain-text list."""
    army = get_army(db, army_id, current_user)
    if format == "roster":
        stored = storage.load(army.id)
        if stored is None:
            raise HTTPException(404, "This army was not imported from a roster")
        raw, ext = stored
        base = os.path.splitext(army.source_filename or army.name)[0] or "army"
        return Response(
            content=raw,
            media_type="application/octet-stream",
            headers={"Content-Disposition": content_disposition(f"{base}{ext}")},
        )
    text = export.army_text(
        army.name,
        army.data or {},
        army.points or 0,
        army.points_limit,
        army.cost_name or "pts",
        army.system_name or "",
    )
    return Response(
        content=text,
        media_type="text/plain; charset=utf-8",
        headers={"Content-Disposition": content_disposition(f"{army.name}.txt")},
    )


def army_publications(
    army_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Each publication the army cites, its link if any, and books it might be."""
    army = get_army(db, army_id, current_user)
    cited = links.publications_in(army.data or {})
    resolved = links.resolve(db, current_user, army.system_name or "", cited)
    return [
        {
            "publication": pub,
            "link": resolved.get(pub),
            "suggestions": links.suggest(db, current_user, army.game_system_id, pub),
        }
        for pub in cited
    ]


def search_link_books(
    q: str = Query(..., min_length=2, max_length=200, description="Part of a book title"),
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Wargame books whose titles contain ``q``, to link a publication to."""
    return links.search_books(db, current_user, q)


def set_publication_link(
    data: PublicationLinkIn,
    current_user: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Link a publication to a library book, for every army that cites it."""
    if links.readable_book(db, current_user, data.book_id) is None:
        raise HTTPException(404, "Book not found")
    publication = data.publication.strip()
    if not publication:
        raise HTTPException(400, "Name the publication to link")
    links.set_link(db, current_user, data.system_name, publication, data.book_id, data.page_offset)
    db.commit()
    return links.resolve(db, current_user, data.system_name, [publication])[publication]


def delete_publication_link(
    publication: str = Query(..., min_length=1, max_length=255),
    system_name: str = Query("", max_length=255),
    _: CurrentUser = Depends(require_gm_or_admin),
    db: Session = Depends(get_db),
):
    """Remove a publication's link; the armies citing it go back to plain text."""
    links.remove_link(db, system_name, publication.strip())
    db.commit()
    return Response(status_code=204)


def list_games(
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The wargames the caller may set an army to.

    The army form's list for anyone, and the only one a league's guest gets:
    their leagues' games and those games' editions.
    """
    return [
        {"id": s.id, "name": s.name, "parent_id": s.parent_id}
        for s in matching.choosable_systems(db, current_user)
    ]


def list_game_factions(
    system_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """A game's factions, for the army form. 404 for a game the caller may not choose."""
    if matching.wargame_system(db, current_user, system_id) is None:
        raise HTTPException(404, "Game not found")
    return {
        "factions": [
            {key: f[key] for key in ("id", "name", "parent_id", "depth")}
            for f in faction_service.system_factions(db, system_id, current_user)
        ]
    }
