"""Writing sidecars to disk, and deciding when not to.

Two entry points with deliberately different postures:

:func:`export_book` **creates**. It is what the backfill runs, and it will write
a sidecar that does not exist yet.

:func:`refresh_existing` **only updates**. Called after a metadata edit is
committed, it rewrites the sidecars a book already has and creates nothing. So
editing a book never makes a new file appear in the library — sidecars appear
only from an explicit backfill — while a book that *does* have a ``.nfo`` can
never drift from the database behind the user's back.

Nothing here raises on a filesystem failure. Sidecar export is a secondary
effect of an operation that has already succeeded; a read-only mount is a
supported deployment, and it must degrade to a reported skip rather than a 500
on a metadata save that was committed a moment ago.
"""
import hashlib
import logging
import os
import shutil
import tempfile
from dataclasses import dataclass, field
from typing import Optional

from sqlalchemy.orm import Session

from ..config import THUMB_DIR
from ..indexer.categories import slugify
from ..models import Book
from . import settings as export_settings
from .fields import book_fields
from .formats import is_grimoire_generated, render, sidecar_path

logger = logging.getLogger("grimoire.metadata")

# Covers are written beside the content, named from its stem, so a file manager
# shows them paired. Jellyfin also accepts a folder-level ``thumb.jpg``, but a
# per-book name is the only one that works when a folder holds several books.
_COVER_SUFFIX = ".jpg"


@dataclass
class ExportResult:
    """What an export run did, in enough detail to report it to the user."""

    written: int = 0
    skipped_foreign: int = 0
    skipped_missing: int = 0
    failed: int = 0
    covers: int = 0
    errors: list[str] = field(default_factory=list)
    read_only: bool = False

    def merge(self, other: "ExportResult") -> None:
        self.written += other.written
        self.skipped_foreign += other.skipped_foreign
        self.skipped_missing += other.skipped_missing
        self.failed += other.failed
        self.covers += other.covers
        self.read_only = self.read_only or other.read_only
        # Bounded: a library-wide failure (a read-only mount) would otherwise
        # produce one message per book and a response megabytes long.
        for message in other.errors:
            if len(self.errors) >= 20:
                break
            if message not in self.errors:
                self.errors.append(message)


def _may_write(path: str, *, overwrite_foreign: bool) -> tuple[bool, str]:
    """Whether an existing sidecar may be replaced.  Returns ``(ok, reason)``.

    A file we cannot read is treated as foreign. Being unable to prove we wrote
    something is not grounds for overwriting it.
    """
    if not os.path.exists(path):
        return True, ""
    if overwrite_foreign:
        return True, ""
    try:
        with open(path, "r", encoding="utf-8", errors="replace") as fh:
            head = fh.read(8192)
    except OSError as exc:
        return False, f"could not read existing sidecar: {exc}"
    if is_grimoire_generated(head):
        return True, ""
    return False, "exists and was not written by Grimoire"


def _atomic_write(path: str, text: str) -> None:
    """Write ``text`` to ``path`` via a temp file in the same directory.

    A half-written sidecar is worse than none: the importer reads these back, so
    a crash mid-write could feed a truncated file into the next rescan. Renaming
    a complete file into place makes the swap atomic. The temp file must share
    the destination's directory or the rename becomes a cross-device copy and
    loses that property.
    """
    directory = os.path.dirname(path) or "."
    fd, tmp = tempfile.mkstemp(dir=directory, prefix=".grimoire-", suffix=".tmp")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as fh:
            fh.write(text)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _thumbnail_source(book: Book) -> Optional[str]:
    """The cached thumbnail for a book, keyed exactly as the scanner keys it."""
    name = f"{slugify(book.title)}_{hashlib.md5(book.filepath.encode()).hexdigest()[:8]}.webp"
    path = os.path.join(THUMB_DIR, "books", name)
    return path if os.path.isfile(path) else None


def _write_cover(book: Book, result: ExportResult, *, overwrite_foreign: bool) -> Optional[str]:
    """Copy the book's thumbnail next to it.  Returns the bare filename written.

    The cached thumbnail is WebP while the ``.jpg`` name is what other tools
    expect, and the bytes are copied rather than transcoded — re-encoding would
    need a decoder here purely to satisfy an extension. Consumers that sniff
    content handle it; those that trust the extension are why this is optional.
    """
    source = _thumbnail_source(book)
    if not source:
        return None
    stem, _ = os.path.splitext(book.filepath)
    dest = stem + _COVER_SUFFIX
    if os.path.exists(dest) and not overwrite_foreign:
        # A cover we did not write carries no marker to check, so an existing
        # one is always left alone unless the operator opted into overwriting.
        return os.path.basename(dest)
    try:
        shutil.copyfile(source, dest)
        result.covers += 1
    except OSError as exc:
        _record_failure(result, dest, exc)
        return None
    return os.path.basename(dest)


def _record_failure(result: ExportResult, path: str, exc: OSError) -> None:
    """Classify an OSError, flagging the read-only case the operator can act on."""
    result.failed += 1
    if getattr(exc, "errno", None) == 30:  # EROFS
        result.read_only = True
        message = (
            "The library is mounted read-only, so metadata sidecars cannot be "
            "written. Remount it read-write to export metadata."
        )
    else:
        message = f"{os.path.basename(path)}: {exc}"
    if message not in result.errors and len(result.errors) < 20:
        result.errors.append(message)
    logger.warning("Sidecar export failed for %s: %s", path, exc)


def export_book(
    db: Session,
    book: Book,
    formats: list[str],
    *,
    covers: bool = False,
    overwrite_foreign: bool = False,
    only_existing: bool = False,
) -> ExportResult:
    """Write one book's sidecars.

    ``only_existing`` is the refresh posture: update the sidecars this book
    already has and create none. See :func:`refresh_existing`.
    """
    result = ExportResult()
    if not formats:
        return result

    if not os.path.isfile(book.filepath):
        # The content file is gone (a pending cleanup, a missing mount). Writing
        # a sidecar next to nothing would litter the library with orphans.
        result.skipped_missing += 1
        return result

    cover_name = None
    if covers and not only_existing:
        cover_name = _write_cover(book, result, overwrite_foreign=overwrite_foreign)
    elif covers:
        stem, _ = os.path.splitext(book.filepath)
        existing_cover = stem + _COVER_SUFFIX
        if os.path.isfile(existing_cover):
            cover_name = _write_cover(book, result, overwrite_foreign=True)

    fields = book_fields(db, book, cover_filename=cover_name)

    for fmt in formats:
        path = sidecar_path(book.filepath, fmt)
        if only_existing and not os.path.exists(path):
            continue
        ok, reason = _may_write(path, overwrite_foreign=overwrite_foreign)
        if not ok:
            result.skipped_foreign += 1
            message = f"{os.path.basename(path)}: {reason}"
            if message not in result.errors and len(result.errors) < 20:
                result.errors.append(message)
            continue
        try:
            _atomic_write(path, render(fields, fmt))
            result.written += 1
        except OSError as exc:
            _record_failure(result, path, exc)

    return result


def refresh_existing(db: Session, book: Book) -> ExportResult:
    """Update the sidecars a book already has, creating none.

    Called after a metadata edit has been **committed** — never inside the
    transaction, or a later rollback would leave a sidecar describing metadata
    that was never saved.

    Silent by design when export is off or the book has no sidecars, which is
    the overwhelmingly common case; the cost is one settings read.
    """
    formats = export_settings.enabled_formats(db)
    if not formats:
        return ExportResult()
    return export_book(
        db,
        book,
        formats,
        covers=export_settings.covers_enabled(db),
        overwrite_foreign=True,  # only touches files that already exist
        only_existing=True,
    )


def refresh_existing_safe(db: Session, book: Book) -> None:
    """:func:`refresh_existing` that cannot break its caller.

    The metadata save has already been committed by the time this runs, so a
    sidecar problem must not surface as a failed edit. Everything is caught,
    including the unexpected — a broken export is a logged annoyance, a 500 on a
    successful save is a bug.
    """
    try:
        refresh_existing(db, book)
    except Exception:  # noqa: BLE001 - a sidecar must never fail the edit
        logger.exception("Sidecar refresh failed for book %s", getattr(book, "id", "?"))


def export_library(
    db: Session,
    formats: Optional[list[str]] = None,
    *,
    covers: Optional[bool] = None,
    overwrite_foreign: Optional[bool] = None,
    progress: Optional[object] = None,
) -> ExportResult:
    """Backfill sidecars for every indexed book.

    Committed per batch rather than at the end: a run over a large library that
    dies partway should leave the sidecars it already wrote, and those are files
    on disk regardless — the commits here are only for the session's own state.
    """
    if formats is None:
        formats = export_settings.enabled_formats(db)
    if covers is None:
        covers = export_settings.covers_enabled(db)
    if overwrite_foreign is None:
        overwrite_foreign = export_settings.overwrite_foreign(db)

    total = ExportResult()
    if not formats:
        return total

    books = db.query(Book).filter_by(is_missing=False).order_by(Book.id).all()
    for index, book in enumerate(books, start=1):
        total.merge(
            export_book(
                db,
                book,
                formats,
                covers=covers,
                overwrite_foreign=overwrite_foreign,
            )
        )
        if total.read_only:
            # The mount is read-only; every remaining book fails identically.
            # Stopping keeps one actionable error instead of thousands.
            logger.warning("Stopping sidecar export: library is read-only")
            break
        if progress is not None and hasattr(progress, "__call__"):
            progress(index, len(books))  # type: ignore[operator]

    return total
