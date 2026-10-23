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
    _COMIC_INFO_SIZE_CAP,
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


def _member_names(filepath: str, arc_ext: str) -> list[str]:
    """Every file member's name, in archive order. Raises if it can't be opened."""
    if arc_ext in (".cbz", ".zip"):
        with zipfile.ZipFile(filepath) as zf:
            return zf.namelist()
    if arc_ext in (".cbr", ".rar"):
        import rarfile

        with rarfile.RarFile(filepath) as rf:
            return rf.namelist()
    if arc_ext in (".cb7", ".7z"):
        import py7zr

        with py7zr.SevenZipFile(filepath) as zf:
            return zf.getnames()
    if arc_ext in (".cbt", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"):
        with tarfile.open(filepath) as tf:
            return [m.name for m in tf.getmembers() if m.isfile()]
    return []


def list_pages(filepath: str, arc_ext: str) -> list[str]:
    """Return the page-image member names inside a comic archive, in order.

    Returns [] if the archive can't be opened or holds no images. Never raises.
    """
    try:
        return _sorted_image_names(_member_names(filepath, arc_ext))
    except Exception as exc:
        logger.debug(f"Could not list pages in comic archive '{filepath}': {exc}")
    return []


def page_count(filepath: str, arc_ext: str) -> int:
    """Number of page images in a comic archive (0 if unreadable)."""
    return len(list_pages(filepath, arc_ext))


def _within_size_cap(
    archive: object, name: str, filepath: str, cap: int = _COMIC_PAGE_SIZE_CAP
) -> bool:
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
    if size is not None and size > cap:
        logger.warning(
            f"Comic member '{name}' in '{filepath}' is {size} bytes, over the "
            f"{cap}-byte cap - refusing to extract."
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
        data = _read_member(filepath, arc_ext, name, _COMIC_PAGE_SIZE_CAP)
        return (data, page_mime(name)) if data is not None else None
    except Exception as exc:
        logger.debug(f"Could not read page {index} from comic archive '{filepath}': {exc}")
    return None


def read_comic_info(filepath: str, arc_ext: str) -> Optional[bytes]:
    """The archive's ``ComicInfo.xml`` (the ComicRack metadata file), or None.

    The root-level copy wins over one nested in a folder. Capped at
    ``_COMIC_INFO_SIZE_CAP`` - the file is a few kilobytes of XML. Never raises.
    """
    try:
        names = sorted(
            (
                n
                for n in _member_names(filepath, arc_ext)[:_ARCHIVE_LIST_CAP]
                if Path(n).name.lower() == "comicinfo.xml" and "__MACOSX" not in n
            ),
            key=lambda n: (n.count("/"), n.lower()),
        )
        if not names:
            return None
        data = _read_member(filepath, arc_ext, names[0], _COMIC_INFO_SIZE_CAP)
        return data if data is not None and len(data) <= _COMIC_INFO_SIZE_CAP else None
    except Exception as exc:
        logger.debug(f"Could not read ComicInfo.xml from '{filepath}': {exc}")
    return None


def _read_member(filepath: str, arc_ext: str, name: str, cap: int) -> Optional[bytes]:
    """One member's bytes, or None when it is over ``cap``. Raises on a bad archive."""
    if arc_ext in (".cbz", ".zip"):
        with zipfile.ZipFile(filepath) as zf:
            return zf.read(name) if _within_size_cap(zf, name, filepath, cap) else None
    if arc_ext in (".cbr", ".rar"):
        import rarfile

        with rarfile.RarFile(filepath) as rf:
            return rf.read(name) if _within_size_cap(rf, name, filepath, cap) else None
    if arc_ext in (".cb7", ".7z"):
        import py7zr

        from .thumbnails import _extract_7z_member

        with py7zr.SevenZipFile(filepath) as zf:
            return _extract_7z_member(zf, name)
    if arc_ext in (".cbt", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"):
        with tarfile.open(filepath) as tf:
            member = tf.getmember(name)
            if not _within_size_cap(tf, name, filepath, cap):
                return None
            fh = tf.extractfile(member)
            return fh.read() if fh is not None else None
    return None
