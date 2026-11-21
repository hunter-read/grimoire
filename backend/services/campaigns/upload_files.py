"""A campaign's uploads on disk, and removing them once their rows are gone.

Everything a campaign stores lives under ``DATA_PATH/campaign_uploads/``:

* ``banners/`` - its banner (``Campaign.banner_path``) and the smaller copy
  served by default, ``<campaign id>_sm.webp``;
* ``files/`` - its campaign files (``CampaignFile.stored_path``): uploads,
  images embedded in notes or shown on map pages, and the copies kept of
  deleted library maps;
* ``art/``, ``tokens/``, ``sheets/`` - each member's character art, token and
  sheet (``CampaignMember.character_*_path``), and in ``tokens/`` the owner's
  own token (``Campaign.owner_token_path``).

The rows naming these files go with a campaign or a membership, so the paths are
collected first and the files removed once the session commits - never on a
rollback, which must leave everyone their files. See ``routers/campaigns`` for
the handlers that write them.
"""

import os
from typing import Iterable

from sqlalchemy import event
from sqlalchemy.orm import Session

from ...config import CAMPAIGN_UPLOAD_DIR, logger
from ...models import Campaign, CampaignFile, CampaignMember

BANNER_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "banners")
FILES_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "files")
ART_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "art")
TOKEN_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "tokens")
SHEET_DIR = os.path.join(CAMPAIGN_UPLOAD_DIR, "sheets")


def _under(directory: str, name: str | None) -> list[str]:
    # Stored names are bare file names; basename keeps a bad one inside its folder.
    base = os.path.basename(name or "")
    return [os.path.join(directory, base)] if base else []


def sheet_upload_paths(member: CampaignMember) -> list[str]:
    """The uploaded character sheet this membership holds, if any."""
    return _under(SHEET_DIR, member.character_sheet_path)


def member_upload_paths(members: Iterable[CampaignMember]) -> list[str]:
    """The art, token and sheet files these memberships hold."""
    paths: list[str] = []
    for m in members:
        paths += _under(ART_DIR, m.character_art_path)
        paths += _under(TOKEN_DIR, m.character_token_path)
        paths += sheet_upload_paths(m)
    return paths


def campaign_upload_paths(db: Session, campaign_ids: list[str]) -> list[str]:
    """Every file these campaigns hold on disk: banners, files and member uploads."""
    if not campaign_ids:
        return []
    paths: list[str] = []
    for c in db.query(Campaign).filter(Campaign.id.in_(campaign_ids)).all():
        paths += _under(BANNER_DIR, c.banner_path)
        paths += _under(BANNER_DIR, f"{c.id}_sm.webp")
        paths += _under(TOKEN_DIR, c.owner_token_path)
    for (stored,) in (
        db.query(CampaignFile.stored_path).filter(CampaignFile.campaign_id.in_(campaign_ids)).all()
    ):
        paths += _under(FILES_DIR, stored)
    paths += member_upload_paths(
        db.query(CampaignMember).filter(CampaignMember.campaign_id.in_(campaign_ids)).all()
    )
    return paths


def _remove(path: str) -> None:
    try:
        os.remove(path)
    except FileNotFoundError:
        pass
    except OSError as e:
        # The rows are gone either way; a file left behind is logged so it can
        # be removed by hand.
        logger.warning("Failed to remove campaign upload %s: %s", path, e)


def remove_after_commit(db: Session, paths: Iterable[str]) -> None:
    """Remove these files once ``db`` commits, and never otherwise.

    The caller deletes the rows naming them and commits later; a delete that
    rolls back keeps its files.
    """
    pending = [p for p in paths if p]
    if not pending:
        return
    settled = False

    def _committed(session: Session) -> None:
        nonlocal settled
        if settled:
            return
        settled = True
        for path in pending:
            _remove(path)

    def _rolled_back(session: Session) -> None:
        nonlocal settled
        settled = True

    event.listen(db, "after_commit", _committed, once=True)
    event.listen(db, "after_rollback", _rolled_back, once=True)
