"""Creating folders, setting container markers, and scaffolding categories.

Folder *structure* is what the scanner reads meaning from, so these operations
are the ones that change how a library is interpreted. The singleton container
kinds (a library may hold only one of each) are enforced here before anything
touches the disk, and ``scaffold_categories`` deliberately creates plural,
human-readable folder names that each infer back to their canonical category
slug — so a user gets folders that read well in a file browser *and* classify
correctly on the next scan.
"""
from pathlib import Path
from typing import Any, Optional

from sqlalchemy.orm import Session

from ...config import logger
from ...indexer.categories import (
    detect_container_kind,
    guess_category,
    is_one_page_folder,
    is_system_agnostic_folder,
    slugify,
    strip_container_suffix,
)
from ...indexer.constants import (
    CONTAINER_AGNOSTIC,
    CONTAINER_MARKERS,
    CONTAINER_ONE_PAGE,
    FRAMES_MARKER,
    NSFW_MARKER,
    SINGLETON_CONTAINER_KINDS,
)
from ...models.library import GameSystem
from .constants import SCAFFOLD_CATEGORY_FOLDERS, LibraryFSError
from .paths import (
    assert_writable,
    collection_of,
    library_root,
    safe_join,
    to_relative,
)
from .placement import _system_folder_name

def create_folder(
    parent: str,
    name: str,
    *,
    container_kind: str = "",
    nsfw: bool = False,
    frames_container: bool = False,
) -> dict:
    """Create a folder, optionally declaring it a container, frame folder, and/or NSFW.

    The marker files are the point. Container and NSFW conventions are currently
    documented rather than enforced, so a user has to recall the exact filename
    (``.parent-system-container``, ``.nsfw``) and create it by hand in another
    tool. Writing them here means the folder *is* what the user asked for the
    moment it exists, and the next scan interprets it correctly with no further
    steps.
    """
    parent_dir = safe_join(parent, must_exist=True)
    if not parent_dir.is_dir():
        raise LibraryFSError("Parent is not a folder", code="invalid")
    assert_writable(parent_dir)

    clean = (name or "").strip()
    if not clean or clean in (".", ".."):
        raise LibraryFSError("Name is empty", code="invalid")
    if "/" in clean or "\\" in clean or "\x00" in clean:
        raise LibraryFSError("Name cannot contain a path separator", code="invalid")

    if container_kind and container_kind not in CONTAINER_MARKERS:
        raise LibraryFSError(f"Unknown container kind: {container_kind}", code="invalid")
    target = parent_dir / clean
    if container_kind:
        _assert_singleton_free(container_kind, None)
        # Checked against where the folder *will* sit, not the parent: a new
        # child of `books/` is a system slot and may be a container, while a new
        # child of a system folder is a category and may not.
        if not accepts_container_kind(target):
            raise LibraryFSError(
                "Container kinds only apply to folders that hold game systems — "
                "inside books/, at a depth where a system folder belongs.",
                code="invalid",
            )
    if frames_container and not accepts_frames_marker(target):
        raise LibraryFSError(
            "Frame folders are read from the token library — create this folder "
            "anywhere under tokens/.",
            code="invalid",
        )

    if target.exists():
        raise LibraryFSError(f"'{clean}' already exists", code="conflict")

    try:
        target.mkdir(parents=False)
    except OSError as e:
        if getattr(e, "errno", None) == 30:
            raise LibraryFSError(
                "The library is mounted read-only, so it cannot be modified.",
                code="read_only",
            ) from e
        raise LibraryFSError(f"Could not create folder: {e}", code="io_error") from e

    markers = []
    if container_kind:
        markers.append(CONTAINER_MARKERS[container_kind])
    if nsfw:
        markers.append(NSFW_MARKER)
    if frames_container:
        markers.append(FRAMES_MARKER)
    for marker in markers:
        try:
            (target / marker).touch()
        except OSError as e:
            logger.warning("Could not write marker %s in %s: %s", marker, target, e)

    return {
        "path": to_relative(target),
        "name": clean,
        "container_kind": container_kind,
        "nsfw": nsfw,
        "frames_container": frames_container,
        "markers": markers,
    }


def system_for_folder(db: Session, path: Path) -> Optional[Any]:
    """The ``GameSystem`` a books folder represents, if any.

    A system folder is not an indexed *file*, so it has no row keyed by path —
    but it does correspond to a system, and that system carries the metadata a
    user wants to edit (description, genres, publisher, cover). Resolving it here
    lets a folder offer the same "edit metadata" affordance a file does.

    Matched on the same derived name/slug the scanner uses, so the folder and the
    row agree even when the folder name carries ``(nsfw)``, a container suffix, or
    a sort prefix. Only direct children of ``books/`` are systems; anything deeper
    is a category folder.
    """
    rel = to_relative(path)
    parts = rel.split("/")
    if len(parts) != 2 or parts[0].lower() != "books":
        return None
    name = _system_folder_name(parts[1])
    return (
        db.query(GameSystem).filter(GameSystem.name == name).first()
        or db.query(GameSystem).filter(GameSystem.slug == slugify(name)).first()
    )


def find_singleton_container(kind: str, *, ignore: Optional[Path] = None) -> Optional[str]:
    """Return the library-relative path of the folder already claiming ``kind``.

    Only meaningful for the kinds in ``SINGLETON_CONTAINER_KINDS`` — the ones
    that name *the* collection of their sort rather than a repeatable shelf.

    Scans only the top level of ``books/``, which is the only depth these
    collections are recognised at, so this stays a single cheap directory read
    rather than a walk of the library.
    """
    if kind not in SINGLETON_CONTAINER_KINDS:
        return None
    books = library_root() / "books"
    marker = CONTAINER_MARKERS[kind]
    try:
        children = [c for c in books.iterdir() if c.is_dir()]
    except OSError:
        return None
    for child in children:
        if ignore is not None and child == ignore:
            continue
        if (child / marker).exists():
            return to_relative(child)
        # The reserved slugs claim the collection without a marker file, so a
        # folder simply *named* by the convention counts as the incumbent.
        if kind == CONTAINER_ONE_PAGE and is_one_page_folder(child.name):
            return to_relative(child)
        if kind == CONTAINER_AGNOSTIC and is_system_agnostic_folder(child.name):
            return to_relative(child)
    return None


def _assert_singleton_free(kind: str, target: Optional[Path]) -> None:
    """Refuse a second folder claiming a one-of-a-kind collection.

    Two "one-page RPGs" folders would each claim to be the home of every tiny
    game, and identical books in each would be filed under different systems.
    The UI hides the option once one exists, but the check lives here so the API
    cannot be talked into an inconsistent library.
    """
    existing = find_singleton_container(kind, ignore=target)
    if existing:
        raise LibraryFSError(
            f"'{existing}' is already the {kind} collection, and there can only be one. "
            "Change that folder first if you want this one to take over.",
            code="conflict",
        )


def set_folder_markers(
    path: str,
    *,
    container_kind: Optional[str] = None,
    nsfw: Optional[bool] = None,
    frames_container: Optional[bool] = None,
) -> dict:
    """Add or remove container/NSFW/frame markers on an existing folder.

    Separate from ``create_folder`` because reclassifying an existing shelf is a
    distinct, common operation — marking a folder NSFW, or promoting one that has
    grown into a parent system — and neither should require recreating it.
    ``None`` leaves that aspect untouched.

    Container kind and the frame marker are independent axes rather than one
    list of kinds, and they are refused in different places: a container kind
    only means something where a game system belongs, a frame marker only under
    ``tokens/``. Writing either where it is inert would leave the user with a
    badge and a dot file that change nothing about the next scan, so each is
    checked against the folder it is being written to.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    assert_writable(target)

    if container_kind is not None:
        if container_kind and container_kind not in CONTAINER_MARKERS:
            raise LibraryFSError(f"Unknown container kind: {container_kind}", code="invalid")
        # Only guard *setting* a kind. Clearing one is always allowed, so a
        # marker created by hand in the wrong place stays removable from here.
        if container_kind and not accepts_container_kind(target):
            raise LibraryFSError(
                "Container kinds only apply to folders that hold game systems — "
                "inside books/, at a depth where a system folder belongs.",
                code="invalid",
            )
        if container_kind:
            _assert_singleton_free(container_kind, target)
        # Container kinds are mutually exclusive: clear all, then set the chosen
        # one, so switching kinds cannot leave two markers fighting over
        # precedence.
        for marker in CONTAINER_MARKERS.values():
            _remove_marker(target / marker)
        if container_kind:
            _write_marker(target / CONTAINER_MARKERS[container_kind])

    if nsfw is not None:
        if nsfw:
            _write_marker(target / NSFW_MARKER)
        else:
            _remove_marker(target / NSFW_MARKER)

    if frames_container is not None:
        # Same asymmetry as the container kinds: setting is guarded, clearing is
        # not, so a marker that ended up somewhere the walk ignores can still be
        # cleaned up from the file manager.
        if frames_container and not accepts_frames_marker(target):
            raise LibraryFSError(
                "Frame folders are read from the token library — put this folder "
                "anywhere under tokens/.",
                code="invalid",
            )
        if frames_container:
            _write_marker(target / FRAMES_MARKER)
        else:
            _remove_marker(target / FRAMES_MARKER)

    return read_folder_markers(target)


def _write_marker(path: Path) -> None:
    try:
        path.touch()
    except OSError as e:
        raise LibraryFSError(f"Could not write marker file: {e}", code="io_error") from e


def _remove_marker(path: Path) -> None:
    try:
        path.unlink()
    except FileNotFoundError:
        pass
    except OSError as e:
        logger.warning("Could not remove marker %s: %s", path, e)


def read_folder_markers(target: Path) -> dict:
    """The container kind, NSFW state, and frame-folder flag declared on disk."""
    kind = ""
    for k, marker in CONTAINER_MARKERS.items():
        if (target / marker).exists():
            kind = k
            break
    return {
        "path": to_relative(target),
        "container_kind": kind,
        "nsfw": (target / NSFW_MARKER).exists(),
        # Reported separately from container_kind rather than joining it: the
        # container kinds describe how a books folder's children relate to each
        # other, while this says only "the images here are token-editor frames".
        # A frame folder is any depth under tokens/ — tokens/Fantasy Frames and
        # tokens/Cyberpunk/Frames are both valid — so this is a plain marker
        # check with no precedence chain behind it.
        "frames_container": (target / FRAMES_MARKER).is_file(),
    }


def holds_system_folders(target: Path) -> bool:
    """Whether ``target``'s immediate children are system folders.

    True for ``books/`` and for any container reached from it through nothing but
    containers. This is the half of the rule that makes nesting work: a family
    holding a parent-system holding editions (issue #301) keeps handing "these
    children are systems" down the chain, and the first folder that is not a
    container ends it — its children are category folders.
    """
    rel = to_relative(target)
    parts = rel.split("/")
    if parts[0] != "books":
        return False
    if len(parts) == 1:
        return True
    root = library_root()
    # Every folder from books/ down to and including the target must be a
    # container, or the target is a system folder and its children are
    # categories.
    return all(
        _container_kind_of(root.joinpath(*parts[: depth + 1])) != ""
        for depth in range(1, len(parts))
    )


def is_category_host(target: Path) -> bool:
    """Whether standard category folders belong directly inside ``target``.

    Categories are a books-tree concept that hangs off a *system* folder, and a
    container holds systems rather than categories — its children are the system
    folders, so scaffolding "Core"/"Adventures" onto the container itself would
    invent sibling systems named after categories and re-file nothing correctly.

    So ``target`` hosts categories exactly when its *parent* hands down system
    folders and ``target`` is not itself a container. That mirrors
    ``_scan_container``, which recurses through containers and only reads
    categories in the first folder that is not one.
    """
    rel = to_relative(target)
    parts = rel.split("/")
    # `books/<system>` at minimum: `books/` itself holds systems, not categories.
    if len(parts) < 2 or parts[0] != "books":
        return False
    if not holds_system_folders(target.parent):
        return False
    return _container_kind_of(target) == ""


def accepts_container_kind(target: Path) -> bool:
    """Whether declaring ``target`` a container would mean anything.

    Container kinds say "my children are game systems", which only the books
    scanner reads — ``holds_system_folders`` refuses anything whose first
    segment is not ``books``, and ``_scan_container`` only recurses there. A
    marker written anywhere else is inert: the folder gains a badge and a dot
    file, and nothing about the scan changes.

    Inside ``books/`` the depth matters too. A container is only recognised
    where systems are expected — ``books/`` itself, and any folder reached from
    it through nothing but containers. One level deeper sits a *system* folder,
    whose children are categories; marking that a container would hand the
    scanner "Core Rulebooks" and "Adventures" as sibling game systems and
    scatter the books across them.

    So the question is exactly the one ``holds_system_folders`` already answers
    about the parent: this folder may declare a kind when a system folder is
    what belongs in its place.
    """
    rel = to_relative(target)
    parts = rel.split("/")
    if parts[0] != "books":
        return False
    # `books/` itself is not a folder anyone declares a kind on — it is the root
    # the whole chain hangs from.
    if len(parts) < 2:
        return False
    return holds_system_folders(target.parent)


def accepts_frames_marker(target: Path) -> bool:
    """Whether ``target`` can declare its images token-editor frames.

    The frame marker is read by ``routers/token_frames``, which walks
    ``tokens/**`` and nothing else, so the marker only has an effect under the
    token library. Unlike the container kinds it carries no depth rule:
    ``tokens/Fantasy Frames`` and ``tokens/Cyberpunk/Neon/Frames`` are equally
    valid, because the walk finds a marker at any depth.

    ``tokens/`` itself is excluded. The walk starts there and would read every
    token in the library as frame art.
    """
    rel = to_relative(target)
    parts = rel.split("/")
    return parts[0] == "tokens" and len(parts) >= 2


def _container_kind_of(folder: Path) -> str:
    """The container kind a books folder declares, by marker, suffix, or name."""
    _, suffix_kind = strip_container_suffix(folder.name)
    return suffix_kind or detect_container_kind(folder, folder.name)


def scaffold_categories(path: str) -> dict:
    """Create the standard category folders inside a system folder.

    Setting up a new system means creating the same handful of folders every
    time, named exactly as the scanner's category inference expects. Doing it by
    hand is tedious and easy to get subtly wrong — "Adventures" works, "Modules"
    silently becomes a custom category — so this writes the canonical set.

    Only offered on a folder that actually hosts categories — see
    ``is_category_host``: under ``books/``, and not a container, whose children
    are the system folders instead. Existing folders are left alone and reported
    separately, so running this on a partly-organised system fills the gaps
    instead of failing.
    """
    target = safe_join(path, must_exist=True)
    if not target.is_dir():
        raise LibraryFSError("Not a folder", code="invalid")
    if collection_of(target) != "books":
        raise LibraryFSError(
            "Category folders only apply to the books library", code="invalid"
        )
    # `books/` itself holds systems, not categories, and neither does a
    # container — its children are the system folders that hold them.
    if not is_category_host(target):
        raise LibraryFSError(
            "Pick a system folder inside books/ — the books folder itself and "
            "container folders hold systems, not categories",
            code="invalid",
        )
    assert_writable(target)

    # Which categories the folder already covers, however they happen to be
    # spelled. Matching on the *inferred category* rather than the folder name is
    # the point: "Rules", "Rulebooks" and "core" all classify as `core`, so
    # adding a "Core" folder beside them would split one category across two
    # shelves and leave the user tidying up after the button that was supposed
    # to tidy for them.
    #
    # `guess_category` reads the category folder at a fixed index, so it has to
    # be told how deep this system sits. `books/<system>` is the depth-2 default,
    # but a system inside one or more containers pushes the category folder down
    # by a level per container (issue #412) — read at the default depth, every
    # candidate would resolve to the same container name and only the first would
    # ever be created.
    rel_target = to_relative(target)
    system_depth = len(rel_target.split("/"))

    covered: dict[str, str] = {}
    try:
        for child in target.iterdir():
            if not child.is_dir() or child.name.startswith("."):
                continue
            category = guess_category(f"{to_relative(child)}/x.pdf", system_depth=system_depth)
            covered.setdefault(category, child.name)
    except OSError as e:
        logger.warning("Could not read %s while scaffolding: %s", target, e)

    created: list[str] = []
    existing: list[str] = []
    for name in SCAFFOLD_CATEGORY_FOLDERS:
        category = guess_category(f"{rel_target}/{name}/x.pdf", system_depth=system_depth)
        held_by = covered.get(category)
        if held_by is not None:
            existing.append(held_by)
            continue
        child = target / name
        if child.exists():
            existing.append(name)
            continue
        try:
            child.mkdir()
            created.append(name)
            # Claim the category so a later name mapping to the same one (were
            # the list ever to contain two) cannot create a duplicate.
            covered[category] = name
        except OSError as e:
            if getattr(e, "errno", None) == 30:
                raise LibraryFSError(
                    "The library is mounted read-only, so it cannot be modified.",
                    code="read_only",
                ) from e
            logger.warning("Could not create category folder %s: %s", child, e)

    return {"path": rel_target, "created": created, "existing": existing}

