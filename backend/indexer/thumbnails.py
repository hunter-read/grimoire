"""Archive cover extraction and thumbnail generation.

Covers comic-book archive cover images (CBZ/CBR/CB7/CBT) and the timeout-guarded
thumbnail worker used for PDFs, images, and comic covers during a scan.
"""
import io
import os
import logging
import tarfile
import threading
import zipfile
from pathlib import Path
from typing import Any, Callable, Optional

import fitz  # PyMuPDF
from PIL import Image

from .constants import (
    ARCHIVE_EXTS,
    IMAGE_EXTS,
    _ARCHIVE_LIST_CAP,
    _ARCHIVE_MEMBER_SIZE_CAP,
    _ARCHIVE_MIME,
    _COMIC_ARCHIVE_EXTS,
    _THUMBNAIL_TIMEOUT,
)

logger = logging.getLogger("grimoire.indexer")


def archive_ext(filename: str) -> str:
    """Return the archive extension for *filename* (lowercased), or "".

    Handles two-part suffixes like ``.tar.gz``/``.tar.bz2`` that
    ``Path.suffix`` cannot, falling back to the single suffix otherwise.
    """
    lower = filename.lower()
    for ext in (".tar.gz", ".tar.bz2"):
        if lower.endswith(ext):
            return ext
    suffix = Path(lower).suffix
    return suffix if suffix in ARCHIVE_EXTS else ""


def archive_mime(arc_ext: str) -> str:
    """Return a MIME type for a known archive extension (falls back to octet-stream)."""
    return _ARCHIVE_MIME.get(arc_ext, "application/octet-stream")


def _extract_7z_member(zf: Any, name: str) -> Optional[bytes]:
    """Read a single member out of an open py7zr archive as bytes.

    Tolerant of the py7zr 0.x/1.x API split: 1.x removed ``SevenZipFile.read()``
    in favour of extracting through a ``BytesIOFactory``, while 0.x still has
    ``read()``. Try the factory path first, fall back to ``read()``, so the cover
    extraction works whichever version is installed. Returns None on any failure.
    """
    # py7zr 1.x: extract the chosen member into memory via BytesIOFactory.
    try:
        from py7zr.io import BytesIOFactory

        factory = BytesIOFactory(limit=_ARCHIVE_MEMBER_SIZE_CAP)
        zf.extract(targets=[name], factory=factory)
        bio = factory.get(name)
        if bio is not None:
            bio.seek(0)
            return bio.read()
        return None
    except ImportError:
        # py7zr < 1.0 has no py7zr.io.BytesIOFactory; fall through to the
        # 0.x read() API below. Any other error propagates.
        pass

    # py7zr 0.x: SevenZipFile.read() returns {name: BytesIO}.
    zf.reset()
    data = zf.read([name])
    bio = data.get(name) if data else None
    if bio is not None:
        bio.seek(0)
        return bio.read()
    return None


def _first_image_from_archive(filepath: str, arc_ext: str) -> Optional[bytes]:
    """Return the raw bytes of the first image inside a comic-book archive.

    Entries are considered in case-insensitive name order (the usual page
    ordering for CBZ/CBR), and only the single chosen member is decompressed.
    Returns None if the archive can't be opened or holds no image.  Never
    raises — callers treat a None as "no cover available".
    """
    try:
        if arc_ext in (".cbz", ".zip"):
            with zipfile.ZipFile(filepath) as zf:
                names = [n for n in zf.namelist()[:_ARCHIVE_LIST_CAP] if not n.endswith("/")]
                for name in sorted(names, key=str.lower):
                    if Path(name).suffix.lower() in IMAGE_EXTS:
                        return zf.read(name)
        elif arc_ext in (".cbr", ".rar"):
            import rarfile

            with rarfile.RarFile(filepath) as rf:
                names = [n for n in rf.namelist()[:_ARCHIVE_LIST_CAP]]
                for name in sorted(names, key=str.lower):
                    if Path(name).suffix.lower() in IMAGE_EXTS:
                        return rf.read(name)
        elif arc_ext in (".cb7", ".7z"):
            import py7zr

            with py7zr.SevenZipFile(filepath) as zf:
                names = [n for n in zf.getnames()[:_ARCHIVE_LIST_CAP]]
                targets = sorted(
                    (n for n in names if Path(n).suffix.lower() in IMAGE_EXTS),
                    key=str.lower,
                )
                if targets:
                    return _extract_7z_member(zf, targets[0])
        elif arc_ext in (".cbt", ".tar", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2"):
            with tarfile.open(filepath) as tf:
                members = [m for m in tf.getmembers() if m.isfile()]
                for member in sorted(members, key=lambda m: m.name.lower()):
                    if Path(member.name).suffix.lower() in IMAGE_EXTS:
                        fh = tf.extractfile(member)
                        return fh.read() if fh is not None else None
    except Exception as exc:
        logger.debug(f"Could not read cover image from archive '{filepath}': {exc}")
    return None


def _generate_thumbnail_task(
    filepath: str, output_path: str, size: tuple, result: list, exc: list
) -> None:
    """Worker executed in a daemon thread by generate_thumbnail."""
    try:
        ext = Path(filepath).suffix.lower()
        arc_ext = archive_ext(filepath)
        if arc_ext in _COMIC_ARCHIVE_EXTS:
            data = _first_image_from_archive(filepath, arc_ext)
            if data is None:
                result[0] = False
                return
            img = Image.open(io.BytesIO(data))
            if img.mode != "RGB":
                img = img.convert("RGB")
        elif ext == ".pdf":
            doc = fitz.open(filepath)
            if len(doc) == 0:
                result[0] = False
                return
            page = doc[0]
            mat = fitz.Matrix(2, 2)
            pix = page.get_pixmap(matrix=mat, alpha=False)
            img = Image.frombytes("RGB", [pix.width, pix.height], pix.samples)
            doc.close()
        elif ext in IMAGE_EXTS:
            img = Image.open(filepath)
            if img.mode != "RGB":
                img = img.convert("RGB")
        else:
            result[0] = False
            return

        img.thumbnail(size, Image.LANCZOS)
        os.makedirs(os.path.dirname(output_path), exist_ok=True)
        img.save(output_path, "WEBP", quality=80)
        result[0] = True
    except Exception as e:
        exc[0] = e


def generate_thumbnail(
    filepath: str,
    output_path: str,
    size: tuple = (300, 400),
    should_stop: Optional[Callable[[], bool]] = None,
) -> bool:
    """Generate a thumbnail from the first page of a PDF or from an image.

    Runs in a daemon thread with a timeout so a corrupt or pathologically large
    file cannot hang the scan indefinitely.  If `should_stop` is provided the
    wait is also interrupted when it returns True.
    """
    result = [None]
    exc = [None]
    t = threading.Thread(
        target=_generate_thumbnail_task,
        args=(filepath, output_path, size, result, exc),
        daemon=True,
    )
    t.start()
    poll_interval = 0.5
    elapsed = 0.0
    while t.is_alive() and elapsed < _THUMBNAIL_TIMEOUT:
        t.join(poll_interval)
        elapsed += poll_interval
        if should_stop and should_stop():
            logger.warning(f"Thumbnail generation aborted by stop request for {filepath}")
            return False
    if t.is_alive():
        logger.error(f"Thumbnail generation timed out after {_THUMBNAIL_TIMEOUT}s for {filepath}")
        return False
    if exc[0] is not None:
        logger.error(f"Thumbnail generation failed for {filepath}: {exc[0]}")
        return False
    return bool(result[0])
