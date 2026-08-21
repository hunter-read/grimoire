"""Shared scan state and the walk filters every collection phase uses.

``_ScanContext`` is the single mutable object threaded through the collection
phases in ``scan.py``, ``systems.py``, ``books.py``, ``media.py``, and
``reconcile.py``. It carries the session, the scope, the progress counters, and
the bookkeeping sets the reconcile phase reads back (``inserted_ids``,
``seen_system_ids``). Keeping it here rather than in ``scan.py`` is what lets
the phase modules import it without importing the orchestrator — otherwise
every phase would cycle back through ``scan``.

The walk filters live here for the same reason: ``_prune_dirs`` and
``_keep_entry`` are the two places ``.grimoireignore`` is honoured, and all
four phases need them.
"""
import hashlib
import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Callable, Optional

from sqlalchemy.orm import Session

from ..library_ignore import IgnoreMatcher
from .categories import slugify
from .thumbnails import archive_ext


def _prune_dirs(root: str, dirs: list[str], ignore: Optional[IgnoreMatcher]) -> list[str]:
    """Return the walk subdirectories to descend into.

    Drops hidden dirs (``.``-prefixed) and, when an ``ignore`` matcher is given,
    any directory excluded by a ``.grimoireignore`` rule — pruning the whole
    subtree so ignored folders are never walked.
    """
    return [
        d
        for d in dirs
        if not d.startswith(".")
        and not (ignore and ignore.is_ignored(os.path.join(root, d), is_dir=True))
    ]


def _keep_entry(path: Path, ignore: Optional[IgnoreMatcher], *, is_dir: bool) -> bool:
    """Return True if a directly-enumerated entry should be scanned.

    The ``os.walk`` paths prune with :func:`_prune_dirs`, but the system and
    container walks list a directory themselves (``Path.iterdir``) and so need
    the same hidden-plus-``.grimoireignore`` test applied per entry (issue #333).
    """
    return not path.name.startswith(".") and not (
        ignore and ignore.is_ignored(str(path), is_dir=is_dir)
    )


def _count_eligible_files(
    directory: Path, extensions: set, ignore: Optional[IgnoreMatcher] = None
) -> int:
    """Count non-hidden files with matching extensions under directory.

    When an ``ignore`` matcher is supplied, directories and files excluded by a
    ``.grimoireignore`` rule are skipped so the count matches what the scan will
    actually process (keeping progress totals accurate).
    """
    count = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = _prune_dirs(root, dirs, ignore)
        for f in files:
            if f.startswith("."):
                continue
            if ignore and ignore.is_ignored(os.path.join(root, f), is_dir=False):
                continue
            if Path(f).suffix.lower() in extensions or archive_ext(f) in extensions:
                count += 1
    return count


@dataclass
class _ScanContext:
    """Shared state threaded through the collection-scan phase helpers."""

    library_path: str
    session: Session
    ignore: IgnoreMatcher
    thumb_dir: Path
    scope_dir: Path | None
    scope_section: str | None
    scope_path: str | None
    metadata_mode: str
    on_progress: Optional[Callable[..., None]]
    should_stop: Optional[Callable[[], bool]]
    stats: dict
    totals: dict  # {"books": int, "maps": int, "tokens": int, "audio": int}
    scanned: dict = field(
        default_factory=lambda: {"books": 0, "maps": 0, "tokens": 0, "audio": 0}
    )
    # Ids of rows inserted by this scan. Move detection only accepts one of these
    # as a destination — a pre-existing row is a file that did not move, even when
    # its contents match something deleted elsewhere.
    inserted_ids: set = field(default_factory=set)
    # Ids of every GameSystem this scan walked to (registered or re-registered).
    # A row absent from this set has no folder behind it any more — see
    # ``_prune_vanished_systems``.
    seen_system_ids: set = field(default_factory=set)

    def stop_requested(self) -> bool:
        return bool(self.should_stop and self.should_stop())

    def emit_progress(self) -> None:
        if self.on_progress:
            self.on_progress(
                self.scanned["books"],
                self.totals["books"],
                self.scanned["maps"],
                self.totals["maps"],
                self.scanned["tokens"],
                self.totals["tokens"],
                self.scanned["audio"],
                self.totals["audio"],
            )

    def thumb_path(self, section: str, title: str, filepath: str) -> str:
        return os.path.join(
            self.thumb_dir,
            section,
            f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
        )


def _title_from_filename(filename: str) -> str:
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip()
