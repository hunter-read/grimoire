"""Comic-book archive paging: CBZ/CBR/CB7/CBT (issue #180).

A comic archive is just an ordered pile of page images in a zip/rar/7z/tar
wrapper. ``thumbnails._first_image_from_archive`` already pulls the cover out of
one; this module generalises that to the whole book — list the pages, and fetch
page *n* on demand — so the reader can page through a ``.cbz`` the way it pages
through a PDF.

Only the requested member is ever decompressed. Listings are capped
(``_ARCHIVE_LIST_CAP``) and single members are size-capped
(``_COMIC_PAGE_SIZE_CAP``) so a malicious archive can't exhaust memory.

Page order is case-insensitive filename order, which is the convention comic
archives are built on (``page01.jpg``, ``page02.jpg``, …).
"""
import logging
import tarfile
import zipfile
from pathlib import Path
from typing import Optional

from .constants import (
    _ARCHIVE_LIST_CAP,
    _COMIC_PAGE_SIZE_CAP,
    IMAGE_EXTS,
)

logger = logging.getLogger("grimoire.indexer")

# MIME type served for each page-image extension found inside an archive.
_PAGE_MIME = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".bmp": "image/bmp",
    ".tiff": "image/tiff",
}


def page_mime(name: str) -> str:
    """MIME type for a page image inside a comic archive."""
    return _PAGE_MIME.get(Path(name).suffix.lower(), "application/octet-stream")


def _sorted_image_names(names: list[str]) -> list[str]:
    """Filter an archive listing to page images in reading order.

    Hidden files and macOS ``__MACOSX`` resource-fork entries are dropped — they
    are packaging noise that would otherwise show up as duplicate or blank pages.
    """
    pages = [
        n
        for n in names[:_ARCHIVE_LIST_CAP]
        if not n.endswith("/")
        and Path(n).suffix.lower() in IMAGE_EXTS
        and not Path(n).name.startswith(".")
        and "__MACOSX" not in n
    ]
    return sorted(pages, key=str.lower)


def list_pages(filepath: str, arc_ext: str) -> list[str]:
    """Return the page-image member names inside a comic archive, in order.

    Returns [] if the archive can't be opened or holds no images. Never raises.
    """
    try:
        if arc_ext in (".cbz", ".zip"):
            with zipfile.ZipFile(filepath) as zf:
                return _sorted_image_names(zf.namelist())
        if arc_ext in (".cbr", ".rar"):
            import rarfile

            with rarfile.RarFile(filepath) as rf:
                return _sorted_image_names(rf.namelist())
        if arc_ext in (".cb7", ".7z"):
            import py7zr

            with py7zr.SevenZipFile(filepath) as zf:
                return _sorted_image_names(zf.getnames())
        if arc_ext in (".cbt", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"):
            with tarfile.open(filepath) as tf:
                return _sorted_image_names([m.name for m in tf.getmembers() if m.isfile()])
    except Exception as exc:
        logger.debug(f"Could not list pages in comic archive '{filepath}': {exc}")
    return []


def page_count(filepath: str, arc_ext: str) -> int:
    """Number of page images in a comic archive (0 if unreadable)."""
    return len(list_pages(filepath, arc_ext))


def _within_size_cap(archive: object, name: str, filepath: str) -> bool:
    """True when the named member is small enough to decompress into memory.

    The declared size is read through whichever ``getinfo``/``getmember`` the
    archive class offers. An archive class that exposes neither is allowed
    through rather than refused: the cap is a guard against decompression bombs
    in known formats, not an access-control check, and failing closed here would
    break otherwise-readable archives.
    """
    size = None
    try:
        if hasattr(archive, "getinfo"):
            info = archive.getinfo(name)  # type: ignore[attr-defined]
            size = getattr(info, "file_size", None)
        elif hasattr(archive, "getmember"):
            size = getattr(archive.getmember(name), "size", None)  # type: ignore[attr-defined]
    except Exception as exc:
        logger.debug(f"Could not read member size for '{name}' in '{filepath}': {exc}")
        return True
    if size is not None and size > _COMIC_PAGE_SIZE_CAP:
        logger.warning(
            f"Comic page in '{filepath}' is {size} bytes, over the "
            f"{_COMIC_PAGE_SIZE_CAP}-byte cap - refusing to extract."
        )
        return False
    return True


def read_page(filepath: str, arc_ext: str, index: int) -> Optional[tuple[bytes, str]]:
    """Return ``(image_bytes, mime_type)`` for 1-based page *index*, or None.

    Only the single requested member is decompressed. Returns None when the
    archive is unreadable or the index is out of range. Never raises.
    """
    names = list_pages(filepath, arc_ext)
    if index < 1 or index > len(names):
        return None
    name = names[index - 1]
    try:
        if arc_ext in (".cbz", ".zip"):
            with zipfile.ZipFile(filepath) as zf:
                if not _within_size_cap(zf, name, filepath):
                    return None
                return zf.read(name), page_mime(name)
        if arc_ext in (".cbr", ".rar"):
            import rarfile

            with rarfile.RarFile(filepath) as rf:
                if not _within_size_cap(rf, name, filepath):
                    return None
                return rf.read(name), page_mime(name)
        if arc_ext in (".cb7", ".7z"):
            import py7zr

            from .thumbnails import _extract_7z_member

            with py7zr.SevenZipFile(filepath) as zf:
                data = _extract_7z_member(zf, name)
                return (data, page_mime(name)) if data is not None else None
        if arc_ext in (".cbt", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"):
            with tarfile.open(filepath) as tf:
                member = tf.getmember(name)
                if not _within_size_cap(tf, name, filepath):
                    return None
                fh = tf.extractfile(member)
                if fh is None:
                    return None
                return fh.read(), page_mime(name)
    except Exception as exc:
        logger.debug(f"Could not read page {index} from comic archive '{filepath}': {exc}")
    return None
