"""Archive download endpoint handlers."""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ._helpers import (
    _archive_response,
    _can_see_explicit,
    _files_for_audio_folder,
    _files_for_book_folder,
    _files_for_map_folder,
    _files_for_system,
    _files_for_system_category,
    _files_for_token_folder,
)


def download_archive(
    type: str = Query(
        ...,
        description="Scope: system | system_category | book_folder | map_folder | token_folder | audio_folder",
    ),
    fmt: str = Query("zip", description="Archive format: zip | tar | tar.gz | tar.bz2"),
    id: Optional[str] = Query(
        None, description="System ID (system / system_category / book_folder)"
    ),
    category: Optional[str] = Query(None, description="Book category slug (system_category)"),
    folder: Optional[str] = Query(
        None, description="Folder path (book_folder / map_folder / token_folder / audio_folder)"
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    see_explicit = _can_see_explicit(db, current_user.id)

    if type == "system":
        if not id:
            raise HTTPException(400, "id is required for type=system")
        files, base = _files_for_system(db, id, see_explicit)

    elif type == "system_category":
        if not id:
            raise HTTPException(400, "id is required for type=system_category")
        if not category:
            raise HTTPException(400, "category is required for type=system_category")
        files, base = _files_for_system_category(db, id, category, see_explicit)

    elif type == "book_folder":
        if not id:
            raise HTTPException(400, "id is required for type=book_folder")
        if not folder:
            raise HTTPException(400, "folder is required for type=book_folder")
        files, base = _files_for_book_folder(db, id, folder, see_explicit)

    elif type == "map_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=map_folder")
        files, base = _files_for_map_folder(db, folder)

    elif type == "token_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=token_folder")
        files, base = _files_for_token_folder(db, folder, see_explicit)

    elif type == "audio_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=audio_folder")
        files, base = _files_for_audio_folder(db, folder)

    else:
        raise HTTPException(400, f"Unknown type: {type!r}")

    return _archive_response(files, base, fmt)

