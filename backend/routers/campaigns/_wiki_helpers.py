"""Wiki page helpers: permissions, link rebuilding, and slug resolution.

Split out of ``wiki.py`` (which was 980 lines) so the endpoint handlers there
read as handlers. This module holds the logic they lean on: who may view, edit,
or delete a page; which pages a user has hidden; and the `[[Page Title]]` link
graph that is rebuilt on every save. See ``wikilinks.py`` for the target grammar.
"""

from fastapi import HTTPException
from ...auth import CurrentUser
from ...models import WikiPage, WikiPageHidden, WikiPageLink, WikiPageShare
from ._helpers import can_view
from .wikilinks import (
    LINK_RE,
    LinkTarget,
    build_target,
    is_embed,
    parse_page_links,
    parse_target,
    slugify,
)


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
