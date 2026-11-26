"""A campaign's upload limits, and how much of its storage it has used.

The admin bounds campaign uploads in **Settings → App**: uploads on or off, a
per-file cap and a per-campaign total. The total covers every ``CampaignFile``
a campaign holds - files and images uploaded to it, tokens filed as resources,
and the copies it keeps of deleted library maps - and the source art the token
editor keeps for any of its tokens (``token_recipes``), a member's or the
owner's included. Every path that writes one checks it here
(``routers/campaigns/uploads.py``, ``token_recipes.py``, ``owner_token.py`` and
``map_copies.py``). Admins are exempt; the callers decide that, as they do for
the other two limits.
"""

import os

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import Campaign, CampaignFile, CampaignMember
from ..app_settings import get_raw
from .token_recipes import PendingRecipe, source_paths

_MB = 1024 * 1024


def upload_limits(db: Session) -> tuple[bool, int, int]:
    """``(disabled, max_file_bytes, max_total_bytes)``; 0 bytes means unlimited."""
    raw = get_raw(db)
    disabled = raw.get("campaign_uploads_disabled") == "true"
    max_file = int(raw.get("campaign_upload_max_file_mb") or 0) * _MB
    max_total = int(raw.get("campaign_upload_max_total_mb") or 0) * _MB
    return disabled, max_file, max_total


def campaign_source_bytes(db: Session, campaign_id: str) -> int:
    """The bytes of token editor source art a campaign's tokens keep on disk.

    Read from the files themselves, as a recipe does not record its art's size.
    """
    queries = (
        db.query(CampaignFile.token_recipe).filter(CampaignFile.campaign_id == campaign_id),
        db.query(CampaignMember.character_token_recipe).filter(
            CampaignMember.campaign_id == campaign_id
        ),
        db.query(Campaign.owner_token_recipe).filter(Campaign.id == campaign_id),
    )
    recipes = [recipe for query in queries for (recipe,) in query]
    total = 0
    for recipe in recipes:
        for path in source_paths(recipe):
            try:
                total += os.path.getsize(path)
            except OSError:
                pass  # art that has gone takes no room
    return total


def campaign_upload_bytes(db: Session, campaign_id: str) -> int:
    """The bytes a campaign's uploads take up: its files and its tokens' source art."""
    files = (
        db.query(func.coalesce(func.sum(CampaignFile.size_bytes), 0))
        .filter(CampaignFile.campaign_id == campaign_id)
        .scalar()
    )
    return int(files or 0) + campaign_source_bytes(db, campaign_id)


def assert_within_campaign_quota(
    db: Session, campaign_id: str, adding: int, replacing: int = 0
) -> None:
    """413 when storing ``adding`` bytes would take a campaign past its total.

    ``replacing`` is the size of a file the new one takes the place of, so only
    the difference counts. A write that does not grow the campaign is always
    let through, even in a campaign already over a limit the admin has since
    lowered: refusing it would only stop the GM making room.
    """
    _, _, max_total = upload_limits(db)
    growth = adding - replacing
    if not max_total or growth <= 0:
        return
    if campaign_upload_bytes(db, campaign_id) + growth > max_total:
        raise HTTPException(413, "Campaign upload storage limit reached")


def assert_token_upload_allowed(
    db: Session,
    campaign_id: str,
    pending: PendingRecipe,
    adding: int = 0,
    replacing: int = 0,
) -> None:
    """Apply the campaign upload limits to a token upload's kept source art.

    The uploads-off switch (403) and the per-file cap (413) apply to the art
    itself; the campaign total counts it with the token's own picture, when
    that is a campaign file (``adding``/``replacing``, as for
    ``assert_within_campaign_quota``). Art the token already keeps is replaced,
    so only the growth counts. Callers skip this for admins.
    """
    disabled, max_file, _ = upload_limits(db)
    if pending.adding:
        if disabled:
            raise HTTPException(403, "Campaign file uploads are disabled by the administrator")
        if max_file and pending.adding > max_file:
            raise HTTPException(413, "Source art exceeds the per-file size limit")
    assert_within_campaign_quota(
        db, campaign_id, adding + pending.adding, replacing=replacing + pending.replacing
    )
