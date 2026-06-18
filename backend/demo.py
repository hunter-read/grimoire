"""Demo-mode background task.

When ENABLE_DEMO_MODE is set, a background thread runs once per hour and, for
every non-admin (player/gm) account:

  * deletes all campaigns they own, and
  * clears the personal data they may have created elsewhere — bookmarks,
    per-session player notes, and session availability — including in
    campaigns owned by admins.

Admin-owned campaigns and admin personal data are never touched. This keeps a
public demo instance from accumulating content created by anonymous visitors.
"""

import threading
from typing import Optional

from sqlalchemy import bindparam, text

from .config import SessionLocal, logger

_INTERVAL_SECONDS = 3600.0

_thread: Optional[threading.Thread] = None
_stop_event = threading.Event()


def cleanup_demo_data() -> int:
    """Delete non-admin campaigns and reset non-admin personal data.

    Returns the number of campaigns removed.
    """
    from .models import Campaign, CampaignResource, User, WikiPage

    db = SessionLocal()
    try:
        non_admin_ids = [
            row[0] for row in db.query(User.id).filter(User.role != "admin").all()
        ]
        if not non_admin_ids:
            return 0

        campaigns = db.query(Campaign).filter(Campaign.owner_id.in_(non_admin_ids)).all()
        count = len(campaigns)
        campaign_ids = [c.id for c in campaigns]

        if campaign_ids:
            # The campaign's mapped "all, delete-orphan" cascades remove most child
            # rows, but a few intra-subtree FKs would block the cascade because the
            # ORM can't order them: clear those up front so the cascade runs cleanly.
            #
            #   * wiki_page_links has no mapped relationship at all, so its rows
            #     referencing a deleted wiki page are never cleaned up — delete them.
            #   * wiki_pages.parent_id (self-ref) and wiki_pages.category_id /
            #     campaign_resources.category_id point sideways at sibling rows that
            #     are also being deleted; null them so order no longer matters.
            db.query(WikiPage).filter(WikiPage.campaign_id.in_(campaign_ids)).update(
                {WikiPage.parent_id: None, WikiPage.category_id: None},
                synchronize_session=False,
            )
            db.query(CampaignResource).filter(
                CampaignResource.campaign_id.in_(campaign_ids)
            ).update({CampaignResource.category_id: None}, synchronize_session=False)
            db.query(Campaign).filter(Campaign.id.in_(campaign_ids)).update(
                {Campaign.parent_campaign_id: None}, synchronize_session=False
            )
            db.execute(
                text("DELETE FROM wiki_page_links WHERE campaign_id IN :ids").bindparams(
                    bindparam("ids", expanding=True)
                ),
                {"ids": campaign_ids},
            )

        # Personal data the user may have created in campaigns they don't own.
        # Done before staging the campaign deletes so the cascade below doesn't
        # also try to remove rows these raw statements already cleared.
        for uid in non_admin_ids:
            db.execute(
                text("DELETE FROM player_session_notes WHERE user_id = :uid"), {"uid": uid}
            )
            db.execute(
                text("DELETE FROM session_availability WHERE user_id = :uid"), {"uid": uid}
            )
            db.execute(text("DELETE FROM bookmarks WHERE user_id = :uid"), {"uid": uid})

        # Mapped "all, delete-orphan" cascades remove the campaigns' child rows.
        for campaign in campaigns:
            db.delete(campaign)

        db.commit()
        return count
    finally:
        db.close()


def _run() -> None:
    while not _stop_event.wait(_INTERVAL_SECONDS):
        logger.info("Demo-mode cleanup starting…")
        try:
            removed = cleanup_demo_data()
            logger.info(f"Demo-mode cleanup removed {removed} campaign(s).")
        except Exception as e:
            logger.error(f"Demo-mode cleanup error: {e}")


def start() -> None:
    """Start (or restart) the hourly demo cleanup thread."""
    global _thread
    stop()
    _stop_event.clear()
    _thread = threading.Thread(target=_run, daemon=True, name="grimoire-demo-cleanup")
    _thread.start()
    logger.info("Demo mode enabled: resetting non-admin data every hour.")


def stop() -> None:
    """Stop the demo cleanup thread if one is running."""
    global _thread
    _stop_event.set()
    if _thread and _thread.is_alive():
        _thread.join(timeout=5)
    _thread = None
    _stop_event.clear()
