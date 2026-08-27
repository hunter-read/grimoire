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
from pathlib import Path
from typing import Any

from sqlalchemy.exc import IntegrityError

from backend import indexer  # package namespace, for patch-sensitive calls
from ._context import _ScanContext, _prune_dirs, _title_from_filename
from ._subprocess import _run_with_timeout
from .constants import AUDIO_EXTS, MAP_OPAQUE_EXTS, MEDIA_ARCHIVE_EXTS, _DB_TIMEOUT
from .hashing import file_signature, hash_file
from .metadata import _find_folder_artwork, _read_audio_metadata
from .thumbnails import archive_ext
from ..models import Audio

logger = logging.getLogger("grimoire.indexer")


def _scan_media(
    ctx: _ScanContext,
    walk_dir: Path,
    section: str,
    exts: set,
    model: Any,
    thumb_size: tuple,
) -> None:
    """Shared walk for maps and tokens (image files → thumbnailed records).

    Archives (zip/rar/7z/tar) are registered too (issue #250) — map packs and art
    collections are often distributed zipped alongside supplementary files. They
    are opaque: no thumbnail is generated, since there is no image to render.

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
            if existing:
                logger.debug(f"Already registered, skipping: {filename}")
                continue

            title = _title_from_filename(filename)

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

            # Archives, videos and VTT data files are opaque blobs — nothing
            # to render a thumbnail from without a decoder we do not ship.
            if not arc_ext and ext not in MAP_OPAQUE_EXTS:
                thumb_path = ctx.thumb_path(section, title, filepath)
                logger.debug(f"Generating thumbnail: {filepath}")
                if indexer.generate_thumbnail(
                    filepath, thumb_path, size=thumb_size, should_stop=ctx.should_stop
                ):
                    record.has_thumbnail = True

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
