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
    """How many path segments precede the category folder.

    ``parts`` is the library-relative path split on "/", starting with ``books``.

    2 for the plain ``books/<system>/<category>/`` layout, and one more for every
    *container* stacked above the system: a family holding a parent-system
    holding editions puts the category folder at index 4 (issues #261/#262/#301).
    This mirrors ``_scan_container``, which recurses through containers with
    ``depth + 1`` and only reads categories in the first folder that is not one —
    so the walk has to continue past ``parts[1]`` rather than stopping there.
    Testing only that first folder capped the answer at 3, which is how a rename
    or move under two containers read the *system* folder as the category and
    reattached the book to the inner container (issue #413).

    A container declares itself by marker file or by name suffix; the DB is a
    fallback for the suffix form on rows written before the folder was read.
    """
    depth = 1
    # Walk down from books/ while each folder is a container. The first one that
    # is not is the system folder, and its children are the categories — so the
    # category folder sits at the index just past it.
    while depth + 1 < len(parts) and _is_container(db, parts, depth):
        depth += 1
    return max(depth + 1, 2)


def _is_container(db: Session, parts: list[str], depth: int) -> bool:
    """Whether the folder at ``parts[depth]`` holds systems rather than categories."""
    folder = library_root().joinpath(*parts[: depth + 1])
    # A name suffix (``(parent-system)``) is as authoritative as a marker file,
    # and unlike the marker it needs no disk read.
    _, suffix_kind = strip_container_suffix(parts[depth])
    if suffix_kind or detect_container_kind(folder, parts[depth]):
        return True
    # A suffix-declared container that has since been renamed leaves nothing on
    # disk. Its child systems do carry ``parent_id``, so look the *nested* folder
    # up — but only believe it when that parent is this folder. In a standard
    # layout the next segment is the *category* folder, and a system elsewhere in
    # the library that happens to share its name ("Core") must not be mistaken
    # for a nested system here.
    if depth + 1 >= len(parts):
        return False
    nested = (
        db.query(GameSystem)
        .filter(GameSystem.name == _system_folder_name(parts[depth + 1]))
        .first()
    )
    parent_id = getattr(nested, "parent_id", None) if nested is not None else None
    if not parent_id:
        return False
    parent = db.query(GameSystem).filter(GameSystem.id == parent_id).first()
    return parent is not None and parent.name == _system_folder_name(parts[depth])


def _container_child_slug(parts: list[str], depth: int) -> str:
    """The slug ``_register_system`` gives the system folder at ``parts[depth - 1]``.

    A container's children are slugged under it — ``_resolve_system_folder`` is
    handed ``slug_prefix=f"{container.slug}--"`` — and that nests, so an edition
    two containers down is ``family--parent--5e``. Rebuilding the chain from the
    path is what lets a nested system be found at all: its own folder name alone
    slugifies to something no row carries.
    """
    return "--".join(
        slugify(_system_folder_name(segment)) for segment in parts[1:depth]
    )


def _match_system(
    db: Session, folder_name: str, *, slug: str = ""
) -> Optional[GameSystem]:
    """The system row a books folder maps to, matched by slug then name.

    ``slug`` is the scanner's own namespaced slug for a container's child, and
    is tried first because it is the only identifier that survives everything
    the display name does not: ``_register_system`` names an edition
    "{container} {folder}", prettifies a one-page child, uniquifies a name
    collision with a suffix, and leaves a hand-renamed system alone forever
    after (``name_is_custom``). Matching on the bare folder name found none of
    those, so every renamed or moved book under a container silently fell back
    to the container row (issue #434).
    """
    if slug:
        row = db.query(GameSystem).filter(GameSystem.slug == slug).first()
        if row is not None:
            return row
    name = _system_folder_name(folder_name)
    return (
        db.query(GameSystem).filter(GameSystem.name == name).first()
        or db.query(GameSystem).filter(GameSystem.slug == slugify(name)).first()
    )


def resolve_book_placement(db: Session, dest_file: Path) -> tuple[Optional[str], str]:
    """Return ``(game_system_id, category)`` for a book at ``dest_file``.

    A move across systems has to answer the same question the scanner answers
    during a walk, but without a walk: which system row owns this path, and what
    category does the folder structure imply? Both are re-derived from the
    destination path so the record matches what the next rescan would produce —
    if they disagreed, the rescan would silently rewrite the move.

    The system is matched against existing rows rather than created: creating
    systems is ``create_folder``'s job, and a move should never invent one as a
    side effect. Under a container that match is made on the scanner's own
    namespaced slug, since a child's display name is derived rather than equal
    to its folder name (issue #434).
    """
    rel = to_relative(dest_file)
    parts = rel.split("/")
    # parts: books/<system>/[...]/<file>  — anything shorter has no system folder.
    if len(parts) < 3:
        return None, UNCATEGORIZED

    system_folder = parts[1]

    # Every container above the system shifts the subsequent segments right by
    # one; the scanner expresses that as `system_depth`. Shared with
    # ``_system_root_for`` so both agree on where the category folder starts —
    # asking whether the row at ``parts[1]`` has a parent got this wrong for a
    # marker-declared container, whose own row has no parent (issue #395).
    depth = _system_depth_for(db, parts)
    # The system folder is the last segment before the category folder, so it
    # walks right with the depth: `parts[1]` unnested, `parts[2]` inside one
    # container, `parts[3]` inside two (issue #413).
    system = _match_system(
        db,
        parts[depth - 1],
        slug=_container_child_slug(parts, depth) if depth > 2 else "",
    )
    if system is None and depth > 2:
        # An unregistered nested folder should still land on the container row
        # rather than orphaning the book, as it did before containers nested.
        system = _match_system(db, system_folder)

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

