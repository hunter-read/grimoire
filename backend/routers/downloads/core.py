"""Archive download endpoint handlers."""
from typing import Optional

from fastapi import Depends, HTTPException, Query
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...services import access_control
from ._helpers import (
    _archive_response,
    _can_see_explicit,
    _files_for_audio_folder,
    _files_for_book_folder,
    _files_for_library_folder,
    _files_for_map_folder,
    _files_for_system,
    _files_for_system_category,
    _files_for_model_folder,
    _files_for_tag,
    _files_for_tag_folder,
    _files_for_tag_type,
    _files_for_token_folder,
)


def download_archive(
    type: str = Query(
        ...,
        description=(
            "Scope: system | system_category | book_folder | map_folder | "
            "token_folder | audio_folder | model_folder | library_folder | "
            "tag | tag_type | tag_folder"
        ),
    ),
    fmt: str = Query("zip", description="Archive format: zip | tar | tar.gz | tar.bz2"),
    id: Optional[str] = Query(
        None, description="System ID (system / system_category / book_folder)"
    ),
    category: Optional[str] = Query(None, description="Book category slug (system_category)"),
    tag: Optional[str] = Query(
        None, description="Tag internal key (tag / tag_type / tag_folder)"
    ),
    resource_type: Optional[str] = Query(
        None,
        description=(
            "Resource type to scope a tag archive to: book | map | token | audio | "
            "model (tag_type / tag_folder)"
        ),
    ),
    folder: Optional[str] = Query(
        None,
        description=(
            "Folder path (book_folder / map_folder / token_folder / audio_folder / model_folder / "
            "library_folder — the latter is library-root-relative)"
        ),
    ),
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    see_explicit = _can_see_explicit(db, current_user.id)
    # Bulk archives are the easiest way to walk out with a restricted book, so
    # every book-bearing builder is handed the user and filters accordingly.
    user = access_control.load_user(db, current_user)

    if type == "system":
        if not id:
            raise HTTPException(400, "id is required for type=system")
        files, base = _files_for_system(db, id, see_explicit, user)

    elif type == "system_category":
        if not id:
            raise HTTPException(400, "id is required for type=system_category")
        if not category:
            raise HTTPException(400, "category is required for type=system_category")
        files, base = _files_for_system_category(db, id, category, see_explicit, user)

    elif type == "book_folder":
        if not id:
            raise HTTPException(400, "id is required for type=book_folder")
        if not folder:
            raise HTTPException(400, "folder is required for type=book_folder")
        files, base = _files_for_book_folder(db, id, folder, see_explicit, user)

    elif type == "map_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=map_folder")
        files, base = _files_for_map_folder(db, folder)

    elif type == "token_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=token_folder")
        files, base = _files_for_token_folder(db, folder, see_explicit)

    elif type == "model_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=model_folder")
        files, base = _files_for_model_folder(db, folder, see_explicit)

    elif type == "audio_folder":
        if not folder:
            raise HTTPException(400, "folder is required for type=audio_folder")
        files, base = _files_for_audio_folder(db, folder)

    elif type == "tag":
        # The whole tag, every type at once — the tag browser's top level.
        if not tag:
            raise HTTPException(400, "tag is required for type=tag")
        files, base = _files_for_tag(db, tag, see_explicit, user)

    elif type == "tag_type":
        # One type's section within a tag.
        if not tag:
            raise HTTPException(400, "tag is required for type=tag_type")
        if not resource_type:
            raise HTTPException(400, "resource_type is required for type=tag_type")
        files, base = _files_for_tag_type(db, tag, resource_type, see_explicit, user)

    elif type == "tag_folder":
        # One tagged folder's group inside a type section.
        if not tag:
            raise HTTPException(400, "tag is required for type=tag_folder")
        if not resource_type:
            raise HTTPException(400, "resource_type is required for type=tag_folder")
        if not folder:
            raise HTTPException(400, "folder is required for type=tag_folder")
        files, base = _files_for_tag_folder(
            db, tag, resource_type, folder, see_explicit, user
        )

    elif type == "library_folder":
        # The file manager's scope: an arbitrary folder taken as it sits on
        # disk, including files the scanner never indexed. Nothing here is
        # filtered by book visibility because nothing here is resolved through a
        # book row, so it is restricted to admins — the same audience the file
        # manager itself is restricted to.
        if current_user.role != "admin":
            raise HTTPException(403, "Admin access required")
        if not folder:
            raise HTTPException(400, "folder is required for type=library_folder")
        files, base = _files_for_library_folder(folder)

    else:
        raise HTTPException(400, f"Unknown type: {type!r}")

    return _archive_response(files, base, fmt)

