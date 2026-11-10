"""Books the organiser shares with a league.

Modelled on a campaign's linked resources (``routers/campaigns/resources.py``),
for books alone. Each has a visibility:

  public    - every member sees it
  private   - the organiser, and the members it is shared with
  organizer - the organiser alone

A member reads a book shared with them whatever their account: this is how a
league's guests, who have no library, open the books their armies cite. The
gate that serves the book itself is ``services.campaigns.access``, which reads
these rows; the book's own access level still applies on top, so a restricted
book is only ever shared at ``organizer``.
"""
from typing import Optional

from fastapi import Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Book, GameSystem, League, LeagueMember, LeagueResource, LeagueResourceShare
from ...models.access import LEVEL_OPEN
from ...models.leagues import (
    VISIBILITIES,
    VISIBILITY_ORGANIZER,
    VISIBILITY_PRIVATE,
    VISIBILITY_PUBLIC,
)
from ...services import access_control
from ...services.books.access import can_read_book
from ._helpers import get_league, manages
from ._schemas import BookAdd, BookReorder, BookUpdate

#: The most books a title search returns.
_SEARCH_LIMIT = 20
_VIS_ORDER = {v: i for i, v in enumerate(VISIBILITIES)}


def _clamp(db: Session, book: Book, visibility: str) -> str:
    """Keep a restricted book at ``organizer``, as a campaign keeps one GM-only.

    The organiser may need it to run the league, but its access level exists to
    keep it from the players, so it is clamped rather than refused.
    """
    if visibility == VISIBILITY_ORGANIZER:
        return visibility
    if access_control.resolve_level(db, book) == LEVEL_OPEN:
        return visibility
    return VISIBILITY_ORGANIZER


def _members(db: Session, league: League) -> set[str]:
    return {
        row[0] for row in db.query(LeagueMember.user_id).filter_by(league_id=league.id).all()
    }


def _apply_shares(db: Session, league: League, res: LeagueResource, user_ids: list[str]) -> None:
    """Share a private book with exactly ``user_ids``, who must all be members."""
    wanted = set(user_ids)
    if wanted - _members(db, league):
        raise HTTPException(400, "A book can only be shared with the league's members")
    db.query(LeagueResourceShare).filter_by(resource_id=res.id).delete(synchronize_session=False)
    for user_id in sorted(wanted):
        db.add(LeagueResourceShare(resource_id=res.id, user_id=user_id))


def _shares(db: Session, resource_ids: list[str]) -> dict[str, set[str]]:
    out: dict[str, set[str]] = {}
    if not resource_ids:
        return out
    for share in db.query(LeagueResourceShare).filter(
        LeagueResourceShare.resource_id.in_(resource_ids)
    ):
        out.setdefault(share.resource_id, set()).add(share.user_id)
    return out


def _serialize(res: LeagueResource, book: Book, shares: Optional[set[str]]) -> dict:
    return {
        "id": res.id,
        "book_id": res.resource_id,
        "title": book.title or "",
        "has_thumbnail": bool(book.has_thumbnail),
        "visibility": res.visibility,
        "sort_order": res.sort_order or 0,
        "shared_user_ids": sorted(shares) if shares is not None else None,
    }


def _sees(res: LeagueResource, organiser: bool, user_id: str, shares: dict[str, set[str]]) -> bool:
    if organiser or res.visibility == VISIBILITY_PUBLIC:
        return True
    return res.visibility == VISIBILITY_PRIVATE and user_id in shares.get(res.id, set())


def _get_book(db: Session, league: League, resource_id: str) -> LeagueResource:
    res = db.query(LeagueResource).filter_by(id=resource_id, league_id=league.id).first()
    if res is None:
        raise HTTPException(404, "Book not found")
    return res


def _readable(db: Session, book_id: str, user: CurrentUser) -> Optional[Book]:
    book = db.query(Book).filter_by(id=book_id).first()
    return book if book is not None and can_read_book(db, book, user) else None


def list_books(
    league_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """The books shared with the league that the caller may open.

    The organiser sees every one, with who a private one is shared with; a
    member sees the public ones and the private ones shared with them. A book
    whose access level has since closed to the caller is left out.
    """
    league = get_league(db, league_id, current_user)
    organiser = manages(league, current_user)
    rows = (
        db.query(LeagueResource)
        .filter_by(league_id=league.id, resource_type="book")
        .all()
    )
    shares = _shares(db, [r.id for r in rows])
    visible = [r for r in rows if _sees(r, organiser, current_user.id, shares)]
    books = {
        b.id: b
        for b in db.query(Book).filter(Book.id.in_([r.resource_id for r in visible] or [""]))
    }
    out = []
    for res in visible:
        book = books.get(res.resource_id)
        if book is None or not can_read_book(db, book, current_user):
            continue
        out.append(_serialize(res, book, shares.get(res.id, set()) if organiser else None))
    out.sort(key=lambda b: (_VIS_ORDER.get(b["visibility"], 9), b["sort_order"], b["title"].lower()))
    return out


def search_books(
    league_id: str,
    q: str = Query(..., min_length=2, max_length=200, description="Part of a book title"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Library books whose titles contain ``q``, to share with the league (organiser).

    Only books the organiser can open themselves. The league's own game comes
    first, then everything else by title.
    """
    league = get_league(db, league_id, current_user, manage=True)
    escaped = q.strip().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    query = db.query(Book).filter(Book.title.ilike(f"%{escaped}%", escape="\\"))
    rows = (
        access_control.visible_books(db, query, current_user)
        .order_by(Book.title)
        .limit(_SEARCH_LIMIT * 5)
        .all()
    )
    rows = [b for b in rows if can_read_book(db, b, current_user)]
    rows.sort(key=lambda b: (b.game_system_id != league.game_system_id, (b.title or "").lower()))
    system_ids = {b.game_system_id for b in rows if b.game_system_id}
    names = {
        s.id: s.name
        for s in db.query(GameSystem).filter(GameSystem.id.in_(system_ids or {""}))
    }
    return [
        {
            "book_id": b.id,
            "title": b.title or "",
            "has_thumbnail": bool(b.has_thumbnail),
            "game_system_name": names.get(b.game_system_id or "", ""),
        }
        for b in rows[:_SEARCH_LIMIT]
    ]


def add_book(
    league_id: str,
    data: BookAdd,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Share a book with the league (organiser). 404 for a book the organiser cannot open."""
    league = get_league(db, league_id, current_user, manage=True)
    book = _readable(db, data.book_id, current_user)
    if book is None:
        raise HTTPException(404, "Book not found")
    exists = (
        db.query(LeagueResource.id)
        .filter_by(league_id=league.id, resource_type="book", resource_id=book.id)
        .first()
    )
    if exists is not None:
        raise HTTPException(409, "That book is already shared with the league")
    res = LeagueResource(
        league_id=league.id,
        resource_type="book",
        resource_id=book.id,
        visibility=_clamp(db, book, data.visibility),
        sort_order=db.query(LeagueResource).filter_by(league_id=league.id).count(),
    )
    db.add(res)
    db.flush()
    if res.visibility == VISIBILITY_PRIVATE:
        _apply_shares(db, league, res, data.shared_user_ids)
    db.commit()
    return _serialize(res, book, _shares(db, [res.id]).get(res.id, set()))


def update_book(
    league_id: str,
    resource_id: str,
    data: BookUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Change who a shared book reaches (organiser)."""
    league = get_league(db, league_id, current_user, manage=True)
    res = _get_book(db, league, resource_id)
    book = db.query(Book).filter_by(id=res.resource_id).first()
    if book is None:
        raise HTTPException(404, "Book not found")
    if data.visibility is not None:
        res.visibility = _clamp(db, book, data.visibility)
    if res.visibility != VISIBILITY_PRIVATE:
        db.query(LeagueResourceShare).filter_by(resource_id=res.id).delete(
            synchronize_session=False
        )
    elif data.shared_user_ids is not None:
        _apply_shares(db, league, res, data.shared_user_ids)
    db.commit()
    return _serialize(res, book, _shares(db, [res.id]).get(res.id, set()))


def reorder_books(
    league_id: str,
    data: BookReorder,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply a new manual order from an ordered list of the league's book ids (organiser)."""
    league = get_league(db, league_id, current_user, manage=True)
    by_id = {r.id: r for r in db.query(LeagueResource).filter_by(league_id=league.id)}
    order = 0
    for rid in data.ordered_ids:
        res = by_id.get(rid)
        if res is not None:
            res.sort_order = order
            order += 1
    db.commit()
    return Response(status_code=204)


def remove_book(
    league_id: str,
    resource_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Stop sharing a book with the league (organiser). The book itself is untouched."""
    league = get_league(db, league_id, current_user, manage=True)
    res = _get_book(db, league, resource_id)
    db.query(LeagueResourceShare).filter_by(resource_id=res.id).delete(synchronize_session=False)
    db.delete(res)
    db.commit()
    return Response(status_code=204)
