"""Backups package — admin-only database + user-asset snapshots (issue #338)."""
from fastapi import APIRouter

from ._schemas import BackupItem, BackupListResponse, BackupSettingsResponse
from .core import (
    create_backup,
    delete_backup,
    download_backup,
    get_backup_settings,
    list_backups,
    update_backup_settings,
)

router = APIRouter(prefix="/backups", tags=["backups"])

router.add_api_route(
    "",
    list_backups,
    methods=["GET"],
    summary="List backups, newest first",
    response_model=BackupListResponse,
)
router.add_api_route(
    "",
    create_backup,
    methods=["POST"],
    summary="Create a backup now",
    response_model=BackupItem,
)
router.add_api_route(
    "/settings",
    get_backup_settings,
    methods=["GET"],
    summary="Read backup schedule and retention settings",
    response_model=BackupSettingsResponse,
)
router.add_api_route(
    "/settings",
    update_backup_settings,
    methods=["PUT"],
    summary="Configure backup schedule and retention",
    response_model=BackupSettingsResponse,
)
router.add_api_route(
    "/{backup_id}/download",
    download_backup,
    methods=["GET"],
    summary="Download a backup archive",
)
router.add_api_route(
    "/{backup_id}",
    delete_backup,
    methods=["DELETE"],
    summary="Delete a backup archive",
    status_code=204,
)

__all__ = ["router"]
