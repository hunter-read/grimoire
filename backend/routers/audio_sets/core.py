"""Saved audio-set CRUD endpoints.

Named, per-user playlists and soundboards (issue #422). The live queue and the
live soundboard stay in browser storage — this is the shelf you save them to,
so a GM can build a "Tavern" board once and get it back next session, on any
device.

Entries store audio ids only. Titles are resolved against the library on read,
so a retitled track shows through everywhere it is saved, and an entry whose
track has been deleted — or is no longer shared with a guest — is dropped from
the response and counted in ``missing`` rather than failing the load.
"""
from typing import Any, Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import SET_TYPES, Audio, AudioSet
from .._media_access import assert_media_access
from ._schemas import AudioSetCreate, AudioSetUpdate


def _stored_entries(s: AudioSet) -> list[dict[str, Any]]:
    """The set's raw entries, defended against a hand-edited row."""
    raw = s.entries or []
    if not isinstance(raw, list):
        return []
    return [e for e in raw if isinstance(e, dict) and e.get("audio_id")]


def _readable(db: Session, user: CurrentUser, audio_id: str) -> bool:
    """Whether this user may still play a saved track.

    Guests only keep the tracks shared into a campaign they belong to, so a set
    saved before they left one degrades to the tracks they can still reach
    instead of 403-ing the whole load.
    """
    try:
        assert_media_access(db, user, "audio", audio_id)
    except HTTPException:
        return False
    return True


def _resolve(db: Session, user: CurrentUser, s: AudioSet) -> tuple[list[dict[str, Any]], int]:
    """Pair saved entries with current library metadata, dropping what is gone.

    Returns ``(entries, missing)``. Order is the saved order — a playlist is an
    ordered thing and a board's pad positions matter — so the rows are fetched
    in one query and re-indexed rather than iterated in whatever order the
    database returns.
    """
    stored = _stored_entries(s)
    if not stored:
        return [], 0

    ids = list({e["audio_id"] for e in stored})
    rows = db.query(Audio).filter(Audio.id.in_(ids)).all()
    by_id = {a.id: a for a in rows}

    entries: list[dict[str, Any]] = []
    missing = 0
    # One access check per distinct id, not per entry — a set cannot hold the
    # same id twice today, but a hand-written one could.
    allowed: dict[str, bool] = {}
    for e in stored:
        audio_id = e["audio_id"]
        a = by_id.get(audio_id)
        if a is None:
            missing += 1
            continue
        if audio_id not in allowed:
            allowed[audio_id] = _readable(db, user, audio_id)
        if not allowed[audio_id]:
            missing += 1
            continue
        entries.append(
            {
                "audio_id": audio_id,
                "loop": bool(e.get("loop")),
                "title": a.title or a.filename,
                "artist": a.artist or "",
                "has_artwork": bool(a.has_artwork),
            }
        )
    return entries, missing


def _layout(s: AudioSet) -> Optional[dict[str, Any]]:
    return s.layout if isinstance(s.layout, dict) else None


def _serialize(db: Session, user: CurrentUser, s: AudioSet) -> dict[str, Any]:
    entries, missing = _resolve(db, user, s)
    return {
        "id": s.id,
        "kind": s.kind,
        "name": s.name,
        "entries": entries,
        "missing": missing,
        "layout": _layout(s),
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _summarize(s: AudioSet) -> dict[str, Any]:
    """A listing row. The count is of *saved* entries, not resolved ones — the
    list stays a cheap query, and the load response reports what was missing."""
    return {
        "id": s.id,
        "kind": s.kind,
        "name": s.name,
        "count": len(_stored_entries(s)),
        "layout": _layout(s),
        "updated_at": s.updated_at.isoformat() if s.updated_at else None,
    }


def _entries_payload(entries: Any) -> list[dict[str, Any]]:
    return [{"audio_id": e.audio_id, "loop": bool(e.loop)} for e in entries]


def _layout_payload(kind: str, layout: Any) -> Optional[dict[str, Any]]:
    """Only a soundboard carries a grid; a playlist's layout is always null."""
    if kind != "soundboard" or layout is None:
        return None
    return {"cols": layout.cols, "rows": layout.rows}


def list_audio_sets(
    kind: Optional[str] = Query(None),
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """List the current user's saved sets, optionally limited to one kind."""
    q = db.query(AudioSet).filter_by(user_id=user.id)
    if kind is not None:
        if kind not in SET_TYPES:
            raise HTTPException(400, "Invalid kind")
        q = q.filter_by(kind=kind)
    rows = q.order_by(AudioSet.kind, AudioSet.name).all()
    return {"sets": [_summarize(s) for s in rows]}


def get_audio_set(
    set_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Load one set, resolved against the current library."""
    s = db.query(AudioSet).filter_by(id=set_id, user_id=user.id).first()
    if not s:
        raise HTTPException(404, "Saved set not found")
    return _serialize(db, user, s)


def create_audio_set(
    body: AudioSetCreate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Save a set. Re-saving an existing (kind, name) overwrites its contents.

    Overwriting rather than duplicating is what "save" means here: a GM
    re-saving "Tavern" after adding a pad expects one Tavern, not two.
    """
    entries = _entries_payload(body.entries)
    layout = _layout_payload(body.kind, body.layout)

    existing = (
        db.query(AudioSet).filter_by(user_id=user.id, kind=body.kind, name=body.name).first()
    )
    if existing:
        existing.entries = entries
        existing.layout = layout
        db.commit()
        return _serialize(db, user, existing)

    s = AudioSet(
        user_id=user.id,
        kind=body.kind,
        name=body.name,
        entries=entries,
        layout=layout,
    )
    db.add(s)
    db.commit()
    return _serialize(db, user, s)


def update_audio_set(
    set_id: str,
    body: AudioSetUpdate,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Rename a set and/or replace its contents."""
    s = db.query(AudioSet).filter_by(id=set_id, user_id=user.id).first()
    if not s:
        raise HTTPException(404, "Saved set not found")

    if body.name is not None and body.name != s.name:
        clash = (
            db.query(AudioSet)
            .filter(
                AudioSet.user_id == user.id,
                AudioSet.kind == s.kind,
                AudioSet.name == body.name,
                AudioSet.id != s.id,
            )
            .first()
        )
        if clash:
            raise HTTPException(409, "A set with that name already exists")
        s.name = body.name

    if body.entries is not None:
        s.entries = _entries_payload(body.entries)
    if body.layout is not None:
        s.layout = _layout_payload(s.kind, body.layout)

    db.commit()
    return _serialize(db, user, s)


def delete_audio_set(
    set_id: str,
    user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Delete one of the current user's saved sets."""
    s = db.query(AudioSet).filter_by(id=set_id, user_id=user.id).first()
    if not s:
        raise HTTPException(404, "Saved set not found")
    db.delete(s)
    db.commit()
    return {"status": "ok"}
