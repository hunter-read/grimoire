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
from typing import AbstractSet, Callable, Optional

from sqlalchemy.orm import Session

from ..filenames import is_undecodable, warn_skipped
from ..library_ignore import IgnoreMatcher
from ..services.filename_rules.folders import RuleSet, rule_set
from .categories import slugify
from .metadata import is_exported_cover_name
from .thumbnails import archive_ext


def _readable_name(root: str, name: str, *, warn: bool = True) -> bool:
    """Whether ``name`` is valid UTF-8, logging the skip when it is not.

    A name that is not (issue #547) cannot be stored, served, or logged, so the
    entry is left out of the scan rather than allowed to fail the whole walk.
    ``warn`` is off for the counting pass, which visits the same entries the
    walk is about to, so each one is reported once.
    """
    if not is_undecodable(name):
        return True
    if warn:
        warn_skipped(os.path.join(root, name))
    return False


def _prune_dirs(
    root: str, dirs: list[str], ignore: Optional[IgnoreMatcher], *, warn: bool = True
) -> list[str]:
    """Return the walk subdirectories to descend into.

    Drops hidden dirs (``.``-prefixed), dirs whose name is not valid UTF-8, and,
    when an ``ignore`` matcher is given, any directory excluded by a
    ``.grimoireignore`` rule — pruning the whole subtree so those folders are
    never walked.
    """
    return [
        d
        for d in dirs
        if not d.startswith(".")
        and _readable_name(root, d, warn=warn)
        and not (ignore and ignore.is_ignored(os.path.join(root, d), is_dir=True))
    ]


def _keep_entry(path: Path, ignore: Optional[IgnoreMatcher], *, is_dir: bool) -> bool:
    """Return True if a directly-enumerated entry should be scanned.

    The ``os.walk`` paths prune with :func:`_prune_dirs`, but the system and
    container walks list a directory themselves (``Path.iterdir``) and so need
    the same hidden-plus-``.grimoireignore`` test applied per entry (issue #333),
    along with the same UTF-8 name check.
    """
    return (
        not path.name.startswith(".")
        and _readable_name(str(path.parent), path.name)
        and not (ignore and ignore.is_ignored(str(path), is_dir=is_dir))
    )


def _count_eligible_files(
    directory: Path,
    extensions: AbstractSet[str],
    ignore: Optional[IgnoreMatcher] = None,
    *,
    skip_exported_covers: bool = False,
) -> int:
    """Count non-hidden files with matching extensions under directory.

    When an ``ignore`` matcher is supplied, directories and files excluded by a
    ``.grimoireignore`` rule are skipped so the count matches what the scan will
    actually process (keeping progress totals accurate).

    ``skip_exported_covers`` mirrors the books walk, which skips ``.cover.jpg``
    files written by the sidecar exporter. It is off by default because maps and
    tokens are image collections where such a name is ordinary content.
    """
    count = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = _prune_dirs(root, dirs, ignore, warn=False)
        for f in files:
            if f.startswith(".") or is_undecodable(f):
                continue
            if ignore and ignore.is_ignored(os.path.join(root, f), is_dir=False):
                continue
            if skip_exported_covers and is_exported_cover_name(f):
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
    totals: dict  # {"books": int, "maps": int, "tokens": int, "audio": int, "models": int}
    scanned: dict = field(
        default_factory=lambda: {"books": 0, "maps": 0, "tokens": 0, "audio": 0, "models": 0}
    )
    # Ids of rows inserted by this scan. Move detection only accepts one of these
    # as a destination — a pre-existing row is a file that did not move, even when
    # its contents match something deleted elsewhere.
    inserted_ids: set = field(default_factory=set)
    # Ids of every GameSystem this scan walked to (registered or re-registered).
    # A row absent from this set has no folder behind it any more — see
    # ``_prune_vanished_systems``.
    seen_system_ids: set = field(default_factory=set)
    # False during the library's first import, whose items are left undated so
    # a fresh install does not badge its whole library as new (issue #199).
    # See ``added_dates``.
    date_inserts: bool = True
    # Folder naming patterns (issue #521), loaded on first use: most libraries
    # have none, and a scan that inserts no books never needs them.
    _naming: Optional[RuleSet] = field(default=None, init=False, repr=False)

    def naming_rules(self) -> RuleSet:
        if self._naming is None:
            self._naming = rule_set(self.session)
        return self._naming

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
                self.scanned["models"],
                self.totals["models"],
            )

    def thumb_path(self, section: str, title: str, filepath: str) -> str:
        return thumb_path_for(self.thumb_dir, section, title, filepath)


def thumb_path_for(thumb_dir: str | Path, section: str, title: str, filepath: str) -> str:
    """Where a thumbnail for ``filepath`` lives on disk.

    The one spelling of the rule. The name embeds a slug of the title and a hash
    of the path, and the serving routes rebuild it the same way — so a second
    implementation anywhere would write files nothing can find. Callers outside
    a scan (the deferred thumbnail queue) use this directly.
    """
    return os.path.join(
        thumb_dir,
        section,
        f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
    )


def _title_from_filename(filename: str) -> str:
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip()
