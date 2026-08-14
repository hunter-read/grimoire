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
from ...models import User, WikiPage, WikiPageHidden, WikiPageLink, WikiPageShare
from ._helpers import (
    assert_not_archived,
    can_view,
    escape_player_pipes,
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
    "hide_page",
    "unhide_page",
    "search_pages",
    "page_titles",
]


def parse_page_link_titles(body: str) -> list:
    """Return the distinct page-title targets referenced by [[...]] in body.

    Kept as a thin title-only view over `parse_page_links` for callers (and tests)
    that only care about which titles a body mentions.
    """
    return [link.title for link in parse_page_links(body)]


def _share_for(db, page: WikiPage, user_id: str):
    """The share row granting `user_id` access to `page`, if any."""
    return db.query(WikiPageShare).filter_by(page_id=page.id, user_id=user_id).first()


def can_view_page(page: WikiPage, campaign, user: CurrentUser, db) -> bool:
    """Who may read a page.

    The author always can. Beyond that, visibility decides:

    - ``group`` ("Public")  — every campaign viewer.
    - ``members`` ("Private") — the users the author shared it with.
    - ``gm`` ("author only") — nobody else, *including the campaign owner*.

    That last one is the change from the original model, where ``gm`` meant "the
    campaign owner" rather than "the author" and so the GM read every page in the
    campaign. It is now symmetric: a GM's own notes are labelled "GM only" and a
    player's are labelled "Self only", but both mean the same thing — only the
    person who wrote it. A GM who wants to read a player's note needs it shared
    with them (issue #232).
    """
    # Every path below still requires campaign access; the author of a page in a
    # campaign they were since removed from doesn't keep a back door to it.
    if not can_view(campaign, user, db):
        return False
    if page.created_by_id == user.id:
        return True
    if page.visibility == "group":
        return True
    if page.visibility == "members":
        return _share_for(db, page, user.id) is not None
    return False  # gm / self-only, and this user isn't the author


def can_edit_page(page: WikiPage, campaign, user: CurrentUser, db) -> bool:
    """Who may edit a page's content and metadata.

    The author always can. A ``group`` page is editable by every campaign viewer,
    which is what makes a shared party knowledge base work (issue #233). A
    ``members`` page is editable by the users the author granted *write* to —
    write implies read, so a write share is also a view share. Campaign ownership
    alone grants nothing here: the GM cannot edit a player's page unless the
    player shared write access with them.
    """
    if not can_view(campaign, user, db):
        return False
    if page.created_by_id == user.id:
        return True
    if page.visibility == "group":
        return True
    if page.visibility == "members":
        share = _share_for(db, page, user.id)
        return share is not None and bool(share.can_write)
    return False


def can_delete_page(page: WikiPage, user: CurrentUser) -> bool:
    """Only the author may delete a page.

    Deliberately narrower than editing: a player must not be able to delete a
    GM's page just because it is public and therefore editable, and the GM must
    not be able to delete a player's page either. Anyone who merely wants it out
    of their way can hide it instead.
    """
    return page.created_by_id == user.id


def is_page_hidden(db, page_id: str, user_id: str) -> bool:
    return (
        db.query(WikiPageHidden).filter_by(page_id=page_id, user_id=user_id).first()
        is not None
    )


def hidden_page_ids(db, campaign_id: str, user_id: str, campaign=None) -> set:
    """Ids this user has hidden, expanded to include every descendant.

    Hiding a parent hides its subtree. That is resolved here rather than stored
    per descendant, so moving a page out of a hidden subtree un-hides it and a
    page created under a hidden parent is hidden from the start.

    Given a `campaign`, a personal one always resolves to nothing hidden: the
    feature does not exist there and `hide_page` refuses. Rows can still be on
    disk from before that guard, or from when the campaign was a group one, and
    honouring them would drop pages from the list with no UI able to bring them
    back. Applied here rather than at each caller so no read path can forget it.
    """
    if campaign is not None and not campaign.is_gm_campaign:
        return set()
    rows = (
        db.query(WikiPageHidden.page_id)
        .join(WikiPage, WikiPage.id == WikiPageHidden.page_id)
        .filter(WikiPage.campaign_id == campaign_id, WikiPageHidden.user_id == user_id)
        .all()
    )
    roots = {r[0] for r in rows}
    if not roots:
        return roots

    children: dict = {}
    for pid, parent_id in (
        db.query(WikiPage.id, WikiPage.parent_id)
        .filter(WikiPage.campaign_id == campaign_id)
        .all()
    ):
        if parent_id:
            children.setdefault(parent_id, []).append(pid)

    out = set(roots)
    stack = list(roots)
    while stack:
        for child in children.get(stack.pop(), []):
            if child not in out:
                out.add(child)
                stack.append(child)
    return out


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


def _resolve_parent(
    db, campaign_id: str, parent_id, page_id: str = None, campaign=None, user=None
):
    """Validate a parent-page id for this campaign. Empty string moves to root.

    Returns the resolved id (or None), raising 400 if the parent is unknown, in a
    different campaign, the page itself, or one of its own descendants (which would
    create a cycle).

    When `campaign` and `user` are supplied, also enforces that the user may
    *write* the parent: a page must not be nested under one the user only reads,
    which would otherwise let anyone graft children onto someone else's private
    page (issue #232). An unreadable parent is reported as "invalid" rather than
    "forbidden" so the response doesn't confirm that a hidden page exists.
    """
    if parent_id in (None, ""):
        return None
    parent = (
        db.query(WikiPage).filter_by(id=parent_id, campaign_id=campaign_id).first()
    )
    if not parent:
        raise HTTPException(400, "Invalid parent page")
    if campaign is not None and user is not None:
        if not can_view_page(parent, campaign, user, db):
            raise HTTPException(400, "Invalid parent page")
        if not can_edit_page(parent, campaign, user, db):
            raise HTTPException(403, "Not authorised to add pages under this page")
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
    mine: bool = Query(False, description="Only pages this user authored"),
    include_hidden: bool = Query(False, description="Include pages this user hid"),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    pages = db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
    visible = [p for p in pages if can_view_page(p, c, current_user, db)]
    if mine:
        visible = [p for p in visible if p.created_by_id == current_user.id]
    hidden = hidden_page_ids(db, campaign_id, current_user.id, campaign=c)
    if not include_hidden:
        visible = [p for p in visible if p.id not in hidden]
    # Manual order first; fall back to title for pages never reordered.
    visible.sort(key=lambda p: (p.sort_order or 0, (p.title or "").lower()))
    return [
        {
            **_page_summary(p),
            "can_edit": can_edit_page(p, c, current_user, db),
            "can_delete": can_delete_page(p, current_user),
            "is_hidden": p.id in hidden,
            "is_mine": p.created_by_id == current_user.id,
        }
        for p in visible
    ]


def reorder_pages(
    campaign_id: str,
    data: WikiReorder,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Apply a new manual order, expressed relative to what this user can see.

    ``sort_order`` is global but a user only ever sees a subset of the campaign's
    pages, so their submitted list cannot be written as absolute positions —
    doing that would renumber pages they can't see and shuffle the wiki for
    everyone else. Instead we treat the submission as an ordering *of the slots
    the movable pages already occupy*: collect those pages' current sort_order
    values, then redeal them in the requested order. Every other page — invisible
    to this user, or visible but not writable by them — keeps the exact
    sort_order it had, so its position relative to the untouched pages is
    preserved.

    A user needs write access to move a page (issue #232): a page they may read
    but not edit is skipped and holds its slot.
    """
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    assert_not_archived(c)

    by_id = {
        p.id: p for p in db.query(WikiPage).filter_by(campaign_id=campaign_id).all()
    }
    # The pages this user actually may move, in the order they asked for.
    # Duplicates and unknown/forbidden ids are dropped rather than rejected, so a
    # stale client list still applies as far as it legitimately can.
    seen: set = set()
    movable = []
    for pid in data.ordered_ids:
        p = by_id.get(pid)
        if (
            p is not None
            and p.id not in seen
            and can_view_page(p, c, current_user, db)
            and can_edit_page(p, c, current_user, db)
        ):
            seen.add(p.id)
            movable.append(p)

    # The slots those pages hold today, redealt in the requested order: the same
    # set of positions comes back out, just assigned to different pages, so every
    # page outside `movable` keeps its position relative to them.
    #
    # The stored values are not necessarily distinct — pages start life at
    # sort_order 0 and only diverge once something reorders them — and identical
    # slots cannot express an ordering. So we deal *ranks* over the occupied
    # range rather than the raw values: take the lowest slot as the base and
    # number upward from it. Where the slots were already distinct this
    # reproduces them exactly; where they collided it separates them without
    # reaching past the range those pages already covered.
    slots = sorted(p.sort_order or 0 for p in movable)
    previous = None
    for slot, p in zip(slots, movable):
        # Walk the sorted slots in step with the requested order, forcing each
        # one strictly above the last. Distinct slots pass through untouched
        # (gaps included, so pages this user can't see that sat between them stay
        # between them); a run of equal ones fans out into consecutive values.
        p.sort_order = slot if previous is None or slot > previous else previous + 1
        previous = p.sort_order

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

    # Authorship decides who may *classify* a page (see update_page). It
    # deliberately does not decide who sees ||secrets||, which are the GM's
    # alone — see is_gm below.
    is_author = page.created_by_id == current_user.id
    # ||...|| spans are GM-only: a device for hiding text from players inside an
    # otherwise shared page, so it is keyed on campaign ownership and nothing
    # else. A player authoring a page does not get to keep secrets in it — not
    # from the GM, and not from the other players.
    is_gm = c.owner_id == current_user.id
    all_users = {u.id: u for u in db.query(User).all()}
    author = all_users.get(page.created_by_id)

    # Backlinks: other pages that link here, filtered to what the viewer can see.
    backlink_rows = db.query(WikiPageLink).filter_by(target_page_id=page.id).all()
    backlinks = []
    for row in backlink_rows:
        src = db.query(WikiPage).filter_by(id=row.source_page_id).first()
        if src and can_view_page(src, c, current_user, db):
            backlinks.append(_page_summary(src))

    # Share lists are the author's to see and set; to anyone else they'd leak who
    # else holds access to a page they merely read.
    shares = (
        db.query(WikiPageShare).filter_by(page_id=page.id).all()
        if page.visibility == "members" and is_author
        else []
    )

    return {
        "id": page.id,
        "campaign_id": campaign_id,
        "title": page.title,
        "slug": page.slug,
        # ||...|| spans are GM-only. The GM gets the raw body; everyone else
        # gets it fully stripped — no secret text and no marker, so a player
        # never learns a secret exists or where. A later save re-weaves the
        # stored secrets back by position (merge_gm_secrets). (Personal
        # campaigns only ever have the owner as a viewer, so nothing is
        # stripped.)
        "body": page.body if is_gm else strip_gm_secrets(page.body),
        "visibility": page.visibility,
        "page_type": page.page_type,
        "session_date": page.session_date,
        "parent_id": page.parent_id,
        "icon": page.icon,
        "icon_color": page.icon_color,
        "created_by_id": page.created_by_id,
        "created_by_name": (author.display_name or author.username) if author else None,
        "can_edit": can_edit_page(page, c, current_user, db),
        "can_delete": can_delete_page(page, current_user),
        "is_mine": is_author,
        # Matches the list endpoint: a personal campaign never reports a page as
        # hidden, whatever rows are on disk.
        "is_hidden": c.is_gm_campaign and is_page_hidden(db, page.id, current_user.id),
        "shared_user_ids": [s.user_id for s in shares],
        "shared_write_user_ids": [s.user_id for s in shares if s.can_write],
        "backlinks": backlinks,
        "updated_at": page.updated_at.isoformat() if page.updated_at else None,
    }


def _apply_shares(db, page: WikiPage, user_ids, write_user_ids=None) -> None:
    """Replace a page's share rows.

    `user_ids` is the read set and `write_user_ids` the subset that also gets
    write. Granting write implies read, so a user named only in the write list is
    still given a row — the caller doesn't have to list them twice.

    The author is never given a share row: their access comes from authorship and
    a row would just be a second source of truth to keep consistent.
    """
    db.query(WikiPageShare).filter_by(page_id=page.id).delete()
    if page.visibility != "members":
        return
    writers = set(write_user_ids or [])
    for uid in set(user_ids or []) | writers:
        if uid == page.created_by_id:
            continue
        db.add(WikiPageShare(page_id=page.id, user_id=uid, can_write=uid in writers))


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

    # Every visibility is open to every member now: a player can keep a self-only
    # note or share one with named people exactly as the GM can (issue #232).
    # What the levels *mean* is per-author, so no owner check is needed here.
    visibility = data.visibility or "gm"
    if visibility not in ("gm", "group", "members"):
        raise HTTPException(400, "Invalid visibility")
    # A personal campaign has exactly one viewer, so the levels are meaningless
    # there and the UI hides them entirely. Everything is stored as "gm"
    # (author-only) rather than trusting whatever a client sent, so the column
    # can't hold a value the owner has no control to see or undo. Converting the
    # campaign to a group one later leaves these pages private to the GM, which
    # is the safe direction.
    if not c.is_gm_campaign:
        visibility = "gm"

    title = (data.title or "").strip() or "Untitled"
    slug = _ensure_unique_slug(db, campaign_id, slugify(title))
    if data.session_date:
        try:
            datetime.date.fromisoformat(data.session_date)
        except ValueError:
            raise HTTPException(400, "session_date must be YYYY-MM-DD")

    parent_id = _resolve_parent(
        db, campaign_id, data.parent_id, campaign=c, user=current_user
    )

    # ||pipes|| a player typed become literal text, exactly as on update: the
    # secret mechanism is the GM's, and a player must never store one — least of
    # all on a page whose next read would then hide it from them. There is no
    # merge step here because a brand-new page has no stored secrets yet.
    body = data.body or ""
    if c.owner_id != current_user.id:
        body = escape_player_pipes(body)

    page = WikiPage(
        campaign_id=campaign_id,
        title=title,
        slug=slug,
        body=body,
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
    # The author sets their own share list, whoever they are.
    _apply_shares(db, page, data.shared_user_ids, data.shared_write_user_ids)
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
    if not can_edit_page(page, c, current_user, db):
        raise HTTPException(403, "Not authorised to edit this page")
    assert_not_archived(c)

    # Who may *classify* the page is narrower than who may edit its text: only
    # the author moves it between visibility levels or changes who it is shared
    # with. Otherwise anyone with write access to a public page could reclassify
    # it as their own self-only note and take it away from everyone else.
    is_author = page.created_by_id == current_user.id
    # Separate from authorship: ||secrets|| are the GM's regardless of who wrote
    # the page they sit in.
    is_gm = c.owner_id == current_user.id

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
        if is_gm:
            page.body = data.body
        else:
            # Two things happen to a player's submission, in this order.
            #
            # First, any ||pipes|| *they* typed are escaped to literal text. The
            # editor only offers the secret button to the GM, but a player can
            # still type the characters, and honouring them would store a real
            # secret that the next read strips from its own author's view —
            # they'd write a sentence, save, and watch it disappear.
            #
            # Then the GM's stored secrets are re-woven in. A player never
            # received those (they're stripped on read), so their body has none
            # and storing it verbatim would delete the GM's hidden notes. This
            # matters far more now that a public page is editable by the whole
            # group (issue #233): any player may be the one saving over a
            # GM-authored page. Escaping first is what keeps the two apart — by
            # the time secrets are re-inserted, the only ||...|| spans in the
            # body are the GM's own.
            page.body = merge_gm_secrets(page.body, escape_player_pipes(data.body))
    # Personal campaigns have no visibility levels at all (see create_page), so a
    # change is ignored rather than rejected: the client has no control to have
    # sent it from, and a 400 would only turn a harmless no-op into an error.
    if (
        data.visibility is not None
        and data.visibility != page.visibility
        and c.is_gm_campaign
    ):
        if data.visibility not in ("gm", "group", "members"):
            raise HTTPException(400, "Invalid visibility")
        if not is_author:
            raise HTTPException(403, "Only the page's author can change its visibility")
        page.visibility = data.visibility
    if data.session_date is not None:
        page.session_date = data.session_date or None
    if data.page_type is not None and data.page_type in ("note", "session"):
        page.page_type = data.page_type
    if data.parent_id is not None:
        page.parent_id = _resolve_parent(
            db,
            campaign_id,
            data.parent_id,
            page_id=page.id,
            campaign=c,
            user=current_user,
        )
    if data.icon is not None:
        page.icon = data.icon or None
    if data.icon_color is not None:
        page.icon_color = data.icon_color or None

    if (data.shared_user_ids is not None or data.shared_write_user_ids is not None):
        if not is_author:
            raise HTTPException(403, "Only the page's author can change its sharing")
        # Either list alone is a full replacement of the pair, so fall back to
        # what's stored for whichever one the client didn't send.
        existing = db.query(WikiPageShare).filter_by(page_id=page.id).all()
        reads = (
            data.shared_user_ids
            if data.shared_user_ids is not None
            else [s.user_id for s in existing]
        )
        writes = (
            data.shared_write_user_ids
            if data.shared_write_user_ids is not None
            else [s.user_id for s in existing if s.can_write]
        )
        _apply_shares(db, page, reads, writes)
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
    # Deletion is the author's alone — not the campaign owner's, and not every
    # member's just because the page is publicly editable (issue #232). Anyone
    # else who wants it gone from their view hides it instead.
    if not can_delete_page(page, current_user):
        raise HTTPException(403, "Not authorised to delete this page")
    assert_not_archived(c)
    # Drop per-user hidden rows for this page; nothing else references it once
    # the link rows below are gone.
    db.query(WikiPageHidden).filter_by(page_id=page_id).delete()
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


def hide_page(
    campaign_id: str,
    page_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Hide a page from this user's own view.

    Per-user decluttering, so it is available on any page the user can see —
    including one they cannot edit or delete, which is the whole point: a player
    facing fifty GM pages can put the ones they don't need away without touching
    anybody else's wiki. Hiding a parent hides its subtree (resolved on read, see
    `hidden_page_ids`), so only the row for the page the user clicked is stored.

    Deliberately not gated on `assert_not_archived`: hiding writes nothing to the
    campaign's content, and an archived campaign is still one you might want to
    tidy.

    Refused in a personal campaign, where the feature has no premise: the only
    notes to hide are your own, and deleting already covers those. The UI offers
    no control there, so this is closing the API behind it rather than a rule a
    user could trip over.
    """
    c = get_campaign_or_404(db, campaign_id)
    page = db.query(WikiPage).filter_by(id=page_id, campaign_id=campaign_id).first()
    if not page:
        raise HTTPException(404, "Page not found")
    if not can_view_page(page, c, current_user, db):
        raise HTTPException(403, "Not authorised to view this page")
    if not c.is_gm_campaign:
        raise HTTPException(409, "Personal campaigns do not support hidden pages")
    if not is_page_hidden(db, page_id, current_user.id):
        db.add(WikiPageHidden(page_id=page_id, user_id=current_user.id))
        db.commit()
    return {"ok": True, "hidden": True}


def unhide_page(
    campaign_id: str,
    page_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Restore a page this user had hidden.

    Only clears the user's own row. A page hidden because an ancestor is hidden
    has no row of its own, so un-hiding it individually is a no-op — the ancestor
    is what has to come back.

    Unlike `hide_page`, this is *not* refused in a personal campaign. Rows can
    predate the campaign becoming personal or the guard existing at all, and
    refusing here would strand them: the page would stay hidden with nothing in
    the UI or API able to bring it back. Clearing state is always safe.
    """
    get_campaign_or_404(db, campaign_id)
    db.query(WikiPageHidden).filter_by(page_id=page_id, user_id=current_user.id).delete()
    db.commit()
    return {"ok": True, "hidden": False}


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
    is_gm = c.owner_id == current_user.id
    hidden = hidden_page_ids(db, campaign_id, current_user.id, campaign=c)
    results = []
    for p in pages:
        if not can_view_page(p, c, current_user, db):
            continue
        if p.id in hidden:
            continue
        # Hide ||...|| spans from players: search and snippet over the stripped
        # body so a secret can't leak via a body-only match.
        body = p.body or "" if is_gm else strip_gm_secrets(p.body or "")
        if (
            not is_gm
            and q.lower() not in (p.title or "").lower()
            and q.lower() not in body.lower()
        ):
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

    GM-only spans are stripped from players' bodies before headings are read, so
    a heading hidden inside `||...||` can't leak through the autocomplete.
    """
    c = get_campaign_or_404(db, campaign_id)
    if not can_view(c, current_user, db):
        raise HTTPException(403, "Not a member of this campaign")
    is_gm = c.owner_id == current_user.id
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
                (p.body or "") if is_gm else strip_gm_secrets(p.body or "")
            ),
        }
        for p in visible
    ]
