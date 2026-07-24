"""Global library resource search for the campaign resource picker.

Searches books, maps, tokens, and audio across the whole library (not a single
campaign's linked resources — that's ``resources.py``). Used by the create wizard
and the "add resource" flow. Split out of ``core.py`` (issue #152).
"""

from fastapi import Depends, HTTPException
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Audio, Book, GenericMap, Token


def _resource_folder(relative_path: str) -> str:
    """Parent folder path of a media file, dropping the leading top-level dir and
    the filename — matches the frontend's MapsView.getFolderPath logic."""
    parts = (relative_path or "").replace("\\", "/").split("/")
    return "/".join(parts[1:-1])


def _book_folder(relative_path: str) -> str:
    """Nested folder path of a book *inside* its game system, as
    category/subcategory/sub-subcategory (arbitrary depth), dropping the leading
    ``books/<system>`` segments and the filename.

    A book sitting directly in the system dir has no folder and returns "".
    Path shape: books/<system>/<category>/.../<file> (see indexer.agnostic_category).
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    # parts[0]=books, parts[1]=system dir, parts[2:-1]=category/subcategory chain.
    return "/".join(parts[2:-1])


def _book_subtitle(system_name: str, relative_path: str, category: str) -> str:
    """Folder-tree path for a book: ``<System>/<category>/<subcategory>/…``.

    The game system is the top level so the picker groups books by system, then
    by their nested category folders. Falls back to the flat category when the
    book has no nested folders, and drops the system segment when unknown.
    """
    folder = _book_folder(relative_path) or (category or "")
    system = (system_name or "").strip()
    if system and folder:
        return f"{system}/{folder}"
    return system or folder


def search_resources_global(
    q: str = "",
    resource_type: str = None,
    system_id: str = None,
    limit: int = 30,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search across books, maps, tokens, and audio for the resource picker.

    Books match on title and can be narrowed by game system. Maps, tokens, and
    audio match on their folder path *first*, then filename, so a folder name like
    "Abyssal Fall (30x49)" surfaces every item inside it. Folder-path matches are
    ranked above filename-only matches.
    """
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot browse the library")
    results = []
    q_lower = q.lower()

    if not resource_type or resource_type == "book":
        from ...models import GameSystem

        # Map system id → name in one pass so each book's tree path can lead
        # with its system without a per-book relationship lookup.
        system_names = {s.id: s.name for s in db.query(GameSystem).all()}
        query = db.query(Book)
        if system_id:
            query = query.filter(Book.game_system_id == system_id)
        book_folder_hits, book_name_hits = [], []
        for b in query.order_by(Book.title).limit(500).all():
            # Tree path: <System>/<category>/<subcategory>/... so the picker
            # groups books by system first, then by their nested folders.
            folder = _book_subtitle(
                system_names.get(b.game_system_id, ""), b.relative_path, b.category
            )
            row = {
                "resource_type": "book",
                "resource_id": b.id,
                "name": b.title,
                "subtitle": folder,
                "has_thumbnail": b.has_thumbnail,
            }
            if not q:
                book_name_hits.append(row)
            elif q_lower in folder.lower():
                book_folder_hits.append(row)
            elif q_lower in (b.title or "").lower():
                book_name_hits.append(row)
        results.extend(book_folder_hits + book_name_hits)

    # Maps/tokens/audio: prefer folder-path matches, then filename matches.
    def _media_results(rtype, model):
        folder_hits, name_hits = [], []
        for item in db.query(model).order_by(model.filename).limit(1000).all():
            folder = _resource_folder(item.relative_path)
            # Audio has no thumbnail; use its artwork flag and prefer its title.
            if rtype == "audio":
                name = item.title or item.filename
                has_thumb = bool(item.has_artwork)
            else:
                name = item.filename
                has_thumb = item.has_thumbnail
            row = {
                "resource_type": rtype,
                "resource_id": item.id,
                "name": name,
                "subtitle": folder,
                "has_thumbnail": has_thumb,
            }
            if not q:
                name_hits.append(row)
            elif q_lower in folder.lower():
                folder_hits.append(row)
            elif q_lower in (name or "").lower():
                name_hits.append(row)
        return folder_hits + name_hits

    if not resource_type or resource_type == "map":
        results.extend(_media_results("map", GenericMap))

    if not resource_type or resource_type == "token":
        results.extend(_media_results("token", Token))

    if not resource_type or resource_type == "audio":
        results.extend(_media_results("audio", Audio))

    return results[:limit]


def suggested_resources(
    system_id: str,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Books belonging to a game system, for the create wizard's resource step.

    Core-category books are flagged `suggested` so the wizard can pre-select them;
    nothing else is suggested. Ordered with suggested (core) books first.
    """
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot browse the library")
    books = db.query(Book).filter_by(game_system_id=system_id).order_by(Book.title).all()
    out = [
        {
            "resource_type": "book",
            "resource_id": b.id,
            "name": b.title,
            "subtitle": b.category,
            "has_thumbnail": b.has_thumbnail,
            "suggested": b.category == "core",
        }
        for b in books
    ]
    out.sort(key=lambda r: (not r["suggested"], r["name"].lower()))
    return out
