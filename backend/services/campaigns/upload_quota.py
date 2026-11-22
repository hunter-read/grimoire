"""A campaign's upload limits, and how much of its storage it has used.

The admin bounds campaign uploads in **Settings → App**: uploads on or off, a
per-file cap and a per-campaign total. The total covers every ``CampaignFile``
a campaign holds - files and images uploaded to it, tokens filed as resources,
and the copies it keeps of deleted library maps - so every path that writes one
checks it here (``routers/campaigns/uploads.py``, ``token_recipes.py`` and
``map_copies.py``). Admins are exempt; the callers decide that, as they do for
the other two limits.
"""

from fastapi import HTTPException
from sqlalchemy import func
from sqlalchemy.orm import Session

from ...models import CampaignFile
from ..app_settings import get_raw

_MB = 1024 * 1024


def upload_limits(db: Session) -> tuple[bool, int, int]:
    """``(disabled, max_file_bytes, max_total_bytes)``; 0 bytes means unlimited."""
    raw = get_raw(db)
    disabled = raw.get("campaign_uploads_disabled") == "true"
    max_file = int(raw.get("campaign_upload_max_file_mb") or 0) * _MB
    max_total = int(raw.get("campaign_upload_max_total_mb") or 0) * _MB
    return disabled, max_file, max_total


def campaign_upload_bytes(db: Session, campaign_id: str) -> int:
    """The bytes a campaign's files take up, summed by the database."""
    total = (
        db.query(func.coalesce(func.sum(CampaignFile.size_bytes), 0))
        .filter(CampaignFile.campaign_id == campaign_id)
        .scalar()
    )
    return int(total or 0)


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
