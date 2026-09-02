"""Deciding where a book belongs on disk, from its system and category.

The scanner infers a book's system and category *from* its folder path, so
writing those fields from the UI only sticks if the file moves to match. These
helpers answer "which folder should this book live in", reusing the scanner's
own inference so a relocation lands somewhere that infers back to the same
values — otherwise the next scan would silently undo the edit. Performing the
move is :func:`..moves.relocate_book_for_category`; this module only decides.
"""
import re
from pathlib import Path
from typing import Optional

from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.categories import (
    UNCATEGORIZED,
    agnostic_category,
    detect_container_kind,
    guess_category,
    is_special_collection_folder,
    slugify,
    strip_container_suffix,
    strip_sort_prefix,
)
from ...models.library import GameSystem
from .constants import SCAFFOLD_CATEGORY_FOLDERS
from .paths import library_root, to_relative

def _system_folder_name(raw_name: str) -> str:
    """The system name the scanner would derive from a folder name.

    Mirrors ``_resolve_system_folder``: peel the ``(nsfw)`` marker, the container
    suffix, then any sort prefix. Kept in step with the scanner so a moved book
    lands on the same system row a rescan would have given it.
    """

    name = re.sub(r"\s*\(nsfw\)\s*", "", raw_name, flags=re.IGNORECASE).strip()
    name, _ = strip_container_suffix(name)
    return strip_sort_prefix(name)


def _system_depth_for(db: Session, parts: list[str]) -> int:
    """How many path segments precede the category folder: 2, or 3 under a container.

    ``parts`` is the library-relative path split on "/", starting with ``books``.

    The folder at ``parts[1]`` is a *container* rather than a system when it is
    marked as one on disk — the same test the scanner applies (issue #395). The
    DB cannot answer this on its own: a container has its own ``GameSystem`` row
    whose ``parent_id`` is None, so asking whether the row at ``parts[1]`` has a
    parent says "no" for the container itself and yields depth 2, which is how a
    re-categorised book escaped its system folder and landed in the container
    root.

    The marker file is authoritative; the DB is a fallback for a container
    declared by a name suffix (``(parent-system)``), where the folder carries no
    marker but the nested system row does record a parent.
    """
    if len(parts) < 3:
        return 2
    container_dir = library_root() / parts[0] / parts[1]
    if detect_container_kind(container_dir, parts[1]):
        return 3
    # A suffix-declared container leaves no marker on disk. Its child systems do
    # carry ``parent_id``, so look the *nested* folder up directly — but only
    # believe it when that parent is the folder at ``parts[1]``. In a standard
    # layout ``parts[2]`` is the *category* folder, and a system elsewhere in the
    # library that happens to share its name ("Core") must not be mistaken for a
    # nested system here.
    nested = (
        db.query(GameSystem).filter(GameSystem.name == _system_folder_name(parts[2])).first()
    )
    parent_id = getattr(nested, "parent_id", None) if nested is not None else None
    if parent_id:
        parent = db.query(GameSystem).filter(GameSystem.id == parent_id).first()
        if parent is not None and parent.name == _system_folder_name(parts[1]):
            return 3
    return 2


def resolve_book_placement(db: Session, dest_file: Path) -> tuple[Optional[str], str]:
    """Return ``(game_system_id, category)`` for a book at ``dest_file``.

    A move across systems has to answer the same question the scanner answers
    during a walk, but without a walk: which system row owns this path, and what
    category does the folder structure imply? Both are re-derived from the
    destination path so the record matches what the next rescan would produce —
    if they disagreed, the rescan would silently rewrite the move.

    The system is matched by *name* against existing rows rather than created:
    creating systems is ``create_folder``'s job, and a move should never
    invent one as a side effect.
    """
    rel = to_relative(dest_file)
    parts = rel.split("/")
    # parts: books/<system>/[...]/<file>  — anything shorter has no system folder.
    if len(parts) < 3:
        return None, UNCATEGORIZED

    system_folder = parts[1]
    system_name = _system_folder_name(system_folder)
    system = (
        db.query(GameSystem).filter(GameSystem.name == system_name).first()
        or db.query(GameSystem).filter(GameSystem.slug == slugify(system_name)).first()
    )

    # A system nested one level inside a container folder shifts every
    # subsequent segment right by one; the scanner expresses that as
    # `system_depth`. Shared with ``_system_root_for`` so both agree on where the
    # category folder starts — asking whether the row at ``parts[1]`` has a
    # parent got this wrong for a marker-declared container, whose own row has
    # no parent (issue #395).
    depth = _system_depth_for(db, parts)
    if depth == 3:
        # The real system folder is the second segment inside the container.
        nested_name = _system_folder_name(parts[2])
        nested = (
            db.query(GameSystem).filter(GameSystem.name == nested_name).first()
            or db.query(GameSystem).filter(GameSystem.slug == slugify(nested_name)).first()
        )
        if nested is not None:
            system = nested

    if is_special_collection_folder(system_folder):
        return (system.id if system else None), agnostic_category(rel)
    return (system.id if system else None), guess_category(rel, system_depth=depth)


# The folder name to create for a canonical category that has no folder yet.
# Derived from SCAFFOLD_CATEGORY_FOLDERS so a category relocation and the
# scaffold button produce the same shelf rather than two spellings of it.
CATEGORY_FOLDER_NAMES = {
    guess_category(f"books/system/{name}/x.pdf"): name for name in SCAFFOLD_CATEGORY_FOLDERS
}


def _system_root_for(db: Session, book_path: Path) -> Optional[Path]:
    """The system folder a book sits under, or None when it is not in one.

    The category folder is a *child* of this, so relocating a book means finding
    this root first. Depth mirrors ``resolve_book_placement``: a system nested in
    a container folder pushes everything one segment right.
    """
    rel = to_relative(book_path)
    parts = rel.split("/")
    if len(parts) < 3:
        return None

    depth = _system_depth_for(db, parts)
    if len(parts) <= depth:
        return None
    return library_root().joinpath(*parts[:depth])


def category_folder_for(
    db: Session, book_path: Path, category: str, *, create: bool = True
) -> Optional[Path]:
    """The folder under a book's system that holds ``category``, creating it if asked.

    Matched on the *inferred category* of each existing child rather than on the
    folder's name, for the same reason ``scaffold_categories`` does: a user whose
    core books live in "Rulebooks" should have a re-categorised book join them,
    not gain a second "Core" folder splitting one category across two shelves.

    Returns None when there is no system folder to hang a category off, or when
    the folder is absent and ``create`` is False.
    """
    root = _system_root_for(db, book_path)
    if root is None or not root.is_dir():
        return None

    try:
        for child in sorted(root.iterdir(), key=lambda c: c.name.lower()):
            if not child.is_dir() or child.name.startswith("."):
                continue
            if guess_category(f"{to_relative(child)}/x.pdf") == category:
                return child
    except OSError as e:
        logger.warning("Could not read %s while resolving a category folder: %s", root, e)
        return None

    if not create:
        return None
    # No folder covers this category. Use the canonical spelling when the
    # category is one of the standard set; otherwise title-case the slug, which
    # is what the scanner would infer straight back to a custom category.
    name = CATEGORY_FOLDER_NAMES.get(category) or category.replace("-", " ").title()
    target = root / name
    try:
        target.mkdir(exist_ok=True)
    except OSError as e:
        logger.warning("Could not create category folder %s: %s", target, e)
        return None
    return target

