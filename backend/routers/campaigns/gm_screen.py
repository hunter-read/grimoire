"""The GM screen: a campaign's board of tools, for its GM alone (issue #764).

A board is a set of panels on a twelve-column snap grid - pinned notes, the
party overview, counters, countdowns, token pools, a scratch note, an
initiative tracker. Every route here is the campaign owner's: players see
nothing of it, so a hidden countdown stays hidden.

Each panel is written on its own (``PATCH .../panels/{panel_id}``), so ticking a
countdown on a tablet does not undo a panel moved on the laptop. A drag that
pushes other panels aside sends every moved cell together (``PUT .../layout``).

Boards travel as one small JSON document - copied from another campaign the GM
runs, exported, or downloaded from the community catalogue of presets - and are
read by ``services/gm_screen/boards.py``, which knows only the built-in panel
kinds.
"""
from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Campaign, GmScreenPanel, WikiPage
from ...services.gm_screen import boards, panels as p, presets
from ...services.gm_screen.party import party_overview
from ._gm_screen_schemas import (
    GmApplyPresetRequest,
    GmCopyRequest,
    GmImportRequest,
    GmLayoutUpdate,
    GmPanelCreate,
    GmPanelUpdate,
    GmResetRequest,
)
from ._helpers import assert_can_manage, get_campaign_or_404

_GM_ONLY = "Only the campaign's GM can use its GM screen"


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #


def _gm_campaign(db: Session, campaign_id: str, user: CurrentUser, *, write: bool = False) -> Campaign:
    """The campaign, if ``user`` runs it. Writes also need it unlocked."""
    c = get_campaign_or_404(db, campaign_id)
    if write:
        try:
            assert_can_manage(c, user, db)
        except HTTPException as exc:
            if exc.status_code == 403 and c.owner_id != user.id:
                raise HTTPException(403, _GM_ONLY) from exc
            raise
    elif c.owner_id != user.id:
        raise HTTPException(403, _GM_ONLY)
    return c


def _rows(db: Session, campaign_id: str) -> list[GmScreenPanel]:
    return (
        db.query(GmScreenPanel)
        .filter_by(campaign_id=campaign_id)
        .order_by(GmScreenPanel.y, GmScreenPanel.x, GmScreenPanel.created_at)
        .all()
    )


def _serialize(row: GmScreenPanel) -> dict:
    return {
        "id": row.id,
        "kind": row.kind,
        "title": row.title or "",
        "x": row.x,
        "y": row.y,
        "w": row.w,
        "h": row.h,
        "config": row.config if isinstance(row.config, dict) else {},
        "state": row.state if isinstance(row.state, dict) else {},
        "updated_at": row.updated_at.isoformat() if row.updated_at else None,
    }


def _board(db: Session, campaign_id: str) -> dict:
    return {"panels": [_serialize(row) for row in _rows(db, campaign_id)]}


def _panel_or_404(db: Session, campaign_id: str, panel_id: str) -> GmScreenPanel:
    row = db.query(GmScreenPanel).filter_by(campaign_id=campaign_id, id=panel_id).first()
    if row is None or row.kind not in p.KINDS:
        raise HTTPException(404, "Panel not found")
    return row


def _cell(row: GmScreenPanel) -> dict:
    return {"x": row.x, "y": row.y, "w": row.w, "h": row.h}


def _move(row: GmScreenPanel, x: object, y: object, w: object, h: object) -> None:
    cell = p.clean_geometry(x, y, w, h, row.kind)
    row.x, row.y, row.w, row.h = cell["x"], cell["y"], cell["w"], cell["h"]


def _pin_note(db: Session, campaign_id: str, config: dict) -> dict:
    """A note panel's page, checked to be one of this campaign's.

    Pinned by id, with the slug kept beside it so the panel can find the page
    again in a campaign it is copied to. A page from elsewhere is refused
    rather than stored; a slug with no page here simply pins nothing yet.
    """
    page_id = config.get("page_id")
    if page_id:
        page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
        if page is None:
            raise HTTPException(404, "That note is not in this campaign")
        return {"page_id": page.id, "page_slug": page.slug}
    slug = config.get("page_slug")
    if slug:
        page = db.query(WikiPage).filter_by(slug=slug, campaign_id=campaign_id).first()
        if page is not None:
            return {"page_id": page.id, "page_slug": page.slug}
    return {"page_id": None, "page_slug": slug or ""}


def _add_board(db: Session, campaign_id: str, board: list[dict], replace: bool) -> None:
    """Put a parsed board on the campaign: in place of its own, or below it."""
    existing = _rows(db, campaign_id)
    if replace:
        for row in existing:
            db.delete(row)
        existing = []
    if len(existing) + len(board) > p.MAX_PANELS:
        raise HTTPException(400, f"A GM screen holds at most {p.MAX_PANELS} panels")
    offset = max((row.y + row.h for row in existing), default=0)
    for panel in board:
        config = panel["config"]
        if panel["kind"] == "note":
            config = _pin_note(db, campaign_id, config)
        db.add(
            GmScreenPanel(
                campaign_id=campaign_id,
                kind=panel["kind"],
                title=panel["title"],
                x=panel["x"],
                y=min(panel["y"] + offset, p.MAX_ROWS),
                w=panel["w"],
                h=panel["h"],
                config=config,
                state=panel["state"],
            )
        )
    db.commit()


# --------------------------------------------------------------------------- #
# The board and its panels
# --------------------------------------------------------------------------- #


def get_gm_screen(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Every panel on the campaign's GM screen, top to bottom."""
    _gm_campaign(db, campaign_id, current_user)
    return _board(db, campaign_id)


def create_gm_panel(
    campaign_id: str,
    data: GmPanelCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Add a panel. Without a position it takes the first gap it fits."""
    _gm_campaign(db, campaign_id, current_user, write=True)
    existing = _rows(db, campaign_id)
    if len(existing) >= p.MAX_PANELS:
        raise HTTPException(400, f"A GM screen holds at most {p.MAX_PANELS} panels")
    try:
        config = p.clean_config(data.kind, data.config)
    except p.PanelError as exc:
        raise HTTPException(400, str(exc)) from exc
    if data.kind == "note":
        config = _pin_note(db, campaign_id, config)
    cell = p.clean_geometry(data.x, data.y, data.w, data.h, data.kind)
    if data.x is None or data.y is None:
        cell = p.place([_cell(row) for row in existing], cell["w"], cell["h"])
    row = GmScreenPanel(
        campaign_id=campaign_id,
        kind=data.kind,
        title=p.clean_title(data.title),
        config=config,
        state=p.clean_state(data.kind, data.state, config),
        **cell,
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def update_gm_panel(
    campaign_id: str,
    panel_id: str,
    data: GmPanelUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change a panel's title, cell, setup or contents - only what is given.

    A new config re-cleans the state against it, so lowering a counter's top
    brings its value down with it.
    """
    _gm_campaign(db, campaign_id, current_user, write=True)
    row = _panel_or_404(db, campaign_id, panel_id)
    if data.title is not None:
        row.title = p.clean_title(data.title)
    if any(value is not None for value in (data.x, data.y, data.w, data.h)):
        _move(
            row,
            row.x if data.x is None else data.x,
            row.y if data.y is None else data.y,
            row.w if data.w is None else data.w,
            row.h if data.h is None else data.h,
        )
    config = row.config if isinstance(row.config, dict) else {}
    if data.config is not None:
        config = p.clean_config(row.kind, data.config)
        if row.kind == "note":
            config = _pin_note(db, campaign_id, config)
        row.config = config
    if data.state is not None or data.config is not None:
        source = data.state if data.state is not None else row.state
        # Reassigned rather than mutated: SQLAlchemy does not see in-place
        # edits to a JSON column.
        row.state = p.clean_state(row.kind, source, config)
    db.commit()
    db.refresh(row)
    return _serialize(row)


def delete_gm_panel(
    campaign_id: str,
    panel_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Take a panel off the board."""
    _gm_campaign(db, campaign_id, current_user, write=True)
    db.delete(_panel_or_404(db, campaign_id, panel_id))
    db.commit()
    return _board(db, campaign_id)


def update_gm_layout(
    campaign_id: str,
    data: GmLayoutUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Move and resize several panels at once - one drag can push its neighbours.

    A cell naming a panel that is not on this board is ignored: it was
    removed on another device a moment ago, which is no reason to fail the
    rest of the move.
    """
    _gm_campaign(db, campaign_id, current_user, write=True)
    rows = {row.id: row for row in _rows(db, campaign_id)}
    for cell in data.panels:
        row = rows.get(cell.id)
        if row is None:
            continue
        _move(row, cell.x, cell.y, cell.w, cell.h)
    db.commit()
    return _board(db, campaign_id)


def reset_gm_screen(
    campaign_id: str,
    data: GmResetRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """End a scene or a session, or take a rest: clear what is marked to clear.

    Ending a session clears what clears with a scene too.
    """
    _gm_campaign(db, campaign_id, current_user, write=True)
    for row in _rows(db, campaign_id):
        config = row.config if isinstance(row.config, dict) else {}
        state = row.state if isinstance(row.state, dict) else {}
        cleared = p.reset_state(row.kind, config, state, data.scope)
        if cleared is not None:
            row.state = p.clean_state(row.kind, cleared, config)
    db.commit()
    return _board(db, campaign_id)


# --------------------------------------------------------------------------- #
# Whole boards: copy, export, import, presets
# --------------------------------------------------------------------------- #


def _export(db: Session, c: Campaign) -> dict:
    return boards.export_board(c.name, [_serialize(row) for row in _rows(db, c.id)])


def list_gm_screen_sources(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The other campaigns this GM runs that have a board to copy."""
    _gm_campaign(db, campaign_id, current_user)
    counts: dict[str, int] = {}
    for (source_id,) in (
        db.query(GmScreenPanel.campaign_id)
        .join(Campaign, Campaign.id == GmScreenPanel.campaign_id)
        .filter(Campaign.owner_id == current_user.id)
        .filter(Campaign.id != campaign_id)
        .all()
    ):
        counts[source_id] = counts.get(source_id, 0) + 1
    if not counts:
        return {"campaigns": []}
    rows = db.query(Campaign).filter(Campaign.id.in_(counts)).order_by(Campaign.name).all()
    return {
        "campaigns": [
            {"id": row.id, "name": row.name, "panel_count": counts[row.id]} for row in rows
        ]
    }


def copy_gm_screen(
    campaign_id: str,
    data: GmCopyRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Copy another campaign's board here: its setup, not its numbers.

    Counters start at their starting value, countdowns unticked, the turn order
    empty - a new table's game has not happened yet. Pinned notes look for a
    page with the same name here.
    """
    _gm_campaign(db, campaign_id, current_user, write=True)
    source: Optional[Campaign] = (
        db.query(Campaign).filter_by(id=data.source_campaign_id, owner_id=current_user.id).first()
    )
    if source is None or source.id == campaign_id:
        raise HTTPException(404, "Campaign not found")
    document = _export(db, source)
    if not document["panels"]:
        raise HTTPException(400, "That campaign's GM screen is empty")
    _add_board(db, campaign_id, boards.parse_board(document, keep_state=False), data.replace)
    return _board(db, campaign_id)


def export_gm_screen(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The board as a document: to keep, to paste into another server, or to
    offer the community as a preset."""
    c = _gm_campaign(db, campaign_id, current_user)
    return _export(db, c)


def import_gm_screen(
    campaign_id: str,
    data: GmImportRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Put an exported or hand-written board on this campaign."""
    _gm_campaign(db, campaign_id, current_user, write=True)
    try:
        board = boards.parse_board(data.document)
    except p.PanelError as exc:
        raise HTTPException(400, str(exc)) from exc
    _add_board(db, campaign_id, board, data.replace)
    return _board(db, campaign_id)


def browse_gm_screen_presets(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The community catalogue of ready-made boards."""
    _gm_campaign(db, campaign_id, current_user)
    if not presets.downloads_enabled():
        raise HTTPException(403, "Downloading GM screen presets is disabled on this server")
    return presets.fetch_catalogue(db)


def apply_gm_screen_preset(
    campaign_id: str,
    data: GmApplyPresetRequest,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Download a preset from the catalogue and put it on this campaign."""
    _gm_campaign(db, campaign_id, current_user, write=True)
    if not presets.downloads_enabled():
        raise HTTPException(403, "Downloading GM screen presets is disabled on this server")
    try:
        entry = presets.find_entry(db, data.preset_id, data.index_url)
    except presets.PresetError as exc:
        raise HTTPException(404, str(exc)) from exc
    try:
        preset = presets.fetch_preset(db, entry)
    except presets.PresetError as exc:
        raise HTTPException(502, str(exc)) from exc
    _add_board(db, campaign_id, preset["panels"], data.replace)
    return _board(db, campaign_id)


def get_gm_screen_party(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The campaign's characters with their values, for the party overview."""
    _gm_campaign(db, campaign_id, current_user)
    return party_overview(db, campaign_id, current_user.id)
