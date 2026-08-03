"""Fetching game-system metadata from installed add-ons (issue #203).

These endpoints are deliberately **read-only**: they search a source and report
what it offers alongside what the system already has, but never write. The user
applies the fields they chose through the existing
``PATCH /api/systems/{id}``, so nothing can overwrite a value without an
explicit, user-driven request.
"""
from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, require_gm_or_admin
from ...config import get_db
from ...models import GameSystem
from .._metadata_lookup import fetch, list_sources, search
from ._schemas import MetadataFetch, MetadataSearch

TARGET = "game-system"


def _get_system(db: Session, system_id: str) -> GameSystem:
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if not system:
        raise HTTPException(404, "System not found")
    return system


def list_metadata_sources(
    system_id: str,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Add-ons currently able to supply metadata for game systems."""
    _get_system(db, system_id)
    return list_sources(db, TARGET)


def search_metadata(
    system_id: str,
    data: MetadataSearch,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Ranked candidates for this system from one source.

    An empty query defaults to the system's own name, which is what the user
    means the overwhelming majority of the time.
    """
    system = _get_system(db, system_id)
    return search(db, data.source_id, data.query, fallback=system.name)


def fetch_metadata(
    system_id: str,
    data: MetadataFetch,
    _: CurrentUser = Depends(require_gm_or_admin),  # noqa: ARG001
    db: Session = Depends(get_db),
):
    """Fetch one candidate's fields and diff them against the system.

    Writes nothing. The response drives the review step; applying is a separate,
    explicit PATCH.
    """
    system = _get_system(db, system_id)
    return fetch(
        db, system, "system", data.source_id, data.identity, data.query, data.paste
    )
