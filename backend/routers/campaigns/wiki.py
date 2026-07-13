"""Wiki page endpoint handlers — the campaign-building notebook.

Pages hold markdown bodies and link to each other with `[[Page Title]]` syntax.
Grimoire content is embedded inline as `[[book:<id>]]`, `[[book:<id>:<page>]]`,
`[[map:<id>]]`, `[[token:<id>]]`, or `[[audio:<id>]]` — those are rendered by the frontend and are
not tracked as page-to-page links. On every save we re-parse the body, auto-create
stub pages for any unknown `[[Page Title]]` targets, and rebuild backlink rows.
"""

import datetime
import re

from fastapi import Depends, HTTPException, Query

from ...auth import CurrentUser, get_current_user
from ...config import SessionLocal
from ...models import User, WikiPage, WikiPageLink, WikiPageShare
from ._helpers import (
    assert_can_manage,
    can_view,
    extract_snippet,
    get_campaign_or_404,
    strip_gm_secrets,
)
from ._schemas import WikiPageCreate, WikiPageUpdate, WikiReorder

# Reserved prefixes for Grimoire content embeds — not page-title links.
_EMBED_PREFIXES = ("book:", "map:", "token:", "audio:", "file:", "image:")

# Matches [[target]] or [[target|label]]; target/label captured separately.
_LINK_RE = re.compile(r"\[\[([^\]|]+?)(?:\|([^\]]+))?\]\]")


def slugify(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (title or "").lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s or "untitled"


def _is_embed(target: str) -> bool:
    return target.strip().lower().startswith(_EMBED_PREFIXES)


def parse_page_link_titles(body: str) -> list:
    """Return the distinct page-title targets referenced by [[...]] in body."""
    titles = []
    seen = set()
    for m in _LINK_RE.finditer(body or ""):
        target = m.group(1).strip()
        if not target or _is_embed(target):
            continue
        key = slugify(target)
        if key not in seen:
            seen.add(key)
            titles.append(target)
    return titles


def can_view_page(page: WikiPage, campaign, user: CurrentUser, db) -> bool:
    if campaign.owner_id == user.id:
        return True
    # Non-owners must be campaign viewers (accepted members).
    if not can_view(campaign, user, db):
        return False
    if page.visibility == "group":
        return True
    if page.visibility == "members":
        return (
            db.query(WikiPageShare)
            .filter_by(page_id=page.id, user_id=user.id)
            .first()
            is not None
        )
    return False  # gm-only


def can_edit_page(page: WikiPage, campaign, user: CurrentUser) -> bool:
    """Owner edits anything; a member may edit a page they authored."""
    if campaign.owner_id == user.id:
        return True
    return page.created_by_id == user.id


def _ensure_unique_slug(db, campaign_id: str, base_slug: str, exclude_id: str = None) -> str:
    slug = base_slug
    n = 2
    while True:
        q = db.query(WikiPage).filter_by(campaign_id=campaign_id, slug=slug)
        if exclude_id:
            q = q.filter(WikiPage.id != exclude_id)
        if q.first() is None:
            return slug
        slug = f"{base_slug}-{n}"
        n += 1


def rebuild_links(db, campaign, page: WikiPage, current_user: CurrentUser) -> None:
    """Re-parse a page's body, auto-create stub targets, and rebuild backlink rows.

    Stub pages inherit the source page's visibility so a [[link]] in a group page
    doesn't silently create a GM-only target the players can't reach.
    """
    db.query(WikiPageLink).filter_by(source_page_id=page.id).delete()

    target_ids = set()
    for title in parse_page_link_titles(page.body):
        slug = slugify(title)
        target = (
            db.query(WikiPage).filter_by(campaign_id=campaign.id, slug=slug).first()
        )
        if target is None:
            target = WikiPage(
                campaign_id=campaign.id,
                title=title,
                slug=_ensure_unique_slug(db, campaign.id, slug),
                body="",
                visibility=page.visibility,
                page_type="note",
                created_by_id=current_user.id,
            )
            db.add(target)
            db.flush()
        if target.id != page.id:
            target_ids.add(target.id)

    for tid in target_ids:
        db.add(
            WikiPageLink(campaign_id=campaign.id, source_page_id=page.id, target_page_id=tid)
        )


def _resolve_parent(db, campaign_id: str, parent_id, page_id: str = None):
    """Validate a parent-page id for this campaign. Empty string moves to root.

    Returns the resolved id (or None), raising 400 if the parent is unknown, in a
    different campaign, the page itself, or one of its own descendants (which would
    create a cycle).
    """
    if parent_id in (None, ""):
        return None
    parent = (
        db.query(WikiPage).filter_by(id=parent_id, campaign_id=campaign_id).first()
    )
    if not parent:
        raise HTTPException(400, "Invalid parent page")
    if page_id is not None:
        if parent_id == page_id:
            raise HTTPException(400, "A page cannot be its own parent")
        # Walk up from the candidate parent; if we reach this page, it's a cycle.
        seen = set()
        cur = parent
        while cur is not None and cur.parent_id:
            if cur.parent_id == page_id:
                raise HTTPException(400, "Cannot move a page under its own descendant")
            if cur.parent_id in seen:
                break  # defensive: pre-existing cycle, don't loop forever
            seen.add(cur.parent_id)
            cur = db.query(WikiPage).filter_by(id=cur.parent_id).first()
    return parent.id


def _page_summary(p: WikiPage) -> dict:
    return {
        "id": p.id,
        "title": p.title,
        "slug": p.slug,
        "visibility": p.visibility,
        "page_type": p.page_type,
        "session_date": p.session_date,
        "parent_id": p.parent_id,
        "icon": p.icon,
        "sort_order": p.sort_order,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def list_pages(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        pages = db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
        visible = [p for p in pages if can_view_page(p, c, current_user, db)]
        # Manual order first; fall back to title for pages never reordered.
        visible.sort(key=lambda p: (p.sort_order or 0, (p.title or "").lower()))
        return [
            {**_page_summary(p), "can_edit": can_edit_page(p, c, current_user)}
            for p in visible
        ]
    finally:
        db.close()


def reorder_pages(
    campaign_id: str,
    data: WikiReorder,
    current_user: CurrentUser = Depends(get_current_user),
):
    """Apply a new manual order from an ordered list of page ids (owner only)."""
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        assert_can_manage(c, current_user, db)
        by_id = {
            p.id: p for p in db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
        }
        order = 0
        for pid in data.ordered_ids:
            p = by_id.get(pid)
            if p:
                p.sort_order = order
                order += 1
        db.commit()
        return {"ok": True}
    finally:
        db.close()


def get_page(
    campaign_id: str, page_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
        if not page:
            raise HTTPException(404, "Page not found")
        if not can_view_page(page, c, current_user, db):
            raise HTTPException(403, "Not authorised to view this page")

        is_owner = c.owner_id == current_user.id
        all_users = {u.id: u for u in db.query(User).all()}
        author = all_users.get(page.created_by_id)

        # Backlinks: other pages that link here, filtered to what the viewer can see.
        backlink_rows = db.query(WikiPageLink).filter_by(target_page_id=page.id).all()
        backlinks = []
        for row in backlink_rows:
            src = db.query(WikiPage).filter_by(id=row.source_page_id).first()
            if src and can_view_page(src, c, current_user, db):
                backlinks.append(_page_summary(src))

        shared_user_ids = (
            [s.user_id for s in db.query(WikiPageShare).filter_by(page_id=page.id).all()]
            if page.visibility == "members"
            else []
        )

        return {
            "id": page.id,
            "campaign_id": campaign_id,
            "title": page.title,
            "slug": page.slug,
            # ||...|| spans are GM-only: strip them for everyone but the owner.
            # (Personal campaigns only ever have the owner as a viewer, so their
            # bodies are never stripped.)
            "body": page.body if is_owner else strip_gm_secrets(page.body),
            "visibility": page.visibility,
            "page_type": page.page_type,
            "session_date": page.session_date,
            "parent_id": page.parent_id,
            "icon": page.icon,
            "created_by_id": page.created_by_id,
            "created_by_name": (author.display_name or author.username) if author else None,
            "can_edit": can_edit_page(page, c, current_user),
            "shared_user_ids": shared_user_ids,
            "backlinks": backlinks,
            "updated_at": page.updated_at.isoformat() if page.updated_at else None,
        }
    finally:
        db.close()


def _apply_shares(db, page: WikiPage, user_ids) -> None:
    db.query(WikiPageShare).filter_by(page_id=page.id).delete()
    if page.visibility == "members" and user_ids:
        for uid in set(user_ids):
            db.add(WikiPageShare(page_id=page.id, user_id=uid))


def create_page(
    campaign_id: str,
    data: WikiPageCreate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")

        is_owner = c.owner_id == current_user.id
        visibility = data.visibility or "gm"
        if visibility not in ("gm", "group", "members"):
            raise HTTPException(400, "Invalid visibility")
        # Members may only create group pages; gm/members visibility is owner-only.
        if not is_owner and visibility != "group":
            raise HTTPException(403, "Members can only create group-visible pages")

        title = (data.title or "").strip() or "Untitled"
        slug = _ensure_unique_slug(db, campaign_id, slugify(title))
        if data.session_date:
            try:
                datetime.date.fromisoformat(data.session_date)
            except ValueError:
                raise HTTPException(400, "session_date must be YYYY-MM-DD")

        parent_id = _resolve_parent(db, campaign_id, data.parent_id)

        page = WikiPage(
            campaign_id=campaign_id,
            title=title,
            slug=slug,
            body=data.body or "",
            visibility=visibility,
            page_type=data.page_type if data.page_type in ("note", "session") else "note",
            session_date=data.session_date,
            created_by_id=current_user.id,
            parent_id=parent_id,
            icon=(data.icon or None),
        )
        db.add(page)
        db.flush()
        if is_owner:
            _apply_shares(db, page, data.shared_user_ids or [])
        rebuild_links(db, c, page, current_user)
        db.commit()
        db.refresh(page)
        return _page_summary(page)
    finally:
        db.close()


def update_page(
    campaign_id: str,
    page_id: str,
    data: WikiPageUpdate,
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
        if not page:
            raise HTTPException(404, "Page not found")
        if not can_edit_page(page, c, current_user):
            raise HTTPException(403, "Not authorised to edit this page")

        is_owner = c.owner_id == current_user.id

        if data.title is not None:
            new_title = data.title.strip() or "Untitled"
            if new_title != page.title:
                page.title = new_title
                page.slug = _ensure_unique_slug(db, campaign_id, slugify(new_title), exclude_id=page.id)
        if data.body is not None:
            page.body = data.body
        if data.visibility is not None:
            if data.visibility not in ("gm", "group", "members"):
                raise HTTPException(400, "Invalid visibility")
            # Only the owner may set gm/members visibility.
            if not is_owner and data.visibility != "group":
                raise HTTPException(403, "Only the owner can set this visibility")
            page.visibility = data.visibility
        if data.session_date is not None:
            page.session_date = data.session_date or None
        if data.page_type is not None and data.page_type in ("note", "session"):
            page.page_type = data.page_type
        if data.parent_id is not None:
            page.parent_id = _resolve_parent(db, campaign_id, data.parent_id, page_id=page.id)
        if data.icon is not None:
            page.icon = data.icon or None

        if data.shared_user_ids is not None and is_owner:
            _apply_shares(db, page, data.shared_user_ids)
        # If no longer members-visibility, drop any stale shares.
        if page.visibility != "members":
            db.query(WikiPageShare).filter_by(page_id=page.id).delete()

        rebuild_links(db, c, page, current_user)
        db.commit()
        db.refresh(page)
        return _page_summary(page)
    finally:
        db.close()


def delete_page(
    campaign_id: str, page_id: str, current_user: CurrentUser = Depends(get_current_user)
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
        if not page:
            return
        # Owner deletes anything; a member may delete a page they authored.
        if c.owner_id != current_user.id and page.created_by_id != current_user.id:
            raise HTTPException(403, "Not authorised to delete this page")
        # Re-parent any children to this page's parent so subtrees aren't orphaned
        # (deleting a "category" page lifts its pages a level instead of nuking them).
        db.query(WikiPage).filter_by(campaign_id=campaign_id, parent_id=page_id).update(
            {WikiPage.parent_id: page.parent_id}, synchronize_session=False
        )
        # Drop link rows referencing this page from either side.
        db.query(WikiPageLink).filter(
            (WikiPageLink.source_page_id == page_id)
            | (WikiPageLink.target_page_id == page_id)
        ).delete(synchronize_session=False)
        db.delete(page)
        db.commit()
    finally:
        db.close()


def search_pages(
    campaign_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    current_user: CurrentUser = Depends(get_current_user),
):
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        term = f"%{q}%"
        pages = (
            db.query(WikiPage)
            .filter(
                WikiPage.campaign_id == campaign_id,
                (WikiPage.title.ilike(term)) | (WikiPage.body.ilike(term)),
            )
            .all()
        )
        is_owner = c.owner_id == current_user.id
        results = []
        for p in pages:
            if not can_view_page(p, c, current_user, db):
                continue
            # Hide ||...|| GM-only spans from non-owners: search and snippet over
            # the stripped body so a secret can't leak via a body-only match.
            body = p.body or "" if is_owner else strip_gm_secrets(p.body or "")
            if not is_owner and q.lower() not in (p.title or "").lower() and q.lower() not in body.lower():
                continue
            d = _page_summary(p)
            d["snippet"] = extract_snippet(body, q) if body else ""
            results.append(d)
        results.sort(key=lambda r: (r["title"] or "").lower())
        return {"results": results, "query": q}
    finally:
        db.close()


def page_titles(campaign_id: str, current_user: CurrentUser = Depends(get_current_user)):
    """Lightweight list of {title, slug} for the [[link]] autocomplete."""
    db = SessionLocal()
    try:
        c = get_campaign_or_404(db, campaign_id)
        if not can_view(c, current_user, db):
            raise HTTPException(403, "Not a member of this campaign")
        pages = db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
        return [
            {"title": p.title, "slug": p.slug}
            for p in pages
            if can_view_page(p, c, current_user, db)
        ]
    finally:
        db.close()
