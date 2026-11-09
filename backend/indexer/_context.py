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
import datetime
import hashlib
import os
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import AbstractSet, Any, Callable, Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from ..filenames import is_undecodable, warn_skipped
from ..library_ignore import IgnoreMatcher
from ..sql_paths import path_under
from ..services.filename_rules.folders import RuleSet, rule_set
from .categories import slugify
from .metadata import is_exported_cover_name
from .thumbnails import archive_ext


# How long, in seconds, a scan reuses its last stop answer and holds back its
# next progress report. A walk visits thousands of files a second when nothing
# has changed, and each ask is a status read (a Valkey round trip, or a stat of
# the stop file) while each report is three more. Half a second is finer than
# the admin page polls, and matches how often a thumbnail wait checks for a
# stop anyway.
STATUS_INTERVAL = 0.5
# Progress is also reported once this many more files have been walked, so a
# slow walk's bar still moves on every hundred files.
_PROGRESS_STEP = 100


def throttled(should_stop: Callable[[], bool], interval: float) -> Callable[[], bool]:
    """``should_stop``, asked at most once per ``interval`` seconds.

    In between, the last answer is reused. A True is never re-asked: once a stop
    has been seen it stands, so every check after it agrees.
    """
    if interval <= 0:
        return should_stop
    asked_at = float("-inf")
    answer = False

    def check() -> bool:
        nonlocal asked_at, answer
        if answer:
            return True
        now = time.monotonic()
        if now - asked_at >= interval:
            answer = bool(should_stop())
            asked_at = now
        return answer

    return check


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


def _count_registered(session: Session, model: Any, walk_dir: Path) -> int:
    """How many rows the last scan left present under ``walk_dir``: its file count.

    What a rescan uses as its progress total, in place of walking the tree an
    extra time just to count it. It is off by whatever changed since, and the
    reported total never drops below the count walked (see ``emit_progress``).
    """
    return int(
        session.query(func.count(model.id))
        .filter(
            path_under(model.filepath, f"{walk_dir}{os.sep}"),
            model.is_missing.isnot(True),
        )
        .scalar()
        or 0
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
    # Progress of the steps after the walk - see ``scan_library``.
    on_phase: Optional[Callable[[str, int, int], None]] = None
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
    # Ids of every GameSystem this scan created. A system whose books all moved
    # into one of these was renamed rather than deleted (issue #670).
    created_system_ids: set = field(default_factory=set)
    # For each system that lost a book to a detected move, the systems those
    # books moved into. Pairs a renamed folder's old row with its new one, and
    # marks a system emptied by moves as this library's to prune.
    vacated_systems: dict = field(default_factory=dict)
    # False during the library's first import, whose items are left undated so
    # a fresh install does not badge its whole library as new (issue #199).
    # See ``added_dates``.
    date_inserts: bool = True
    # When the last complete missing-file sweep began (naive UTC), or None.
    # Rows created after it may still be the new half of a move - see ``moves``.
    reconciled_at: Optional[datetime.datetime] = None
    # Every path each walk registered or confirmed, per section, recorded after
    # its ignore check. The missing-file sweep reads a row in here as present
    # without a stat - see ``reconcile``. Paths only: about 6 MB for 50,000.
    seen_paths: dict[str, set[str]] = field(default_factory=dict)
    # The folders each media walk found a ``tags.json`` in, in walk order, so
    # applying them needs no second walk of the tree - see ``tags``.
    tags_json_dirs: dict[str, list[str]] = field(default_factory=dict)
    # Seconds between real stop checks and progress reports. Read when the
    # context is built, so a test can set ``STATUS_INTERVAL`` - see
    # ``__post_init__`` and ``emit_progress``.
    status_interval: float = field(default_factory=lambda: STATUS_INTERVAL)
    _last_emit_at: float = field(default=float("-inf"), init=False, repr=False)
    _last_emit_done: int = field(default=0, init=False, repr=False)
    # Folder naming patterns (issue #521), loaded on first use: most libraries
    # have none, and a scan that inserts no books never needs them.
    _naming: Optional[RuleSet] = field(default=None, init=False, repr=False)
    # Path hashes of the thumbnails on disk, per media section, listed once on
    # first use - see ``thumbnail_hashes``. Hashes only, never names or paths,
    # so a 33,000-map library costs a few MB for the length of one scan.
    _thumb_hashes: dict[str, set[str]] = field(default_factory=dict, init=False, repr=False)

    def __post_init__(self) -> None:
        # Wrapped here rather than in ``stop_requested`` so that everything handed
        # ``ctx.should_stop`` - file hashing, the thumbnail wait, the helper
        # process poll - shares the one throttled answer, and agrees with it.
        if self.should_stop is not None:
            self.should_stop = throttled(self.should_stop, self.status_interval)

    def naming_rules(self) -> RuleSet:
        if self._naming is None:
            self._naming = rule_set(self.session)
        return self._naming

    def saw(self, section: str, filepath: str) -> None:
        """Record that the walk found ``filepath`` on disk and kept it."""
        self.seen_paths.setdefault(section, set()).add(filepath)

    def thumbnail_hashes(self, section: str) -> set[str]:
        """The path hashes of every thumbnail in ``thumb_dir/section``.

        Read with one directory listing the first time a section asks, then
        answered from memory. Testing each row with a ``*_<hash>.webp`` glob
        listed the whole directory once per row, which on a library of 23,000
        maps was 23,000 listings of 23,000 names.
        """
        hashes = self._thumb_hashes.get(section)
        if hashes is None:
            hashes = list_thumbnail_hashes(os.path.join(self.thumb_dir, section))
            self._thumb_hashes[section] = hashes
        return hashes

    def note_thumbnail(self, section: str, filepath: str) -> None:
        """Record a thumbnail this scan wrote, so a later row sees it without a re-list."""
        hashes = self._thumb_hashes.get(section)
        if hashes is not None:
            hashes.add(path_hash(filepath))

    def stop_requested(self) -> bool:
        return bool(self.should_stop and self.should_stop())

    def emit_progress(self, force: bool = False) -> None:
        """Report the walk's counters, at most every ``status_interval`` seconds.

        A report is also sent once ``_PROGRESS_STEP`` more files have been
        walked, and always when ``force`` is set - at the end of each walk, so
        the bar finishes on the true count.
        """
        if not self.on_progress:
            return
        done = sum(self.scanned.values())
        now = time.monotonic()
        if (
            not force
            and now - self._last_emit_at < self.status_interval
            and done - self._last_emit_done < _PROGRESS_STEP
        ):
            return
        self._last_emit_at = now
        self._last_emit_done = done
        # A total taken from the database is the library as the last scan left
        # it, so new files can walk past it. A bar past 100% is no use to
        # anyone; a zero total is left alone, as "not known".
        totals = {
            k: max(t, self.scanned[k]) if t else 0 for k, t in self.totals.items()
        }
        self.on_progress(
            self.scanned["books"],
            totals["books"],
            self.scanned["maps"],
            totals["maps"],
            self.scanned["tokens"],
            totals["tokens"],
            self.scanned["audio"],
            totals["audio"],
            self.scanned["models"],
            totals["models"],
        )

    def emit_phase(self, phase: str, done: int, total: int) -> None:
        if self.on_phase:
            self.on_phase(phase, done, total)

    def thumb_path(self, section: str, title: str, filepath: str) -> str:
        return thumb_path_for(self.thumb_dir, section, title, filepath)


def path_hash(filepath: str) -> str:
    """The 8-hex-digit hash of ``filepath`` that ends its thumbnail's name."""
    return hashlib.md5(filepath.encode()).hexdigest()[:8]


_HEX_DIGITS = frozenset("0123456789abcdef")


def list_thumbnail_hashes(directory: str) -> set[str]:
    """The path hashes of the ``<slug>_<hash>.webp`` files in ``directory``.

    Matches what ``glob("*_<hash>.webp")`` did, entry for entry: hidden names
    are skipped (a glob ``*`` never matches a leading dot) and anything not of
    that shape is ignored. A directory that does not exist yet holds nothing.
    """
    hashes: set[str] = set()
    try:
        with os.scandir(directory) as entries:
            for entry in entries:
                name = entry.name
                if name.startswith(".") or not name.endswith(".webp"):
                    continue
                stem = name[:-5]
                if len(stem) >= 9 and stem[-9] == "_" and _HEX_DIGITS.issuperset(stem[-8:]):
                    hashes.add(stem[-8:])
    except OSError:
        pass
    return hashes


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
        f"{slugify(title)}_{path_hash(filepath)}.webp",
    )


def _title_from_filename(filename: str) -> str:
    return Path(filename).stem.replace("_", " ").replace("-", " ").strip()
