"""Structural filesystem operations on the library, with the DB kept in step.

Grimoire has always treated the library as read-only: the scanner walks it, and
every structural change (renaming a mistyped folder, moving a book into the right
category, creating a container) happened in some other tool, followed by a
rescan. This package is the write half (issue #302).

The whole design turns on one constraint: **path is identity**. ``filepath`` is
the unique key for every indexed row, so a naive ``os.rename`` orphans the record
— the next scan flags the old row missing and inserts a fresh one, dropping the
tags, favorites, bookmarks, reading progress, campaign links, and FTS text
attached to the old id. Issue #284 solved that for moves made *outside* the app
by matching content hashes after the fact. Here we already know the source and
the destination, so there is nothing to detect: the move and the relink happen
together, in one transaction, and the row's id never changes.

Ordering matters and is deliberate throughout. Validate before touching the disk;
move the file before writing the DB (a failed rename must not leave the DB
pointing at a path that was never created); and let a DB failure roll the file
back to where it came from, so the two never disagree. The alternative — DB
first — can strand a row pointing at a file that does not exist, which is exactly
the state this feature exists to prevent.

Path handling is likewise uniform: every caller-supplied path is treated as
hostile and resolved against the library root before use, because these are the
first endpoints in the app that write to arbitrary library locations.

This was one module before; it is now split by concern:

* ``constants``  — ``COLLECTIONS``, ``LibraryFSError``, tunables
* ``paths``      — root resolution, containment, sidecar identification
* ``placement``  — which folder a book's system/category implies
* ``moves``      — move, rename, relocate, and the relink machinery
* ``folders``    — folder creation, container markers, category scaffolding
* ``uploads``    — validating and streaming an upload into place
* ``deletes``    — deleting files/folders and purging derived state

The public API is unchanged: every symbol that used to live in
``services/library_fs.py`` is re-exported here, so ``from ..services import
library_fs`` and ``library_fs.X`` keep working exactly as before.
"""

# ``os`` and ``shutil`` are bound here because tests reach for them as
# ``library_fs.os`` / ``library_fs.shutil`` to patch syscalls.
import os  # noqa: F401
import shutil  # noqa: F401

from .constants import (  # noqa: F401
    COLLECTIONS,
    SCAFFOLD_CATEGORY_FOLDERS,
    LibraryFSError,
    _THUMB_SECTIONS,
    _UPLOAD_CHUNK,
)
from .paths import (  # noqa: F401
    _has_content_sibling,
    assert_writable,
    collection_of,
    is_sidecar,
    library_root,
    library_writable,
    safe_join,
    sidecar_stem,
    sidecars_for,
    to_relative,
)
from .placement import (  # noqa: F401
    CATEGORY_FOLDER_NAMES,
    _system_folder_name,
    _system_root_for,
    category_folder_for,
    resolve_book_placement,
)
from .moves import (  # noqa: F401
    MoveResult,
    _carry_sidecars,
    _dest_for,
    _find_record,
    _fix_caches,
    _move_one,
    _records_under,
    _rehome_thumbnail,
    _relink,
    _restore_sidecars,
    _section_for_model,
    _thumb_file,
    move_paths,
    relocate_book_for_category,
    rename_path,
)
from .folders import (  # noqa: F401
    _assert_singleton_free,
    _remove_marker,
    _write_marker,
    create_folder,
    find_singleton_container,
    read_folder_markers,
    scaffold_categories,
    set_folder_markers,
    system_for_folder,
)
from .uploads import (  # noqa: F401
    _cleanup_partial,
    _upload_ext,
    allowed_upload_exts,
    save_upload,
    validate_upload_name,
)
from .deletes import (  # noqa: F401
    _delete_file,
    _delete_folder_tree,
    _delete_records,
    _purge_derived,
    delete_empty_folder,
    delete_path,
    folder_has_content,
)
