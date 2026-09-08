"""Registering maps, tokens, and audio.

Maps and tokens differ only in their extension set, model, and thumbnail size,
so both run through ``_scan_media``; audio gets its own walk because it carries
embedded tags and folder artwork rather than a rendered thumbnail. All three are
flat walks — unlike books there is no container or category structure above the
file, so the folder path becomes the collection name and nothing more.

Patch-safety: ``generate_thumbnail`` is stubbed by tests via
``patch("backend.indexer.…")`` and so is called through the package namespace
(``indexer.NAME``).
"""
import logging
import os
import re
from pathlib import Path
from typing import Any, Callable, Optional

from sqlalchemy.exc import IntegrityError

from backend import indexer  # package namespace, for patch-sensitive calls
from ._context import _ScanContext, _prune_dirs, _title_from_filename
from ._subprocess import _run_with_timeout
from .constants import (
    AUDIO_EXTS,
    MAP_VIDEO_EXTS,
    MEDIA_ARCHIVE_EXTS,
    VTT_DATA_EXTS,
    _DB_TIMEOUT,
)
from .hashing import file_signature, hash_file
from .metadata import _find_folder_artwork, _read_audio_metadata
from .models3d import THUMBNAILABLE_EXTS as MODEL_THUMBNAIL_EXTS
from .thumbnails import archive_ext
from ..models import Audio

logger = logging.getLogger("grimoire.indexer")


def _needs_thumbnail_backfill(existing: Any, ext: str, arc_ext: str) -> bool:
    """True when a registered media row could have a thumbnail but does not.

    Two formats answer yes, both for the same reason: they were registered as
    opaque before the thumbnailer could read them, so existing rows sit at
    has_thumbnail=0 with no way to recover. Universal VTT maps carry the
    battlemap as base64 inside the JSON; animated maps (.webm/.mp4) now get a
    decoded frame from the bundled decode-only ffmpeg. Archives stay excluded —
    they are opaque by design, not by a missing decoder.

    Guarded on the flag rather than on file state, so a genuinely un-thumbnailed
    file is retried at most once per scan and a successful row is never redone.
    """
    if arc_ext or getattr(existing, "has_thumbnail", False):
        return False
    return ext in VTT_DATA_EXTS or ext in MAP_VIDEO_EXTS


def _needs_model_thumbnail_requeue(existing: Any, ext: str) -> bool:
    """True when a registered model has no preview and nothing pending to make one.

    Separate from ``_needs_thumbnail_backfill`` because the remedy differs: a map
    is rasterised inline, while a mesh belongs on the deferred queue. Re-flagging
    is all that is needed — the queue does the work once the walk is done.

    This is what lets an existing library recover. Models registered while the
    renderer refused them (a triangle count over the old cap, or a scan whose
    queue never ran) sit at has_thumbnail=0 *and* thumbnail_pending=0, which no
    code path revisits, so they would stay preview-less through every future
    rescan.
    """
    if ext not in MODEL_THUMBNAIL_EXTS:
        return False
    if getattr(existing, "has_thumbnail", False):
        return False
    return not getattr(existing, "thumbnail_pending", False)


def _scan_media(
    ctx: _ScanContext,
    walk_dir: Path,
    section: str,
    exts: set,
    model: Any,
    thumb_size: tuple,
    enrich: Optional[Callable[[Any, str], None]] = None,
) -> None:
    """Shared walk for maps and tokens (image files → thumbnailed records).

    Archives (zip/rar/7z/tar) are registered too (issue #250) — map packs and art
    collections are often distributed zipped alongside supplementary files. They
    are opaque: no thumbnail is generated, since there is no image to render.

    ``enrich`` is called with a freshly built record and its path before the
    insert, for collections carrying columns the shared walk knows nothing about
    (a 3D model's triangle count and presupported flag). It is deliberately a
    hook rather than a fourth branch here: audio has its own walk only because
    its metadata read is heavyweight, and reading an STL header is not.

    Returns early if a stop is requested mid-walk.
    """
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    for root, dirs, files in os.walk(walk_dir):
        dirs[:] = _prune_dirs(root, dirs, ignore)

        for filename in sorted(files):
            if filename.startswith("."):
                continue

            filepath = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()
            # archive_ext handles two-part suffixes (.tar.gz) that Path.suffix
            # cannot, so match on it rather than on `ext`.
            arc_ext = archive_ext(filename)

            if ext not in exts and arc_ext not in MEDIA_ARCHIVE_EXTS:
                continue

            if ignore.is_ignored(filepath, is_dir=False):
                logger.debug(f"Ignored by .grimoireignore: {filepath}")
                continue

            ctx.scanned[section] += 1
            ctx.emit_progress()
            if ctx.stop_requested():
                logger.debug(f"scan_library: stop requested during {section} scan.")
                return

            relative_path = os.path.relpath(filepath, ctx.library_path)
            singular = section[:-1]

            logger.debug(
                f"Scanning {singular} ({ctx.scanned[section]}/{ctx.totals[section]}): {filepath}"
            )
            logger.debug(f"DB: querying existing {singular} '{filepath}'")
            try:
                existing = _run_with_timeout(
                    lambda fp=filepath: session.query(model).filter_by(filepath=fp).first(),
                    _DB_TIMEOUT,
                    f"query {singular} '{filepath}'",
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} - skipping '{filename}'")
                stats["errors"] += 1
                continue
            title = _title_from_filename(filename)

            if existing:
                # Backfill a thumbnail for a record registered before its format
                # was thumbnailable. A Universal VTT map scanned by an older
                # build sits at has_thumbnail=0 even though the battlemap is
                # embedded in the file, and the walk would otherwise skip it
                # forever — existing rows never re-enter the insert path below.
                # Mirrors the same backfill for books (see books.py).
                # A mesh with no preview goes back on the deferred queue rather
                # than being rasterised here: it is the expensive case, and the
                # queue already exists to keep it out of the walk.
                if _needs_model_thumbnail_requeue(existing, ext):
                    existing.thumbnail_pending = True
                    try:
                        _run_with_timeout(
                            session.commit,
                            _DB_TIMEOUT,
                            f"commit {singular} requeue '{filepath}'",
                        )
                        logger.debug(f"Requeued model preview: {filepath}")
                    except TimeoutError as e:
                        logger.error(f"DB hang: {e} - rolling back '{filename}'")
                        session.rollback()
                    continue
                if _needs_thumbnail_backfill(existing, ext, arc_ext):
                    thumb_path = ctx.thumb_path(section, title, filepath)
                    logger.debug(f"Backfilling thumbnail: {filepath}")
                    if indexer.generate_thumbnail(
                        filepath, thumb_path, size=thumb_size, should_stop=ctx.should_stop
                    ):
                        existing.has_thumbnail = True
                        try:
                            _run_with_timeout(
                                session.commit,
                                _DB_TIMEOUT,
                                f"commit {singular} thumbnail '{filepath}'",
                            )
                            stats[f"updated_{section}"] += 1
                        except TimeoutError as e:
                            logger.error(f"DB hang: {e} - rolling back '{filename}'")
                            session.rollback()
                    continue
                logger.debug(f"Already registered, skipping: {filename}")
                continue

            signature = file_signature(filepath)
            if signature is None:
                logger.warning(f"Cannot stat file, skipping: {filepath}")
                continue
            file_mtime, file_size = signature

            record = model(
                filename=filename,
                filepath=filepath,
                relative_path=relative_path,
                file_size=file_size,
                file_mtime=file_mtime,
                # Hashed once on insert so a later move of this file is
                # recognised rather than read as a delete plus an add.
                content_hash=hash_file(filepath, should_stop=ctx.should_stop),
            )

            if enrich is not None:
                enrich(record, filepath)

            # Archives are the only opaque case left: there is no single image
            # in a map pack to call the cover. Universal VTT files carry the
            # battlemap as base64 inside the JSON, and animated maps decode to a
            # frame, so both thumbnail like any other image.
            if not arc_ext and not getattr(record, "thumbnail_pending", False):
                thumb_path = ctx.thumb_path(section, title, filepath)
                logger.debug(f"Generating thumbnail: {filepath}")
                if indexer.generate_thumbnail(
                    filepath, thumb_path, size=thumb_size, should_stop=ctx.should_stop
                ):
                    record.has_thumbnail = True
                elif ext in MODEL_THUMBNAIL_EXTS:
                    # A mesh judged small enough to rasterise inline still runs
                    # against the scan's 30s budget, and that budget is sized for
                    # this machine, not the slowest NAS Grimoire runs on. When it
                    # is missed there is nothing else to try — an unflagged model
                    # with no thumbnail is revisited by no code path — so hand it
                    # to the deferred queue, which has minutes rather than
                    # seconds. A mesh that is genuinely unreadable fails there
                    # too, once, and has its flag cleared for good.
                    logger.debug(f"Inline mesh render failed, deferring: {filepath}")
                    record.thumbnail_pending = True

            session.add(record)
            logger.debug(f"DB: committing new {singular} '{filename}'")
            try:
                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit {singular} '{filepath}'")
                ctx.inserted_ids.add(record.id)
                stats[f"new_{section}"] += 1
                logger.info(f"Added {singular}: {title}")
            except TimeoutError as e:
                logger.error(f"DB hang: {e} - rolling back '{filename}'")
                session.rollback()
                stats["errors"] += 1
            except IntegrityError:
                session.rollback()
                logger.debug(f"{singular.capitalize()} already exists, skipping: {filepath}")


def _scan_audio(ctx: _ScanContext, walk_dir: Path) -> None:
    """Walk the audio tree, registering tracks with their metadata and artwork flag."""
    session = ctx.session
    ignore = ctx.ignore
    stats = ctx.stats
    for root, dirs, files in os.walk(walk_dir):
        dirs[:] = _prune_dirs(root, dirs, ignore)

        for filename in sorted(files):
            if filename.startswith("."):
                continue

            filepath = os.path.join(root, filename)
            ext = Path(filename).suffix.lower()
            arc_ext = archive_ext(filename)

            if ext not in AUDIO_EXTS and arc_ext not in MEDIA_ARCHIVE_EXTS:
                continue

            if ignore.is_ignored(filepath, is_dir=False):
                logger.debug(f"Ignored by .grimoireignore: {filepath}")
                continue

            ctx.scanned["audio"] += 1
            ctx.emit_progress()
            if ctx.stop_requested():
                logger.debug("scan_library: stop requested during audio scan.")
                return

            relative_path = os.path.relpath(filepath, ctx.library_path)

            logger.debug(
                f"Scanning audio ({ctx.scanned['audio']}/{ctx.totals['audio']}): {filepath}"
            )
            logger.debug(f"DB: querying existing audio '{filepath}'")
            try:
                existing = _run_with_timeout(
                    lambda fp=filepath: session.query(Audio).filter_by(filepath=fp).first(),
                    _DB_TIMEOUT,
                    f"query audio '{filepath}'",
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} - skipping '{filename}'")
                stats["errors"] += 1
                continue
            if existing:
                logger.debug(f"Already registered, skipping: {filename}")
                continue

            signature = file_signature(filepath)
            if signature is None:
                logger.warning(f"Cannot stat file, skipping: {filepath}")
                continue
            file_mtime, file_size = signature

            # Archives carry no tags/duration and no embedded art (issue #250):
            # register them as opaque, downloadable items with empty metadata.
            if arc_ext:
                meta = {"duration": 0.0, "title": "", "artist": "", "album": "", "embedded_art": None}
                has_artwork = False
            else:
                meta = _read_audio_metadata(filepath)
                has_artwork = bool(meta["embedded_art"]) or _find_folder_artwork(root) is not None

            track = Audio(
                filename=filename,
                filepath=filepath,
                relative_path=relative_path,
                file_size=file_size,
                file_mtime=file_mtime,
                # Hashed once on insert — see the note in _scan_media.
                content_hash=hash_file(filepath, should_stop=ctx.should_stop),
                duration=meta["duration"],
                title=meta["title"],
                artist=meta["artist"],
                album=meta["album"],
                has_artwork=has_artwork,
            )

            session.add(track)
            logger.debug(f"DB: committing new audio '{filename}'")
            try:
                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit audio '{filepath}'")
                ctx.inserted_ids.add(track.id)
                stats["new_audio"] += 1
                logger.info(f"Added audio: {meta['title'] or filename}")
            except TimeoutError as e:
                logger.error(f"DB hang: {e} - rolling back '{filename}'")
                session.rollback()
                stats["errors"] += 1
            except IntegrityError:
                session.rollback()
                logger.debug(f"Audio already exists, skipping: {filepath}")


# Presupported/unsupported detection. Checked against the filename *and* the
# folder path above it, because the near-universal convention on model sites is
# folder-level — ``Goblins/Presupported/goblin_a.stl`` — rather than per file.
#
# Order matters and is not incidental: "unsupported" contains "supported", so a
# naive supported-first check labels every unsupported file as presupported.
# _UNSUPPORTED is always tried first, and the supported pattern deliberately
# does not match a bare "supported" preceded by "un".
_UNSUPPORTED_RE = re.compile(
    r"(?:^|[\W_])(?:un[\s_-]?supported|unsup|no[\s_-]?supports?|raw)(?:$|[\W_])",
    re.I,
)
_PRESUPPORTED_RE = re.compile(
    r"(?:^|[\W_])(?:pre[\s_-]?supported|presup|supported|supports?|sup)(?:$|[\W_])",
    re.I,
)


def _detect_support(relative_path: str) -> Optional[bool]:
    """True presupported, False unsupported, None when the name says nothing.

    Deliberately tri-state rather than defaulting to False: a library that does
    not use the convention would otherwise have every model asserting it ships
    without supports, which is a claim the scan cannot make.
    """
    text = relative_path.replace("\\", "/")
    if _UNSUPPORTED_RE.search(text):
        return False
    if _PRESUPPORTED_RE.search(text):
        return True
    return None


def _enrich_model(record: Any, filepath: str) -> None:
    """Fill the 3D-specific columns on a freshly built model row.

    All three reads are cheap by construction: the triangle count comes from the
    binary STL's 84-byte header rather than a parse, the support flag is a regex
    over the path we already have, and the deferral decision follows from the
    count.

    A mesh past ``INLINE_TRIANGLE_BUDGET`` is flagged rather than rendered here.
    Rasterising happens in Python, so a 4M-triangle scan costs tens of seconds —
    time the library walk should not spend. The deferred thumbnail queue picks it
    up once the fast phases are done, exactly as image-only PDFs are handed to
    the deferred-OCR queue.
    """
    from .stl_render import INLINE_TRIANGLE_BUDGET, MAX_TRIANGLES, triangle_count

    count = triangle_count(filepath)
    record.triangle_count = count
    record.is_supported = _detect_support(record.relative_path or filepath)
    # 0 means "not a binary STL" (an ASCII mesh, or a format with no parser), so
    # it says nothing about weight and must not be read as "small".
    record.thumbnail_pending = INLINE_TRIANGLE_BUDGET < count <= MAX_TRIANGLES
