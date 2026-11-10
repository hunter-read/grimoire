"""Folder access rules: restrict every book beneath a library folder (issue #772). Admin only.

Thin by design - matching and the cascade live in ``services/folder_access`` and
``services/access_control``, so every list, search and by-id route honours what
these endpoints configure. This module validates, maps errors to status codes,
and keeps campaign shares in step.
"""
from fastapi import Depends, HTTPException, Query
from sqlalchemy import func, or_
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_admin
from ...config import get_db
from ...models import Book, CampaignResource, FolderAccessRule, LeagueResource
from ...models.access import RESTRICTED_LEVELS
from ...models.leagues import VISIBILITY_ORGANIZER
from ...services import folder_access
from ...services import library_fs as fs
from ...sql_paths import path_under
from ._schemas import FolderAccessRuleIn


def _bad(e: Exception) -> HTTPException:
    return HTTPException(status_code=400, detail=str(e))


def _folder_exists(path: str) -> bool:
    try:
        return fs.safe_join(path, must_exist=True).is_dir()
    except fs.LibraryFSError:
        return False


def _books_under(path: str):
    return path_under(Book.relative_path, path + "/")


def _rule_out(db: Session, row: FolderAccessRule) -> dict:
    books = db.query(func.count(Book.id)).filter(_books_under(row.path)).scalar() or 0
    return {
        "path": row.path,
        "level": row.level,
        "exists": _folder_exists(row.path),
        "books": books,
    }


def _demote_campaign_shares(db: Session, path: str) -> int:
    """Force campaign shares of the books a new rule restricts down to GM-only,
    and league shares to organiser-only.

    The same step a restricted book or system takes (``enforce_campaign_visibility``),
    done in one pass for the whole folder. A book with an explicit open level is
    the one exception the rule does not reach, so its shares are left alone.
    """
    restricted = (
        db.query(Book.id)
        .filter(
            _books_under(path),
            or_(Book.access_level.is_(None), Book.access_level.in_(RESTRICTED_LEVELS)),
        )
        .scalar_subquery()
    )
    rows = (
        db.query(CampaignResource)
        .filter(
            CampaignResource.resource_type == "book",
            CampaignResource.resource_id.in_(restricted),
            CampaignResource.visibility != "gm",
        )
        .all()
    )
    for row in rows:
        row.visibility = "gm"
    leagues = (
        db.query(LeagueResource)
        .filter(
            LeagueResource.resource_type == "book",
            LeagueResource.resource_id.in_(restricted),
            LeagueResource.visibility != VISIBILITY_ORGANIZER,
        )
        .all()
    )
    for league_row in leagues:
        league_row.visibility = VISIBILITY_ORGANIZER
    return len(rows) + len(leagues)


def list_folder_access_rules(
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Every folder with an access restriction."""
    rows = db.query(FolderAccessRule).order_by(FolderAccessRule.path).all()
    return {"rules": [_rule_out(db, r) for r in rows]}


def save_folder_access_rule(
    data: FolderAccessRuleIn,
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Restrict a folder, replacing any level it had."""
    try:
        path, level = folder_access.validate(data.path, data.level)
    except folder_access.FolderAccessError as e:
        raise _bad(e) from e
    if not _folder_exists(path):
        raise HTTPException(404, "That folder does not exist.")

    row = db.query(FolderAccessRule).filter_by(path=path).first()
    if row is None:
        row = FolderAccessRule(path=path, level=level)
        db.add(row)
    else:
        row.level = level
    _demote_campaign_shares(db, path)
    db.commit()
    return _rule_out(db, row)


def delete_folder_access_rule(
    path: str = Query(..., max_length=1000),
    _: CurrentUser = Depends(require_admin),
    db: Session = Depends(get_db),
):
    """Lift a folder's restriction. Campaign shares demoted by it stay GM-only."""
    try:
        clean = folder_access.normalise_path(path)
    except folder_access.FolderAccessError as e:
        raise _bad(e) from e
    deleted = db.query(FolderAccessRule).filter_by(path=clean).delete()
    db.commit()
    if not deleted:
        raise HTTPException(404, "That folder has no access restriction.")
    return {"status": "ok"}
