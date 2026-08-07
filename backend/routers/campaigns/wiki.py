"""Wiki page endpoint handlers — the campaign-building notebook.

Pages hold markdown bodies and link to each other with `[[Page Title]]` syntax,
optionally pinned to a page id and/or a heading —
`[[Page Title:id-<page_id>:#Heading]]`. See `wikilinks.py` for the target grammar.
Grimoire content is embedded inline as `[[book:<id>]]`, `[[book:<id>:<page>]]`,
`[[map:<id>]]`, `[[token:<id>]]`, or `[[audio:<id>]]` — those are rendered by the frontend and are
not tracked as page-to-page links. On every save we re-parse the body, auto-create
stub pages for unknown *unpinned* `[[Page Title]]` targets, and rebuild backlink rows.
"""

import datetime

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import User, WikiPage, WikiPageLink, WikiPageShare
from ._helpers import (
    assert_can_manage,
    assert_not_archived,
    can_view,
    extract_snippet,
    get_campaign_or_404,
    merge_gm_secrets,
    strip_gm_secrets,
)
from ._schemas import WikiPageCreate, WikiPageUpdate, WikiReorder
from .wikilinks import (
    LINK_RE,
    LinkTarget,
    build_target,
    extract_headings,
    is_embed,
    parse_page_links,
    parse_target,
    slugify,
)

__all__ = [
    "slugify",
    "parse_page_link_titles",
    "rebuild_links",
    "list_pages",
    "reorder_pages",
    "get_page",
    "create_page",
    "update_page",
    "delete_page",
    "search_pages",
    "page_titles",
]


def parse_page_link_titles(body: str) -> list:
    """Return the distinct page-title targets referenced by [[...]] in body.

    Kept as a thin title-only view over `parse_page_links` for callers (and tests)
    that only care about which titles a body mentions.
    """
    return [link.title for link in parse_page_links(body)]


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


def resolve_link_target(db, campaign_id: str, link: LinkTarget):
    """Resolve a parsed [[...]] target to a WikiPage, or None.

    Identity beats text: a link carrying `:id-` resolves by that id alone, so it
    keeps pointing at the same page across renames and title collisions (issue
    #287). A stale id (target deleted) resolves to None rather than silently
    falling back to the title, which would re-point the link at whatever page
    happens to hold that title now.
    """
    if link.page_id:
        return (
            db.query(WikiPage)
            .filter_by(id=link.page_id, campaign_id=campaign_id)
            .first()
        )
    return (
        db.query(WikiPage)
        .filter_by(campaign_id=campaign_id, slug=slugify(link.title))
        .first()
    )


def _rebuild_link_rows(db, campaign_id: str, page: WikiPage) -> None:
    """Recompute a page's outgoing link rows against pages that already exist.

    The no-side-effects half of `rebuild_links`: it never creates a target. Used
    when something *other* than a save invalidated a page's links (e.g. its target
    was deleted), where manufacturing a stub would be exactly the wrong response.
    """
    db.query(WikiPageLink).filter_by(source_page_id=page.id).delete()
    target_ids = set()
    for link in parse_page_links(page.body):
        target = resolve_link_target(db, campaign_id, link)
        if target is not None and target.id != page.id:
            target_ids.add(target.id)
    for tid in target_ids:
        db.add(
            WikiPageLink(campaign_id=campaign_id, source_page_id=page.id, target_page_id=tid)
        )


def rebuild_links(db, campaign, page: WikiPage, current_user: CurrentUser) -> None:
    """Re-parse a page's body, auto-create stub targets, and rebuild backlink rows.

    Stub pages inherit the source page's visibility so a [[link]] in a group page
    doesn't silently create a GM-only target the players can't reach.

    Only an *unpinned* `[[Title]]` auto-creates its target. A link pinned with
    `:id-` names a page that already existed, so an unresolvable one means the
    target was deleted — resurrecting it as an empty stub is what silently
    duplicated pages after a delete or rename (issue #287). Those render as broken
    links instead.
    """
    db.query(WikiPageLink).filter_by(source_page_id=page.id).delete()

    target_ids = set()
    for link in parse_page_links(page.body):
        target = resolve_link_target(db, campaign.id, link)
        if target is None:
            if link.page_id:
                continue  # stale pin — leave it broken rather than re-creating
            target = WikiPage(
                campaign_id=campaign.id,
                title=link.title,
                slug=_ensure_unique_slug(db, campaign.id, slugify(link.title)),
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


def rewrite_inbound_titles(db, campaign_id: str, page: WikiPage, old_title: str) -> None:
    """After a rename, update the visible title in links pointing at this page.

    Walks the pages that link here and rewrites the title portion of each
    `[[...]]` whose target resolves to this page, leaving any `:id-` pin and
    `:#Heading` suffix (and any `|label`) untouched. Matching is by resolved
    identity, so a pinned link is rewritten precisely while an unpinned one is
    only touched when its old title actually resolved here.

    Without this a rename leaves `[[Old Title]]` text everywhere — dangling if
    unpinned, merely stale if pinned (issue #287).
    """
    old_slug = slugify(old_title)
    if old_slug == slugify(page.title):
        return  # slug-equivalent rename (casing/punctuation); link text still resolves

    source_ids = [
        row.source_page_id
        for row in db.query(WikiPageLink).filter_by(target_page_id=page.id).all()
    ]
    for src in db.query(WikiPage).filter(WikiPage.id.in_(source_ids)).all() if source_ids else []:

        def repl(m):
            target, label = m.group(1), m.group(2)
            if is_embed(target):
                return m.group(0)
            link = parse_target(target)
            # Only rewrite links that actually point at the renamed page.
            if link.page_id:
                if link.page_id != page.id:
                    return m.group(0)
            elif slugify(link.title) != old_slug:
                return m.group(0)
            new_target = build_target(page.title, link.page_id, link.heading)
            return f"[[{new_target}|{label}]]" if label else f"[[{new_target}]]"

        updated = LINK_RE.sub(repl, src.body or "")
        if updated != src.body:
            src.body = updated


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
        "icon_color": p.icon_color,
        "sort_order": p.sort_order,
        "updated_at": p.updated_at.isoformat() if p.updated_at else None,
    }


def list_pages(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


def reorder_pages(
    campaign_id: str,
    data: WikiReorder,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply a new manual order from an ordered list of page ids (owner only)."""
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


def get_page(
    campaign_id: str, page_id: str, current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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
        # ||...|| spans are GM-only. The owner gets the raw body; everyone else
        # gets it fully stripped — no secret text and no marker, so a player
        # never learns a secret exists or where. A later save re-weaves the
        # stored secrets back by position (merge_gm_secrets). (Personal
        # campaigns only ever have the owner as a viewer, so nothing is
        # stripped.)
        "body": page.body if is_owner else strip_gm_secrets(page.body),
        "visibility": page.visibility,
        "page_type": page.page_type,
        "session_date": page.session_date,
        "parent_id": page.parent_id,
        "icon": page.icon,
        "icon_color": page.icon_color,
        "created_by_id": page.created_by_id,
        "created_by_name": (author.display_name or author.username) if author else None,
        "can_edit": can_edit_page(page, c, current_user),
        "shared_user_ids": shared_user_ids,
        "backlinks": backlinks,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
    }


def _apply_shares(db, page: WikiPage, user_ids) -> None:
    db.query(WikiPageShare).filter_by(page_id=page.id).delete()
    if page.visibility == "members" and user_ids:
        for uid in set(user_ids):
            db.add(WikiPageShare(page_id=page.id, user_id=uid))


def create_page(
    campaign_id: str,
    data: WikiPageCreate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    assert_not_archived(c)

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
        icon_color=(data.icon_color or None),
    )
    db.add(page)
    db.flush()
    if is_owner:
        _apply_shares(db, page, data.shared_user_ids or [])
    rebuild_links(db, c, page, current_user)
    db.commit()
    db.refresh(page)
    return _page_summary(page)


def update_page(
    campaign_id: str,
    page_id: str,
    data: WikiPageUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
    if not page:
        raise HTTPException(404, "Page not found")
    if not can_edit_page(page, c, current_user):
        raise HTTPException(403, "Not authorised to edit this page")
    assert_not_archived(c)

    is_owner = c.owner_id == current_user.id

    if data.title is not None:
        new_title = data.title.strip() or "Untitled"
        if new_title != page.title:
            old_title = page.title
            page.title = new_title
            page.slug = _ensure_unique_slug(db, campaign_id, slugify(new_title), exclude_id=page.id)
            # Follow the rename into the bodies that link here, so inbound
            # [[Old Title]] text doesn't go stale or dangling (issue #287).
            rewrite_inbound_titles(db, campaign_id, page, old_title)
    if data.body is not None:
        # A non-owner never received the ||...|| GM secrets (they're stripped
        # on read), so their submitted body has none — storing it verbatim
        # would delete the GM's hidden notes. Re-inject the stored secrets so
        # they outlive a player's edit. The owner submits the full body, secrets
        # and all, so nothing is merged for them.
        page.body = data.body if is_owner else merge_gm_secrets(page.body, data.body)
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
    if data.icon_color is not None:
        page.icon_color = data.icon_color or None

    if data.shared_user_ids is not None and is_owner:
        _apply_shares(db, page, data.shared_user_ids)
    # If no longer members-visibility, drop any stale shares.
    if page.visibility != "members":
        db.query(WikiPageShare).filter_by(page_id=page.id).delete()

    rebuild_links(db, c, page, current_user)
    db.commit()
    db.refresh(page)
    return _page_summary(page)


def delete_page(
    campaign_id: str, page_id: str, current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
    if not page:
        return
    # Owner deletes anything; a member may delete a page they authored.
    if c.owner_id != current_user.id and page.created_by_id != current_user.id:
        raise HTTPException(403, "Not authorised to delete this page")
    assert_not_archived(c)
    # Re-parent any children to this page's parent so subtrees aren't orphaned
    # (deleting a "category" page lifts its pages a level instead of nuking them).
    db.query(WikiPage).filter_by(campaign_id=campaign_id, parent_id=page_id).update(
        {WikiPage.parent_id: page.parent_id}, synchronize_session=False
    )
    # Pages that linked here need their link rows recomputed once this page is
    # gone — an unpinned [[Title]] may now resolve elsewhere (or become a stub on
    # their next save), and a pinned one goes broken. Collect them before the rows
    # are dropped.
    inbound_source_ids = [
        row.source_page_id
        for row in db.query(WikiPageLink).filter_by(target_page_id=page_id).all()
        if row.source_page_id != page_id
    ]
    # Drop link rows referencing this page from either side.
    db.query(WikiPageLink).filter(
        (WikiPageLink.source_page_id == page_id)
        | (WikiPageLink.target_page_id == page_id)
    ).delete(synchronize_session=False)
    db.delete(page)
    db.flush()
    # Re-resolve the referencing pages against the post-delete state. This only
    # rebuilds link rows; it deliberately does not auto-create stubs for the page
    # just deleted, since resolve/rebuild treats a now-missing target as broken
    # unless the link was unpinned (in which case recreating the page by that
    # title relinks it naturally).
    for src in (
        db.query(WikiPage).filter(WikiPage.id.in_(inbound_source_ids)).all()
        if inbound_source_ids
        else []
    ):
        _rebuild_link_rows(db, campaign_id, src)
    db.commit()


def search_pages(
    campaign_id: str,
    q: str = Query(..., min_length=1, max_length=200),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
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


def page_titles(
    campaign_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Page list backing the `[[link]]` autocomplete.

    Each entry carries the page id and its headings so the editor can offer both
    `[[Title]]` and `[[Title:#Heading]]` completions, plus `ambiguous` — true when
    another visible page shares this slug. The editor appends `:id-<id>` only for
    ambiguous titles, keeping ordinary links readable while still being able to
    address a colliding page at all (issue #287).

    GM-only spans are stripped from non-owners' bodies before headings are read,
    so a heading hidden inside `||...||` can't leak through the autocomplete.
    """
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    is_owner = c.owner_id == current_user.id
    pages = db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
    visible = [p for p in pages if can_view_page(p, c, current_user, db)]

    # A title is ambiguous when another visible page *normalizes* to the same slug
    # — the stored slugs differ ("ancient-ruins" vs "ancient-ruins-2"), so compare
    # on the title's own slug rather than the stored one.
    base_counts: dict[str, int] = {}
    for p in visible:
        key = slugify(p.title)
        base_counts[key] = base_counts.get(key, 0) + 1

    # Immediate parent's title, so the autocomplete can tell same-named pages
    # apart ("Ancient Ruins (Northlands)"). Resolved against the *visible* pages
    # only: a parent this user can't see must not leak through the suggestion
    # list, and reads as top-level instead.
    visible_titles = {p.id: p.title for p in visible}

    return [
        {
            "id": p.id,
            "title": p.title,
            "slug": p.slug,
            "ambiguous": base_counts.get(slugify(p.title), 0) > 1,
            "parent_title": visible_titles.get(p.parent_id) if p.parent_id else None,
            "headings": extract_headings(
                (p.body or "") if is_owner else strip_gm_secrets(p.body or "")
            ),
        }
        for p in visible
    ]
