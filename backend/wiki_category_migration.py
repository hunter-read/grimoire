"""One-time migration of flat note-categories into the nested page model.

The wiki used to group pages with a flat `CampaignCategory` (kind="note"); pages
referenced one via `WikiPage.category_id`. Nesting replaced that: a page can now
have a `parent_id`, so a "category" is just a parent page whose children nest
under it.

For each note-category we create a parent `WikiPage` (empty body, group-visible),
reparent every page that referenced the category under it, and delete the
category. Pages keep their `category_id` cleared so a second run finds nothing.

Resource categories (kind="resource") are untouched — resources still group by
the flat category system.

Safe to run on every startup: once no note-categories remain it does nothing.
"""

from .config import logger
from .routers.campaigns.wikilinks import slugify


def _unique_slug(db, WikiPage, campaign_id: str, base: str) -> str:
    slug = base
    n = 2
    while db.query(WikiPage).filter_by(campaign_id=campaign_id, slug=slug).first() is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def migrate(db) -> None:
    from .models import CampaignCategory, WikiPage

    note_cats = db.query(CampaignCategory).filter_by(kind="note").all()
    if not note_cats:
        return

    created = 0
    for cat in note_cats:
        pages = (
            db.query(WikiPage)
            .filter_by(campaign_id=cat.campaign_id, category_id=cat.id)
            .all()
        )
        # The owner is the natural author for a synthesized container page.
        owner_id = cat.campaign.owner_id if cat.campaign else None
        parent = WikiPage(
            campaign_id=cat.campaign_id,
            title=cat.name,
            slug=_unique_slug(db, WikiPage, cat.campaign_id, slugify(cat.name)),
            body="",
            visibility="group",
            page_type="note",
            icon=cat.icon,
            sort_order=cat.sort_order or 0,
            created_by_id=owner_id,
        )
        db.add(parent)
        db.flush()
        created += 1

        for p in pages:
            p.parent_id = parent.id
            p.category_id = None

        db.delete(cat)

    db.commit()
    logger.info(
        f"Wiki category migration: converted {created} note-category(ies) into parent pages."
    )
