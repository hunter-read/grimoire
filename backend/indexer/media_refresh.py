"""Re-reading a map, token, 3D model or audio track whose file was replaced in place.

The media counterpart of ``refresh_book_file`` (issue #870): an upload with
``on_conflict=replace`` writes new bytes under a path Grimoire already tracks,
and everything the record learned from the old bytes is read again - size,
mtime and content hash, the thumbnail, a model's triangle count, a track's
duration and whether it has artwork. Nothing the user wrote is touched: the
description, tags, variant links, a map's grid override and authored walls, a
track's title and artist all stay as they are, since they are keyed by the
record's id and the id does not change.

Patch-safety: ``generate_thumbnail`` is called through the package namespace
(``indexer.NAME``) so tests can stub it, as in ``media.py``.
"""
import glob
import logging
import os
from typing import Any, Callable, Optional

from backend import indexer  # package namespace, for patch-sensitive calls
from ._context import _title_from_filename, path_hash, thumb_path_for
from .constants import MEDIA_THUMB_SIZES
from .hashing import apply_signature, file_signature, hash_file_signature
from .metadata import _find_folder_artwork, _read_audio_metadata
from .models3d import THUMBNAILABLE_EXTS as MODEL_THUMBNAIL_EXTS
from .thumbnails import archive_ext

logger = logging.getLogger("grimoire.indexer")

# The collections this refreshes: every one but the books trees.
MEDIA_SECTIONS = ("maps", "tokens", "models", "audio")


def refresh_media_file(
    section: str,
    record: Any,
    thumb_dir: str,
    should_stop: Optional[Callable[[], bool]] = None,
) -> None:
    """Re-read what a media record knows about its file. Commits nothing itself.

    ``section`` is the collection (``maps``, ``tokens``, ``models`` or
    ``audio``) and ``thumb_dir`` the thumbnails root. A model whose mesh is too
    heavy to render here is left with ``thumbnail_pending`` set, for the
    deferred preview queue to pick up, exactly as the scan leaves it.
    """
    if section not in MEDIA_SECTIONS:
        raise ValueError(f"Not a media collection: {section}")
    _refresh_signature(record, should_stop)
    if section == "audio":
        _refresh_audio(record)
        return

    if section == "maps":
        # Previews and PDF pages are cached by path, which a replace keeps.
        from ..services.content_cache import invalidate_map_renders

        invalidate_map_renders(record.filepath)

    # The old picture goes first, so a new one that cannot be made leaves the
    # record without a thumbnail rather than showing the replaced file.
    _drop_thumbnails(thumb_dir, section, record.filepath)
    record.has_thumbnail = False
    ext = os.path.splitext(record.filepath)[1].lower()
    if section == "models":
        _refresh_model(record, ext)

    # Archives are opaque - there is no one image in a pack to show - and a
    # heavy mesh waits for the deferred queue.
    if archive_ext(record.filename) or getattr(record, "thumbnail_pending", False):
        return
    thumb_path = thumb_path_for(
        thumb_dir, section, _title_from_filename(record.filename), record.filepath
    )
    if indexer.generate_thumbnail(
        record.filepath, thumb_path, size=MEDIA_THUMB_SIZES[section], should_stop=should_stop
    ):
        record.has_thumbnail = True
    elif section == "models" and ext in MODEL_THUMBNAIL_EXTS:
        # Missed the inline budget: the deferred queue has minutes, not seconds.
        record.thumbnail_pending = True


def _refresh_signature(record: Any, should_stop: Optional[Callable[[], bool]]) -> None:
    """Store the new file's size, mtime and content hash on ``record``.

    The content hash is what the image routes build their ETags from, so this is
    what tells a browser holding the old thumbnail or map image to fetch again.
    """
    hashed = hash_file_signature(record.filepath, should_stop=should_stop)
    if hashed is not None:
        content_hash, mtime, size = hashed
        apply_signature(record, mtime, size, content_hash)
        return
    signature = file_signature(record.filepath)
    if signature is not None:
        apply_signature(record, signature[0], signature[1], None)


def _drop_thumbnails(thumb_dir: str, section: str, filepath: str) -> None:
    """Remove every cached thumbnail of ``filepath``.

    Matched on the path hash, as the serving routes do: a file renamed since it
    was thumbnailed has its thumbnail under the old filename's slug.
    """
    folder = glob.escape(os.path.join(thumb_dir, section))
    pattern = os.path.join(folder, f"*_{path_hash(filepath)}.webp")
    for path in glob.glob(pattern):
        try:
            os.remove(path)
        except OSError as e:
            logger.debug("Could not remove stale thumbnail %s: %s", path, e)


def _refresh_model(record: Any, ext: str) -> None:
    """Re-read a mesh's triangle count, and whether its preview must wait.

    The same reads ``_enrich_model`` makes on insert, less the presupported
    flag: that comes from the path, which a replace keeps, and may have been
    corrected by hand since.
    """
    from .stl_render import INLINE_TRIANGLE_BUDGET, MAX_TRIANGLES, triangle_count

    count = triangle_count(record.filepath)
    record.triangle_count = count
    record.thumbnail_pending = (
        ext in MODEL_THUMBNAIL_EXTS and INLINE_TRIANGLE_BUDGET < count <= MAX_TRIANGLES
    )


def _refresh_audio(record: Any) -> None:
    """Re-read a track's duration, and whether it still has artwork to show.

    The title, artist, album and track numbers read from the tags on insert are
    left alone: they are the fields a user edits, and a replace corrects the
    file, not the listing.
    """
    if archive_ext(record.filename):
        return
    meta = _read_audio_metadata(record.filepath)
    record.duration = meta["duration"]
    # A cover set in the UI wins over the file's own art (see the artwork route).
    record.has_artwork = (
        bool(record.cover_image)
        or bool(meta["embedded_art"])
        or _find_folder_artwork(os.path.dirname(record.filepath)) is not None
    )
