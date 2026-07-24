"""Session note endpoint handlers for campaigns."""

import datetime

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import GMSessionNote, PlayerSessionNote, SessionNote, User
from ._helpers import assert_can_manage, can_view, extract_snippet, get_campaign_or_404
from ._schemas import GMNoteUpdate, PlayerNoteUpdate, SessionNoteCreate, SessionNoteUpdate


def search_session_notes(
    campaign_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    is_owner = c.owner_id == current_user.id or current_user.role == "admin"
    term = f"%{q}%"

    sessions = db.query(SessionNote).filter_by(campaign_id=campaign_id).all()
    session_map = {s.id: s for s in sessions}
    if not session_map:
        return {"results": [], "query": q}

    all_users = {u.id: u for u in db.query(User).all()}
    results = []

    # Player notes — visible to all campaign members
    for note in (
        db.query(PlayerSessionNote)
        .filter(
            PlayerSessionNote.session_id.in_(session_map),
            PlayerSessionNote.content.ilike(term),
        )
        .all()
    ):
        s = session_map[note.session_id]
        author = all_users.get(note.user_id)
        results.append(
            {
                "session_id": s.id,
                "session_date": s.session_date,
                "session_title": s.title,
                "note_type": "player",
                "author_id": note.user_id,
                "author_username": author.username if author else "",
                "author_display_name": author.display_name if author else None,
                "snippet": extract_snippet(note.content, q),
            }
        )

    # GM shared notes — visible to all campaign members
    gm_notes = db.query(GMSessionNote).filter(GMSessionNote.session_id.in_(session_map)).all()
    owner = all_users.get(c.owner_id)

    for note in gm_notes:
        s = session_map[note.session_id]
        if note.external_content and q.lower() in note.external_content.lower():
            results.append(
                {
                    "session_id": s.id,
                    "session_date": s.session_date,
                    "session_title": s.title,
                    "note_type": "gm_external",
                    "author_id": c.owner_id,
                    "author_username": owner.username if owner else "",
                    "author_display_name": owner.display_name if owner else None,
                    "snippet": extract_snippet(note.external_content, q),
                }
            )

    # GM internal notes — owner/admin only
    if is_owner:
        for note in gm_notes:
            s = session_map[note.session_id]
            if note.internal_content and q.lower() in note.internal_content.lower():
                results.append(
                    {
                        "session_id": s.id,
                        "session_date": s.session_date,
                        "session_title": s.title,
                        "note_type": "gm_internal",
                        "author_id": c.owner_id,
                        "author_username": owner.username if owner else "",
                        "author_display_name": owner.display_name if owner else None,
                        "snippet": extract_snippet(note.internal_content, q),
                    }
                )

    results.sort(key=lambda r: r["session_date"])
    return {"results": results, "query": q}


def list_sessions(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    sessions = (
        db.query(SessionNote)
        .filter_by(campaign_id=campaign_id)
        .order_by(SessionNote.session_date)
        .all()
    )
    return [{"id": s.id, "session_date": s.session_date, "title": s.title} for s in sessions]


def create_session(
    campaign_id: str,
    data: SessionNoteCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    try:
        datetime.date.fromisoformat(data.session_date)
    except ValueError:
        raise HTTPException(400, "session_date must be YYYY-MM-DD")

    session = SessionNote(
        campaign_id=campaign_id, session_date=data.session_date, title=data.title
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return {"id": session.id, "session_date": session.session_date, "title": session.title}


def get_session(
    campaign_id: str,
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    session = db.query(SessionNote).filter_by(id=session_id, campaign_id=campaign_id).first()
    if not session:
        raise HTTPException(404, "Session not found")

    is_owner = c.owner_id == current_user.id or current_user.role == "admin"
    all_users = {u.id: u for u in db.query(User).all()}

    player_notes = [
        {
            "user_id": n.user_id,
            "username": all_users[n.user_id].username if n.user_id in all_users else "",
            "display_name": all_users[n.user_id].display_name
            if n.user_id in all_users
            else None,
            "content": n.content,
            "updated_at": n.updated_at.isoformat() if n.updated_at else None,
        }
        for n in session.player_notes
    ]

    gm_note = session.gm_note
    gm_data = {}
    if gm_note:
        gm_data["external_content"] = gm_note.external_content
        if is_owner:
            gm_data["internal_content"] = gm_note.internal_content
        gm_data["updated_at"] = gm_note.updated_at.isoformat() if gm_note.updated_at else None

    return {
        "id": session.id,
        "campaign_id": campaign_id,
        "session_date": session.session_date,
        "title": session.title,
        "player_notes": player_notes,
        "gm_note": gm_data,
    }


def update_session(
    campaign_id: str,
    session_id: str,
    data: SessionNoteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    session = db.query(SessionNote).filter_by(id=session_id, campaign_id=campaign_id).first()
    if not session:
        raise HTTPException(404, "Session not found")
    if data.title is not None:
        session.title = data.title
    db.commit()
    return {"id": session.id, "session_date": session.session_date, "title": session.title}


def delete_session(
    campaign_id: str,
    session_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)
    session = db.query(SessionNote).filter_by(id=session_id, campaign_id=campaign_id).first()
    if session:
        db.delete(session)
        db.commit()


def upsert_player_note(
    campaign_id: str,
    session_id: str,
    data: PlayerNoteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")

    session = db.query(SessionNote).filter_by(id=session_id, campaign_id=campaign_id).first()
    if not session:
        raise HTTPException(404, "Session not found")

    note = (
        db.query(PlayerSessionNote)
        .filter_by(session_id=session_id, user_id=current_user.id)
        .first()
    )
    if note:
        note.content = data.content
    else:
        note = PlayerSessionNote(
            session_id=session_id, user_id=current_user.id, content=data.content
        )
        db.add(note)
    db.commit()
    return {"content": data.content}


def upsert_gm_note(
    campaign_id: str,
    session_id: str,
    data: GMNoteUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    assert_can_manage(c, current_user, db)

    session = db.query(SessionNote).filter_by(id=session_id, campaign_id=campaign_id).first()
    if not session:
        raise HTTPException(404, "Session not found")

    gm_note = db.query(GMSessionNote).filter_by(session_id=session_id).first()
    if gm_note:
        if data.internal_content is not None:
            gm_note.internal_content = data.internal_content
        if data.external_content is not None:
            gm_note.external_content = data.external_content
    else:
        gm_note = GMSessionNote(
            session_id=session_id,
            internal_content=data.internal_content or "",
            external_content=data.external_content or "",
        )
        db.add(gm_note)
    db.commit()
    return {
        "internal_content": gm_note.internal_content,
        "external_content": gm_note.external_content,
    }
