"""Global library resource search for the campaign resource picker.

Searches books, maps, tokens, and audio across the whole library (not a single
campaign's linked resources — that's ``resources.py``). Used by the create wizard
and the "add resource" flow. Split out of ``core.py`` (issue #152).
"""

from typing import Optional

from fastapi import Depends, HTTPException
from sqlalchemy import ColumnElement, and_, or_
from sqlalchemy.orm import Session

from ...auth import CurrentUser, get_current_user
from ...config import get_db
from ...models import Audio, Book, GameSystem, GenericMap, Token
from ...services import access_control, book_links, tag_service, variants
from ...services.systems import path_without_hidden_system

# Hard ceiling on how many rows one search may return per resource type. The
# picker browses a whole collection as a folder tree, so this has to be large
# enough to hold a real library rather than a preview slice — the old 500/1000
# caps silently truncated to the alphabetically-first items and made everything
# past them unreachable, even by search.
MAX_LIMIT = 20000
DEFAULT_LIMIT = 5000


def _escape_like(term: str) -> str:
    """Escape LIKE wildcards so a literal % or _ in a query doesn't match everything."""
    return term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


def _system_id_filter(db: Session, system_id: str) -> list[str]:
    """Expand a system id to itself plus its children, for container folders.

    A container ("Dungeons & Dragons", "One-Page RPGs") holds no books directly —
    they all belong to its child systems. Scoping a campaign's book search to a
    container therefore has to include those children, or it matches nothing
    (issues #261/#262).
    """
    child_ids = [
        row[0] for row in db.query(GameSystem.id).filter(GameSystem.parent_id == system_id).all()
    ]
    return [system_id, *child_ids]


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


def _hidden_system_path(relative_path: str, depth: int) -> str:
    """What is left of a book's path once its hidden system's folders are cut:
    the category chain and the filename, with no leading collection dir.

    This is the only part of the path the picker may show for such a book, or
    match a search against - the system's folder, and any container above it,
    name what the reader cannot see.
    """
    shown = path_without_hidden_system(relative_path, depth)
    parts = (shown or "").replace("\\", "/").split("/")
    return "/".join(parts[1:]) if len(parts) >= 3 else parts[-1]


def _book_subtitle(system_name: str, folder: str, category: str) -> str:
    """Folder-tree path for a book: ``<System>/<category>/<subcategory>/…``.

    The game system is the top level so the picker groups books by system, then
    by their nested category folders. Falls back to the flat category when the
    book has no nested folders, and drops the system segment when unknown.
    """
    folder = folder or (category or "")
    system = (system_name or "").strip()
    if system and folder:
        return f"{system}/{folder}"
    return system or folder


def search_resources_global(
    q: str = "",
    resource_type: Optional[str] = None,
    system_id: Optional[str] = None,
    limit: int = DEFAULT_LIMIT,
    current_user: CurrentUser = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """Search across books, maps, tokens, and audio for the resource picker.

    Books match on title and can be narrowed by game system. Maps, tokens, and
    audio match on their folder path *first*, then filename, so a folder name like
    "Abyssal Fall (30x49)" surfaces every item inside it. Folder-path matches are
    ranked above filename-only matches.

    Matching happens in SQL so the query runs against the whole library. It used
    to filter in Python over a ``.limit()``-ed slice, which meant only the
    alphabetically-first 500 books / 1000 media rows were ever considered and
    anything past that was invisible even to an exact-name search.

    ``limit`` is applied per resource type, so asking for several types does not
    make each one's share smaller.
    """
    if current_user.role == "guest":
        raise HTTPException(403, "Guests cannot browse the library")
    results = []
    q = (q or "").strip()
    q_lower = q.lower()
    per_type = max(1, min(limit, MAX_LIMIT))
    like = f"%{_escape_like(q)}%" if q else None

    if not resource_type or resource_type == "book":
        access_user = access_control.load_user(db, current_user)
        # Map system id → name in one pass so each book's tree path can lead
        # with its system without a per-book relationship lookup. Only systems
        # the user can see, so a subtitle never names one they cannot.
        system_names = {
            s.id: s.name
            for s in access_control.visible_systems(
                db, db.query(GameSystem.id, GameSystem.name), access_user
            ).all()
        }
        # You link the main entry, not one of its variants: a picker listing the
        # same book five times is noise, and the variants travel with the parent.
        query = access_control.visible_books(
            db, variants.parents_only(db.query(Book), Book), access_user
        )
        if system_id:
            # Books linked onto those shelves too (issue #446).
            query = query.filter(book_links.on_any_shelf(_system_id_filter(db, system_id)))
        # A book can be open inside a system its reader cannot see. Its path
        # still runs through that system's folder, so for those books the path
        # is cut down to the part below it before it is shown or searched.
        hidden_ids = [
            sid for (sid,) in db.query(GameSystem.id).all() if sid not in system_names
        ]
        depths = tag_service.system_category_depths(db) if hidden_ids else {}

        def _hidden_path(system_id: Optional[str], relative_path: str) -> Optional[str]:
            if system_id is None or system_id in system_names:
                return None
            return _hidden_system_path(relative_path, depths.get(system_id, 2))

        if like is not None:
            # A book's tree path is built from its system name, relative path and
            # category, so match any of those to keep folder search working.
            system_hits = [
                sid for sid, name in system_names.items() if q_lower in (name or "").lower()
            ]
            path_match = Book.relative_path.ilike(like, escape="\\")
            conditions: list[ColumnElement[bool]] = [
                Book.title.ilike(like, escape="\\"),
                Book.category.ilike(like, escape="\\"),
            ]
            if hidden_ids:
                in_hidden = Book.game_system_id.in_(hidden_ids)
                conditions.append(and_(path_match, or_(Book.game_system_id.is_(None), ~in_hidden)))
                # The cut cannot be expressed in SQL, so narrow to the paths that
                # match at all and keep those that still match once cut.
                candidates = access_control.visible_books(
                    db,
                    db.query(Book.id, Book.game_system_id, Book.relative_path).filter(
                        in_hidden, path_match
                    ),
                    access_user,
                ).all()
                path_hits = [
                    bid
                    for bid, sid, path in candidates
                    if q_lower in (_hidden_path(sid, path) or "").lower()
                ]
                if path_hits:
                    conditions.append(Book.id.in_(path_hits))
            else:
                conditions.append(path_match)
            if system_hits:
                conditions.append(Book.game_system_id.in_(system_hits))
            query = query.filter(or_(*conditions))
        book_folder_hits, book_name_hits = [], []
        for b in query.order_by(Book.title).limit(per_type).all():
            # Tree path: <System>/<category>/<subcategory>/... so the picker
            # groups books by system first, then by their nested folders.
            hidden_path = _hidden_path(b.game_system_id, b.relative_path)
            if hidden_path is None:
                book_folder = _book_folder(b.relative_path)
            else:
                book_folder = "/".join(hidden_path.split("/")[:-1])
            folder = _book_subtitle(
                system_names.get(b.game_system_id, ""), book_folder, b.category
            )
            row = {
                "resource_type": "book",
                "resource_id": b.id,
                "name": b.title,
                "subtitle": folder,
                "has_thumbnail": b.has_thumbnail,
            }
            # SQL already narrowed to matches; this only ranks folder hits above
            # title-only hits, preserving the picker's ordering contract.
            if q and q_lower in folder.lower():
                book_folder_hits.append(row)
            else:
                book_name_hits.append(row)
        results.extend(book_folder_hits + book_name_hits)

    def _attach_variants(rtype, model, rows):
        """Hang each row's other versions off it, in one query for the page.

        The search returns main versions only — a campaign linking a map wants
        one entry per map, not one per cut of it. But a picker that *composes*
        with the file, rather than linking to it, needs the choice: the token
        editor frames a specific image, and the black-and-white cut of a portrait
        is a different token from the colour one.

        Attached rather than flattened into the results so the shape stays the
        same for every existing caller: the campaign picker ignores the field and
        behaves exactly as before.
        """
        ids = [r["resource_id"] for r in rows]
        if not ids:
            return rows
        children = {}
        for item in (
            db.query(model)
            .filter(model.variant_parent_id.in_(ids))
            .order_by(model.variant_kind, model.variant_label, model.filename)
            .all()
        ):
            children.setdefault(item.variant_parent_id, []).append(
                {
                    "resource_type": rtype,
                    "resource_id": item.id,
                    "name": (item.title or item.filename) if rtype == "audio" else item.filename,
                    "has_thumbnail": bool(
                        item.has_artwork if rtype == "audio" else item.has_thumbnail
                    ),
                    "variant_kind": item.variant_kind or "",
                    "variant_label": item.variant_label or "",
                }
            )
        for row in rows:
            row["variants"] = children.get(row["resource_id"], [])
        return rows

    # Maps/tokens/audio: prefer folder-path matches, then filename matches.
    def _media_results(rtype, model):
        query = variants.parents_only(db.query(model), model)
        if like is not None:
            conditions = [
                model.filename.ilike(like, escape="\\"),
                model.relative_path.ilike(like, escape="\\"),
            ]
            # Audio displays its tag title, so that has to be searchable too.
            if rtype == "audio":
                conditions.append(model.title.ilike(like, escape="\\"))
            query = query.filter(or_(*conditions))
        folder_hits, name_hits = [], []
        for item in query.order_by(model.filename).limit(per_type).all():
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
                # The main version's own description, for the version chooser
                # to name it instead of "Main version" (issue #556).
                "variant_kind": item.variant_kind or "",
                "variant_label": item.variant_label or "",
            }
            if q and q_lower in folder.lower():
                folder_hits.append(row)
            else:
                name_hits.append(row)
        return _attach_variants(rtype, model, folder_hits + name_hits)

    if not resource_type or resource_type == "map":
        results.extend(_media_results("map", GenericMap))

    if not resource_type or resource_type == "token":
        results.extend(_media_results("token", Token))

    if not resource_type or resource_type == "audio":
        results.extend(_media_results("audio", Audio))

    return results


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
    access_user = access_control.load_user(db, current_user)
    system = db.query(GameSystem).filter_by(id=system_id).first()
    if system is None or not access_control.can_access_system(db, access_user, system):
        return []
    books = access_control.visible_books(
        db,
        variants.parents_only(db.query(Book).filter(book_links.on_shelf(system_id)), Book),
        access_user,
    ).order_by(Book.title).all()
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
