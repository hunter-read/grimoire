"""One-time migration of legacy session notes into the new wiki page model.

For each legacy SessionNote we roll any non-empty content into wiki pages:
  - GM internal content  -> a `gm` page
  - GM external content   -> a `group` page
  - each player's note    -> a `group` page authored by that player

Sessions whose notes are all empty are purged. Migrated SessionNote rows are
deleted afterward, which also makes this safe to run on every startup (a second
run finds nothing left to migrate).
"""

import re

from .config import logger


def _slugify(title: str) -> str:
    s = re.sub(r"[^\w\s-]", "", (title or "").lower()).strip()
    s = re.sub(r"[\s_-]+", "-", s)
    return s or "untitled"


def _unique_slug(db, WikiPage, campaign_id: str, base: str) -> str:
    slug = base
    n = 2
    while db.query(WikiPage).filter_by(campaign_id=campaign_id, slug=slug).first() is not None:
        slug = f"{base}-{n}"
        n += 1
    return slug


def migrate(db) -> None:
    from .models import (
        CampaignCategory,
        GMSessionNote,
        PlayerSessionNote,
        SessionNote,
        User,
        WikiPage,
    )

    sessions = db.query(SessionNote).all()
    if not sessions:
        return

    user_names = {u.id: (u.display_name or u.username) for u in db.query(User).all()}
    created = 0
    purged = 0
    # Lazily-created "Session Notes" note-category per campaign.
    session_category = {}

    def _session_category_id(campaign_id):
        if campaign_id in session_category:
            return session_category[campaign_id]
        existing = (
            db.query(CampaignCategory)
            .filter_by(campaign_id=campaign_id, kind="note", name="Session Notes")
            .first()
        )
        if existing is None:
            existing = CampaignCategory(
                campaign_id=campaign_id, kind="note", name="Session Notes", sort_order=0
            )
            db.add(existing)
            db.flush()
        session_category[campaign_id] = existing.id
        return existing.id

    def _title_for(session, suffix=None):
        base = session.title.strip() if session.title else ""
        if not base:
            base = f"Session {session.session_date}" if session.session_date else "Session"
        return f"{base} - {suffix}" if suffix else base

    def _add_page(campaign_id, title, body, visibility, created_by_id, session_date):
        nonlocal created
        slug = _unique_slug(db, WikiPage, campaign_id, _slugify(title))
        db.add(
            WikiPage(
                campaign_id=campaign_id,
                title=title,
                slug=slug,
                body=body,
                visibility=visibility,
                page_type="session",
                session_date=session_date,
                created_by_id=created_by_id,
                category_id=_session_category_id(campaign_id),
            )
        )
        created += 1

    for s in sessions:
        gm_note = db.query(GMSessionNote).filter_by(session_id=s.id).first()
        player_notes = db.query(PlayerSessionNote).filter_by(session_id=s.id).all()

        owner_id = s.campaign.owner_id if s.campaign else None

        if gm_note and (gm_note.internal_content or "").strip():
            _add_page(
                s.campaign_id,
                _title_for(s, "GM Notes"),
                gm_note.internal_content,
                "gm",
                owner_id,
                s.session_date,
            )
        if gm_note and (gm_note.external_content or "").strip():
            _add_page(
                s.campaign_id,
                _title_for(s),
                gm_note.external_content,
                "group",
                owner_id,
                s.session_date,
            )
        for pn in player_notes:
            if (pn.content or "").strip():
                author = user_names.get(pn.user_id, "Player")
                _add_page(
                    s.campaign_id,
                    _title_for(s, f"{author}'s Notes"),
                    pn.content,
                    "group",
                    pn.user_id,
                    s.session_date,
                )

        # Whether or not it had content, the legacy session is now consumed.
        db.delete(s)
        purged += 1

    db.commit()
    logger.info(
        f"Wiki migration: rolled {created} page(s) from {purged} legacy session note(s)."
    )
