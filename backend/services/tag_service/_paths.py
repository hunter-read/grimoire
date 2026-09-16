"""Tag path/depth helpers: where a book sits in the library tree.

Split out of the former single-module ``tag_service`` (issue #235). These are
pure path arithmetic plus the per-system category-depth lookups that the folder
tag code needs to decide which folders a book belongs to.
"""
from __future__ import annotations

from typing import Optional

from sqlalchemy.orm import Session

from ...models import GameSystem


def system_category_depth(db: Session, system_id: Optional[str]) -> int:
    """Index of the category dir within a book's path segments, for one system.

    ``books/{System}/{categoryDir}/…`` puts the category at index 2. Every
    container folder the system sits inside shifts it one deeper —
    ``books/{Container}/{System}/{categoryDir}/…`` is 3 — and containers may
    nest arbitrarily (issue #301), so the depth is ``2 + <ancestor count>``
    rather than a flag on ``parent_id``.

    Mirrors the indexer's ``system_depth`` (``2 + depth`` in ``scan.py``) and the
    frontend's ``categoryDepth``. Prefer ``system_category_depths`` when
    resolving many books at once — this walks the chain with a query per level.
    """
    depth = 2
    seen: set[str] = set()
    current = system_id
    while current and current not in seen:
        seen.add(current)
        parent = db.query(GameSystem.parent_id).filter(GameSystem.id == current).scalar()
        if not parent:
            break
        depth += 1
        current = parent
    return depth


def system_category_depths(db: Session) -> dict[str, int]:
    """``{system_id: category depth}`` for every system, in one query.

    The tag resolvers walk every book in the library, so they need the depth of
    each book's system without a query per book. Cycles (which the schema does
    not prevent) stop the walk rather than hang it.
    """
    parents: dict[str, Optional[str]] = {
        sid: pid for sid, pid in db.query(GameSystem.id, GameSystem.parent_id).all()
    }
    depths: dict[str, int] = {}
    for sid in parents:
        depth = 2
        seen: set[str] = {sid}
        current = parents.get(sid)
        while current and current in parents and current not in seen:
            seen.add(current)
            depth += 1
            current = parents.get(current)
        depths[sid] = depth
    return depths


def _book_subfolder_segments(relative_path: str, depth: int = 2) -> list[str]:
    """The subfolder segments of a book path, i.e. the parts after the category
    dir and before the filename.

    ``relative_path`` is ``books/{SystemName}/{categoryDir}/<a>/<b>/<file>``; the
    subfolder segments are ``[a, b]`` (empty when the book sits directly in the
    category dir).

    ``depth`` is the index of the category dir (see ``system_category_depth``);
    pass the book's system's depth so a system inside a container folder doesn't
    count its own folder as the category dir (issue #357).
    """
    parts = (relative_path or "").replace("\\", "/").split("/")
    return parts[depth + 1 : -1]


def _book_folder_ancestor_paths(
    system_id: str, category: str, relative_path: str, depth: int = 2
) -> set[str]:
    """Every ``BookFolder.path`` a book belongs to.

    For subfolder segments ``[a, b]`` the book belongs to
    ``{system_id}/{category}/a`` and ``{system_id}/{category}/a/b``. Books with no
    subfolder (directly in the category dir) belong to no book folder.
    """
    segs = _book_subfolder_segments(relative_path, depth)
    prefix = f"{system_id}/{category}"
    return {prefix + "/" + "/".join(segs[: i + 1]) for i in range(len(segs))}


def _book_folder_display(path: str) -> str:
    """Display casing for a book folder: its last path segment (the folder name)."""
    return path.rstrip("/").split("/")[-1] if path else path
