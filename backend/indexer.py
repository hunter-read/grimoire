"""Library scanner, PDF indexer, and metadata fetcher for Grimoire."""

import io
import os
import re
import json
import pickle
import logging
import hashlib
import tarfile
import tempfile
import threading
import multiprocessing
import zipfile
from pathlib import Path
from typing import Optional
from xml.etree import ElementTree
import fitz  # PyMuPDF
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from . import config, ocr
from .models import GameSystem, Book, GenericMap, MapFolder, Token, TokenFolder, Audio, AudioFolder

logger = logging.getLogger("grimoire.indexer")

_FITZ_TIMEOUT = 30   # seconds — files that can't be opened in 30s are unreadable
_DB_TIMEOUT = 30  # seconds — max time to wait for a DB operation before treating it as hung

# Wall-clock budget for extracting text from a single PDF in the isolated
# worker process.  Generous because OCR of a large scanned book is slow; a file
# that can't finish in this window is treated as unindexable rather than allowed
# to stall the scan forever.
_EXTRACT_TIMEOUT = 1800  # seconds (30 min)

# Per-page OCR budget for the deferred-OCR worker.  OCR is checkpointed per page,
# so the whole-book budget no longer applies to scanned PDFs — only a single
# wedged page is abandoned after this, and the book continues to the next page.
_OCR_PAGE_TIMEOUT = 120  # seconds

# Spawn (not fork) a fresh interpreter for the extraction worker.  The app runs
# many threads and holds a SQLite connection; forking that state into a child
# is unsafe, whereas spawn re-imports this module cleanly with no inherited
# locks or file handles.
_MP_CONTEXT = multiprocessing.get_context("spawn")


class PdfExtractionCrashError(Exception):
    """The isolated extraction worker died (segfault, OOM-kill, or timeout).

    Raised by ``extract_text_isolated`` when the child process terminates
    without producing a result — e.g. a native crash inside MuPDF or an
    out-of-memory kill on a low-RAM host.  The caller marks the book failed so
    the file is skipped instead of crashing the server and re-looping the scan.
    """


def _run_with_timeout(fn, timeout: int, label: str):
    """Run fn() in a daemon thread.  Returns its result, or raises TimeoutError if it
    does not complete within `timeout` seconds.  `label` is used in log/error messages."""
    result = [None]
    exc = [None]

    def _worker():
        try:
            result[0] = fn()
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_worker, daemon=True)
    t.start()
    t.join(timeout)
    if t.is_alive():
        raise TimeoutError(f"DB operation timed out after {timeout}s: {label}")
    if exc[0] is not None:
        raise exc[0]
    return result[0]


def _fitz_open_with_timeout(filepath: str, timeout: int = _FITZ_TIMEOUT, should_stop=None):
    """Open a PDF with fitz, raising TimeoutError if it hangs beyond `timeout` seconds.

    If `should_stop` callable is provided, the wait is interrupted early when it
    returns True, raising TimeoutError so the caller can exit cleanly.
    """
    result = [None]
    exc = [None]

    def _open():
        try:
            result[0] = fitz.open(filepath)
        except Exception as e:
            exc[0] = e

    t = threading.Thread(target=_open, daemon=True)
    t.start()
    deadline = timeout
    poll_interval = 0.5  # check stop flag every 500ms
    elapsed = 0.0
    while t.is_alive() and elapsed < deadline:
        t.join(poll_interval)
        elapsed += poll_interval
        if should_stop and should_stop():
            raise TimeoutError(f"fitz.open() aborted by stop request for {filepath}")
    if t.is_alive():
        raise TimeoutError(f"fitz.open() timed out after {timeout}s for {filepath}")
    if exc[0] is not None:
        raise exc[0]
    return result[0]

CATEGORY_MAP = {
    "core": ["core", "rulebook", "rules", "phb", "dmg", "mm", "basic"],
    "supplement": ["supplement", "expansion", "sourcebook", "guide", "companion"],
    "adventure": ["adventure", "module", "campaign", "scenario", "quest"],
    "character-sheet": ["character sheet", "charsheet"],
    "map": ["map", "battlemap", "battle map", "dungeon map"],
    "handout": ["handout", "reference", "cheat", "quick ref", "screen"],
    "homebrew": ["homebrew", "custom", "house rules"],
    "starter-set": ["starter set", "starter kit", "beginner box", "boxed set", "essentials"],
}

# Normalized folder names (after slugify) that are treated as the system-agnostic
# collection. Books placed in any of these folders use their immediate subfolder
# name as the category label instead of going through the normal CATEGORY_MAP.
_SYSTEM_AGNOSTIC_SLUGS = frozenset({
    "system-agnostic",
    "generic",
    "any",
})


def is_system_agnostic_folder(folder_name: str) -> bool:
    """Return True if this top-level books folder should be treated as system-agnostic."""
    return slugify(folder_name) in _SYSTEM_AGNOSTIC_SLUGS

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
PDF_EXTS = {".pdf"}
DOC_EXTS = {".pdf", ".epub", ".djvu"}
MAP_IMAGE_EXTS = IMAGE_EXTS | PDF_EXTS
AUDIO_EXTS = {".mp3", ".ogg", ".opus", ".flac", ".wav", ".m4a", ".aac"}
# Archive files shown alongside books in a category and served/bundled as opaque
# blobs (their contents are not extracted during the scan).  Comic-book variants
# (.cbz/.cbr/.cb7/.cbt) additionally get a first-image thumbnail, see
# generate_thumbnail.  Multi-suffix names (.tar.gz/.tar.bz2) are matched by
# archive_ext() rather than Path.suffix.
ARCHIVE_EXTS = {
    ".zip", ".cbz",
    ".rar", ".cbr",
    ".7z", ".cb7",
    ".tar", ".cbt", ".tar.gz", ".tgz", ".tar.bz2", ".tbz2",
}
# Comic-book archives whose first image is used as a cover thumbnail.
_COMIC_ARCHIVE_EXTS = {".cbz", ".cbr", ".cb7", ".cbt"}
# Basenames (sans extension) treated as folder cover art for audio tracks.
_AUDIO_COVER_STEMS = {"cover", "folder"}


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


_ARCHIVE_MIME = {
    ".zip": "application/zip",
    ".cbz": "application/vnd.comicbook+zip",
    ".rar": "application/vnd.rar",
    ".cbr": "application/vnd.comicbook-rar",
    ".7z": "application/x-7z-compressed",
    ".cb7": "application/x-7z-compressed",
    ".tar": "application/x-tar",
    ".cbt": "application/x-tar",
    ".tar.gz": "application/gzip",
    ".tgz": "application/gzip",
    ".tar.bz2": "application/x-bzip2",
    ".tbz2": "application/x-bzip2",
}


def archive_mime(arc_ext: str) -> str:
    """Return a MIME type for a known archive extension (falls back to octet-stream)."""
    return _ARCHIVE_MIME.get(arc_ext, "application/octet-stream")


def slugify(name: str) -> str:
    """Create a URL-safe slug from a name."""
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug)
    return slug.strip("-")


def _normalize_folder(name: str) -> str:
    """Collapse hyphens, underscores, and whitespace to a single space for category matching."""
    return re.sub(r"[-_\s]+", " ", name.lower()).strip()


def _token_matches_keyword(token: str, kw_token: str) -> bool:
    """Match a single folder token against a single keyword on word boundaries.

    Accepts an exact match or a simple English plural of the keyword
    (``supplement`` -> ``supplements``, ``bestiary`` -> ``bestiaries``) so that
    folders like ``Supplements`` or ``Maps`` still classify, while incidental
    substrings (``mm`` inside ``gamma``) no longer do.
    """
    if token == kw_token:
        return True
    if token == kw_token + "s":
        return True
    if token == kw_token + "es":
        return True
    if kw_token.endswith("y") and token == kw_token[:-1] + "ies":
        return True
    return False


def _keyword_matches(keyword: str, tokens: list[str]) -> bool:
    """Return True if ``keyword`` matches ``tokens`` on whole-word boundaries.

    Single-word keywords must match a whole token (so ``mm`` no longer matches
    inside ``gamma``). Multi-word keywords (e.g. ``character sheet``) match as a
    contiguous run of tokens.
    """
    kw_tokens = keyword.split()
    n = len(kw_tokens)
    for i in range(len(tokens) - n + 1):
        if all(_token_matches_keyword(tokens[i + j], kw_tokens[j]) for j in range(n)):
            return True
    return False


def _match_category(segment: str) -> str | None:
    """Return the CATEGORY_MAP category a single folder ``segment`` matches, or None."""
    tokens = _normalize_folder(segment).split()
    for category, keywords in CATEGORY_MAP.items():
        if any(_keyword_matches(kw, tokens) for kw in keywords):
            return category
    return None


def guess_category(filepath: str) -> str:
    """Infer book category from path segments.

    The top-level category folder (the first folder under the system root, e.g.
    ``core`` in ``books/Shadowrun/core/Companions/x.pdf``) is the deliberate
    category the user chose, so it takes priority: if it matches a keyword, that
    category wins even when a deeper subfolder (``Companions``, ``DM Guide``)
    incidentally matches a different keyword. Only when the top-level folder does
    not match do we scan deeper subfolders innermost-first, then fall back to the
    top-level folder name as a custom category slug.
    """
    segments = filepath.replace("\\", "/").split("/")
    # segments[-1] is the filename; the category folder is the first segment
    # under the system root (index 2 for the standard books/<system>/<cat>/ layout).
    folder_segments = segments[:-1]
    if len(folder_segments) > 2:
        top_category_folder = folder_segments[2]
        matched = _match_category(top_category_folder)
        if matched is not None:
            return matched
        # Top-level folder is a custom (non-keyword) category. Its name wins over
        # any keyword-matching subfolder nested beneath it.
        return slugify(top_category_folder)
    # No dedicated category folder under the system root — scan whatever folders
    # exist innermost-first for a keyword match.
    for segment in reversed(folder_segments):
        matched = _match_category(segment)
        if matched is not None:
            return matched
    return "core"


def agnostic_category(relative_path: str) -> str:
    """Return the category for a book inside the system-agnostic folder.

    Path structure: books/{SystemName}/{CategoryFolder}/.../{file}
    The immediate subfolder under the system dir becomes the category slug.
    Books sitting directly in the system dir fall back to 'uncategorized'.
    """
    # relative_path is relative to library root: books/<agnostic folder>/<cat>/.../<file>
    parts = relative_path.replace("\\", "/").split("/")
    # parts[0]=books, parts[1]=system dir, parts[2]=category dir or filename
    if len(parts) > 3:
        return slugify(parts[2])
    return "uncategorized"


_THUMBNAIL_TIMEOUT = 30  # seconds

# Cap the archive listing we scan for a cover image so a maliciously large
# central directory can't stall a thumbnail worker.
_ARCHIVE_LIST_CAP = 5000

# Ceiling on the bytes we let py7zr decompress for a single cover image. Covers
# are ordinary page images, so 256 MiB is generous; the cap also doubles as a
# decompression-bomb guard for the in-memory 7z extraction path.
_ARCHIVE_MEMBER_SIZE_CAP = 256 * 1024 * 1024


def _extract_7z_member(zf, name: str) -> Optional[bytes]:
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


def _generate_thumbnail_task(filepath: str, output_path: str, size: tuple, result: list, exc: list):
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


def generate_thumbnail(filepath: str, output_path: str, size: tuple = (300, 400), should_stop=None) -> bool:
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


def extract_text_from_pdf(
    filepath: str, should_stop=None, text_only: bool = False
) -> tuple[list[dict], bool]:
    """Extract text from all pages of a PDF.

    Returns ``(pages, used_ocr)`` where ``pages`` is a list of
    ``{page, content}`` dicts and ``used_ocr`` is True if any page's text came
    from OCR rather than an embedded text layer.

    Pages with an embedded text layer are read directly. Pages with no embedded
    text are OCR'd when OCR is available (default image); otherwise they are
    skipped, so a PDF with no extractable text yields an empty list — the
    caller then marks it ``image-only``.

    When ``text_only`` is True, OCR is skipped: image-only pages are left out and
    the book is queued for deferred OCR by the caller instead of being OCR'd
    inline (which could stall the scan for hours on a large scanned book).
    """
    pages = []
    used_ocr = False
    ocr_on = False if text_only else ocr.ocr_available()
    try:
        doc = _fitz_open_with_timeout(filepath, should_stop=should_stop)
        for i, page in enumerate(doc):
            if should_stop and should_stop():
                break
            page_text = page.get_text().strip()
            if page_text:
                pages.append({"page": i + 1, "content": page_text})
            elif ocr_on:
                scale = config.OCR_DPI / 72.0
                pix = page.get_pixmap(matrix=fitz.Matrix(scale, scale), alpha=False)
                ocr_text = ocr.ocr_pixmap(pix, should_stop=should_stop)
                if ocr_text:
                    pages.append({"page": i + 1, "content": ocr_text})
                    used_ocr = True
        doc.close()
    except Exception as e:
        logger.error(f"Text extraction failed for {filepath}: {e}")
    return pages, used_ocr


def extract_text_isolated(
    filepath: str, should_stop=None, text_only: bool = False
) -> tuple[list[dict], bool]:
    """Extract text from a PDF in a separate process, isolating native crashes.

    Returns ``(pages, used_ocr)`` exactly like ``extract_text_from_pdf``.  The
    extraction runs in a spawned child process; if that process dies without
    producing a result — a segfault inside MuPDF, an out-of-memory kill, or
    exceeding ``_EXTRACT_TIMEOUT`` — this raises ``PdfExtractionCrashError`` so
    the caller can mark the book failed and continue, instead of the whole
    worker crashing and re-looping the scan on restart.

    A cooperative ``should_stop`` cancels by terminating the child and raising
    TimeoutError, matching the abort semantics of the rest of the indexer.

    With ``text_only`` the child skips OCR (fast scan phase); image-only books
    return empty ``pages`` and are queued for deferred OCR by the caller.
    """
    from . import pdf_worker

    fd, result_path = tempfile.mkstemp(prefix="grimoire_extract_", suffix=".pkl")
    os.close(fd)
    proc = _MP_CONTEXT.Process(
        target=pdf_worker.main, args=(filepath, result_path, text_only)
    )
    try:
        proc.start()
        poll_interval = 0.5
        elapsed = 0.0
        while proc.is_alive() and elapsed < _EXTRACT_TIMEOUT:
            proc.join(poll_interval)
            elapsed += poll_interval
            if should_stop and should_stop():
                proc.terminate()
                proc.join()
                raise TimeoutError(f"Text extraction aborted by stop request for {filepath}")

        if proc.is_alive():
            logger.error(f"Text extraction timed out after {_EXTRACT_TIMEOUT}s for {filepath}")
            proc.terminate()
            proc.join()
            raise PdfExtractionCrashError(f"extraction timed out after {_EXTRACT_TIMEOUT}s")

        # Child exited.  A clean run left a result file; a crash (negative
        # exitcode = killed by signal, or nonzero without a result) did not.
        if os.path.getsize(result_path) == 0:
            code = proc.exitcode
            reason = (
                f"killed by signal {-code}" if code is not None and code < 0
                else f"exited with code {code}"
            )
            logger.error(f"Text extraction worker crashed ({reason}) for {filepath}")
            raise PdfExtractionCrashError(f"extraction worker {reason}")

        with open(result_path, "rb") as fh:
            return pickle.load(fh)
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join()
        try:
            os.unlink(result_path)
        except OSError:
            pass


def ocr_page_isolated(filepath: str, page_index: int, should_stop=None, dpi: int | None = None) -> str:
    """OCR a single page in a spawned child, bounded by ``_OCR_PAGE_TIMEOUT``.

    Returns the recognised text ("" on timeout, crash, cancel, or empty result —
    never raises).  Isolation means a native OCR/MuPDF crash or a wedged page
    kills only this throwaway process; the caller checkpoints the page as done
    and moves on rather than losing the whole book or crashing the server.

    ``dpi`` overrides the rasterization resolution (per-book re-OCR); None uses
    the global ``OCR_DPI`` default.
    """
    from . import pdf_worker

    fd, result_path = tempfile.mkstemp(prefix="grimoire_ocr_", suffix=".pkl")
    os.close(fd)
    proc = _MP_CONTEXT.Process(
        target=pdf_worker.ocr_page_main,
        args=(filepath, page_index, ocr.effective_languages(), result_path, dpi),
    )
    try:
        proc.start()
        poll_interval = 0.5
        elapsed = 0.0
        while proc.is_alive() and elapsed < _OCR_PAGE_TIMEOUT:
            proc.join(poll_interval)
            elapsed += poll_interval
            if should_stop and should_stop():
                proc.terminate()
                proc.join()
                return ""
        if proc.is_alive():
            logger.error(
                f"OCR page {page_index + 1} timed out after {_OCR_PAGE_TIMEOUT}s for {filepath}"
            )
            proc.terminate()
            proc.join()
            return ""
        if os.path.getsize(result_path) == 0:
            logger.error(
                f"OCR page {page_index + 1} worker crashed (exit {proc.exitcode}) for {filepath}"
            )
            return ""
        with open(result_path, "rb") as fh:
            return pickle.load(fh) or ""
    finally:
        if proc.is_alive():
            proc.terminate()
            proc.join()
        try:
            os.unlink(result_path)
        except OSError:
            pass


def ocr_book(book: Book, session: Session, should_stop=None, on_page=None) -> str:
    """OCR one queued book page-by-page, checkpointing progress as it goes.

    Resumes from ``book.ocr_pages_done``: pages at or below that index were
    already OCR'd and committed to the FTS index in a prior run, so a restart or
    crash never loses work and never re-does a page.  Each recognised page is
    inserted into ``book_search`` and ``ocr_pages_done`` is advanced and
    committed before moving on, so the whole-book 30-min wall no longer applies —
    a multi-hour scanned book makes steady, durable progress.

    Returns one of: ``"done"`` (all pages processed, book indexed), ``"stopped"``
    (cancelled via ``should_stop`` — resumable), or ``"error"`` (page count
    unreadable).  ``on_page(done, total)`` is called after each page for live
    status.
    """
    try:
        page_count = _book_page_count(book.filepath)
    except Exception as e:
        logger.error(f"OCR: cannot open '{book.filename}' to count pages: {e}")
        book.ocr_pending = False
        book.index_failed = True
        book.index_error = f"ocr open failed: {e}"[:500]
        _commit(session, f"ocr open-failed '{book.filepath}'")
        return "error"

    start = book.ocr_pages_done or 0
    dpi = book.ocr_dpi  # per-book override; None => global OCR_DPI default
    logger.info(
        f"OCR: '{book.filename}' — {page_count} page(s), resuming at page {start + 1}"
        + (f" (dpi={dpi})" if dpi else "")
    )
    for i in range(start, page_count):
        if should_stop and should_stop():
            logger.info(f"OCR: stop requested during '{book.filename}' at page {i + 1}")
            return "stopped"

        text_out = ocr_book_page_isolated_wrapper(book.filepath, i, should_stop, dpi=dpi)

        # A page cancelled mid-flight comes back empty; treat that as a stop, not a
        # processed page, so it isn't silently skipped forever on resume. Checked
        # here (not just at the top) because the OCR call can take up to the
        # per-page timeout, during which a stop may have been requested.
        if should_stop and should_stop():
            logger.info(f"OCR: stop requested during '{book.filename}' at page {i + 1}")
            return "stopped"

        if text_out:
            session.execute(
                text(
                    "INSERT INTO book_search (book_id, page_number, content) "
                    "VALUES (:bid, :pnum, :content)"
                ),
                {"bid": book.id, "pnum": i + 1, "content": text_out},
            )
        # Advance the checkpoint whether the page yielded text, was legitimately
        # blank, or was abandoned (crash/timeout in the isolated worker — already
        # logged there). The page is counted as processed exactly once and never
        # re-OCR'd on resume, so a single pathological page can't stall or loop the
        # book forever. Committed per page so a crash right after loses at most the
        # page in flight.
        book.ocr_pages_done = i + 1
        _commit(session, f"ocr page {i + 1} '{book.filepath}'")
        if on_page:
            on_page(i + 1, page_count)

    # All pages processed: the book is now fully indexed.  ``index_error='ocr'``
    # badges it in the UI as OCR-sourced (same convention as inline OCR).
    book.ocr_pending = False
    book.indexed = True
    book.index_failed = False
    book.index_error = "ocr"
    _commit(session, f"ocr done '{book.filepath}'")
    logger.info(f"OCR: completed '{book.filename}' ({page_count} pages)")
    return "done"


# Indirection so tests can stub the isolated call without spawning subprocesses.
def ocr_book_page_isolated_wrapper(filepath: str, page_index: int, should_stop=None) -> str:
    return ocr_page_isolated(filepath, page_index, should_stop=should_stop)


def _book_page_count(filepath: str) -> int:
    doc = _fitz_open_with_timeout(filepath)
    try:
        return doc.page_count
    finally:
        doc.close()


def _commit(session: Session, label: str) -> None:
    """Commit with the standard indexer timeout guard; roll back on hang."""
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, label)
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang on commit ({label}): {e}")
        session.rollback()


def _count_eligible_files(directory: Path, extensions: set) -> int:
    """Count non-hidden files with matching extensions under directory."""
    count = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if f.startswith("."):
                continue
            if Path(f).suffix.lower() in extensions or archive_ext(f) in extensions:
                count += 1
    return count


def _read_audio_metadata(filepath: str) -> dict:
    """Read duration and embedded tags from an audio file (best-effort).

    Returns a dict with ``duration`` (float seconds), ``title``, ``artist``,
    ``album`` (strings, blank when absent) and ``embedded_art`` (bool — whether
    the file carries embedded cover art).  Never raises; on any failure it
    returns zeroed/empty values so scanning continues.
    """
    info = {"duration": 0.0, "title": "", "artist": "", "album": "", "embedded_art": False}
    try:
        from mutagen import File as MutagenFile  # local import keeps startup light

        easy = MutagenFile(filepath, easy=True)
        if easy is not None:
            if getattr(easy, "info", None) is not None:
                length = getattr(easy.info, "length", 0) or 0
                info["duration"] = round(float(length), 3)

            def _first(key: str) -> str:
                val = easy.get(key) if hasattr(easy, "get") else None
                if isinstance(val, (list, tuple)) and val:
                    return str(val[0]).strip()
                return str(val).strip() if val else ""

            info["title"] = _first("title")
            info["artist"] = _first("artist")
            info["album"] = _first("album")

        info["embedded_art"] = _has_embedded_art(filepath)
    except Exception as exc:
        logger.debug(f"Could not read audio metadata for '{filepath}': {exc}")
    return info


def _has_embedded_art(filepath: str) -> bool:
    """Return True if the audio file carries embedded cover art."""
    try:
        return _extract_embedded_art(filepath) is not None
    except Exception:
        return False


def _extract_embedded_art(filepath: str):
    """Return ``(image_bytes, mime)`` for embedded cover art, or None.

    Handles ID3 APIC (MP3), FLAC/Opus PICTURE blocks, and MP4/M4A ``covr`` atoms.
    """
    try:
        from mutagen import File as MutagenFile

        audio = MutagenFile(filepath)
        if audio is None:
            return None

        # FLAC / OggOpus expose .pictures
        pics = getattr(audio, "pictures", None)
        if pics:
            pic = pics[0]
            return (bytes(pic.data), getattr(pic, "mime", "") or "image/jpeg")

        tags = getattr(audio, "tags", None)
        if not tags:
            return None

        # ID3 APIC frames (MP3, sometimes WAV/AIFF)
        if hasattr(tags, "getall"):
            apics = tags.getall("APIC")
            if apics:
                apic = apics[0]
                return (bytes(apic.data), getattr(apic, "mime", "") or "image/jpeg")

        # MP4 / M4A cover atoms
        covr = tags.get("covr") if hasattr(tags, "get") else None
        if covr:
            cover = covr[0]
            fmt = getattr(cover, "imageformat", None)
            mime = "image/png" if fmt == 14 else "image/jpeg"  # 14 == PNG in MP4Cover
            return (bytes(cover), mime)
    except Exception as exc:
        logger.debug(f"Could not extract embedded art from '{filepath}': {exc}")
    return None


def _find_folder_artwork(folder: str):
    """Return the path of a ``cover.*`` / ``folder.*`` image in ``folder``, or None."""
    try:
        for entry in os.scandir(folder):
            if not entry.is_file():
                continue
            p = Path(entry.name)
            if p.stem.lower() in _AUDIO_COVER_STEMS and p.suffix.lower() in IMAGE_EXTS:
                return entry.path
    except OSError:
        pass
    return None


_OPF_NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "opf": "http://www.idpf.org/2007/opf",
}


def parse_opf_metadata(opf_path: str) -> dict:
    """Parse a Calibre/OPF metadata file and return a dict of book fields.

    Returns a dict containing any of: title, authors, description, publisher,
    year, tags, cover_image_filename. Only keys with actual values are included.
    cover_image_filename is the bare filename (not a path) of the cover image
    referenced in the OPF <guide>, if present.
    """
    try:
        tree = ElementTree.parse(opf_path)
    except Exception as e:
        logger.warning(f"Could not parse OPF file '{opf_path}': {e}")
        return {}

    root = tree.getroot()
    meta = {}

    def _find_text(tag: str) -> str:
        el = root.find(f"opf:metadata/dc:{tag}", _OPF_NS)
        return el.text.strip() if el is not None and el.text else ""

    title = _find_text("title")
    if title:
        meta["title"] = title

    # Calibre writes "Unknown" as the creator when no author is set — skip it.
    authors = [
        author
        for el in root.findall("opf:metadata/dc:creator", _OPF_NS)
        if el.text and (author := el.text.strip()) and author.lower() != "unknown"
    ]
    if authors:
        meta["authors"] = authors

    description = _find_text("description")
    if description:
        # Strip any embedded HTML tags from Calibre descriptions
        description = re.sub(r"<[^>]+>", "", description).strip()
        if description:
            meta["description"] = description

    publisher = _find_text("publisher")
    if publisher:
        meta["publisher"] = publisher

    date_str = _find_text("date")
    if date_str:
        try:
            year = int(date_str[:4])
            if year > 1000:  # Calibre uses 0101-01-01 as a "no date" sentinel
                meta["year"] = year
        except (ValueError, IndexError):
            pass

    subjects = [
        el.text.strip().lower()
        for el in root.findall("opf:metadata/dc:subject", _OPF_NS)
        if el.text and el.text.strip()
    ]
    if subjects:
        meta["tags"] = subjects

    cover_ref = root.find("opf:guide/opf:reference[@type='cover']", _OPF_NS)
    if cover_ref is not None:
        href = cover_ref.get("href", "")
        if href:
            meta["cover_image_filename"] = Path(href).name

    return meta


# Metadata-refresh modes for scan_library / _apply_opf_to_book.
METADATA_MODES = ("new", "missing", "replace")

# Book fields that can be sourced from an OPF sidecar.
_OPF_BOOK_FIELDS = ("title", "authors", "description", "publisher", "year", "tags")


def resolve_scope(library_path: str, scope_path: str) -> tuple[str, Path]:
    """Resolve a user-supplied scope path against the library root.

    `scope_path` is a path relative to the library root and must begin with one
    of the known collection folders (``books``/``maps``/``tokens``/``audio``).  Returns a
    tuple of (section, absolute_dir).  Raises ValueError if the scope escapes the
    library root or names an unknown collection.
    """
    library = Path(library_path)
    cleaned = (scope_path or "").strip().replace("\\", "/").strip("/")
    if not cleaned:
        raise ValueError("scope path is empty")

    section = cleaned.split("/", 1)[0]
    if section not in ("books", "maps", "tokens", "audio"):
        raise ValueError(
            f"scope must start with books/, maps/, tokens/, or audio/: {scope_path!r}"
        )

    # Build the target without resolving symlinks so the walked paths match the
    # filepaths stored by an unscoped scan (which uses library_path verbatim).
    target = library / cleaned
    # Guard against path traversal using fully-resolved paths.
    resolved_lib = str(library.resolve())
    if os.path.commonpath([resolved_lib, str(target.resolve())]) != resolved_lib:
        raise ValueError(f"scope path escapes the library root: {scope_path!r}")

    return section, target


def _find_opf_meta(root: str, filename: str) -> dict:
    """Look up sidecar OPF metadata for a file: sibling <stem>.opf, then metadata.opf."""
    opf_path = os.path.join(root, Path(filename).stem + ".opf")
    if not os.path.isfile(opf_path):
        opf_path = os.path.join(root, "metadata.opf")
    return parse_opf_metadata(opf_path) if os.path.isfile(opf_path) else {}


def _apply_opf_to_book(book: Book, opf_meta: dict, mode: str) -> bool:
    """Re-apply OPF metadata to an already-indexed book.

    mode="missing": only fill a field whose current DB value is falsy
    (None/""/[]), treating any populated value as user-protected.
    mode="replace": overwrite a field whenever the OPF provides it.
    Fields absent from `opf_meta` are never touched.

    Returns True if any field was changed.
    """
    if not opf_meta or mode not in ("missing", "replace"):
        return False

    changed = False
    for field in _OPF_BOOK_FIELDS:
        if field not in opf_meta:
            continue
        new_value = opf_meta[field]
        if mode == "missing" and getattr(book, field, None):
            continue
        if getattr(book, field, None) != new_value:
            setattr(book, field, new_value)
            changed = True
    return changed


def scan_library(library_path: str, data_path: str, session: Session, on_progress=None,
                 should_stop=None, scope_path: str | None = None, metadata_mode: str = "new"):
    """Scan the library directory and register all files in the database.

    on_progress(scanned_books, total_books, scanned_maps, total_maps, scanned_tokens,
    total_tokens, scanned_audio, total_audio) is called after each file is processed if provided.

    should_stop() is an optional callable that returns True when the scan should abort early.

    scope_path, when given, restricts the scan to a single subtree (relative to the
    library root, e.g. "books/D&D 5e/adventure").  Only the matching collection is
    walked and the missing-file sweep is limited to that subtree.

    metadata_mode controls how sidecar metadata is applied to already-indexed books:
    "new" (default) leaves existing records alone, "missing" fills empty fields from
    OPF sidecars, "replace" overwrites fields wherever the sidecar provides a value.
    """
    library = Path(library_path)
    books_dir = library / "books"
    maps_dir = library / "maps"
    tokens_dir = library / "tokens"
    audio_dir = library / "audio"
    thumb_dir = Path(data_path) / "thumbnails"
    stats = {
        "new_systems": 0,
        "new_books": 0,
        "new_maps": 0,
        "new_tokens": 0,
        "new_audio": 0,
        "updated_books": 0,
        "indexed_pages": 0,
        "errors": 0,
    }

    # --- Resolve scope (which collections to walk, and the subtree root) ---
    scope_section: str | None = None
    scope_dir: Path | None = None
    if scope_path:
        scope_section, scope_dir = resolve_scope(library_path, scope_path)
        logger.info(f"Scoped scan: section={scope_section}, dir={scope_dir}, mode={metadata_mode}")

    scan_books = scope_section in (None, "books")
    scan_maps = scope_section in (None, "maps")
    scan_tokens = scope_section in (None, "tokens")
    scan_audio = scope_section in (None, "audio")

    # For a scoped books scan, walk only the scope dir; otherwise iterate every system.
    books_walk_dir = scope_dir if scope_section == "books" else books_dir
    maps_walk_dir = scope_dir if scope_section == "maps" else maps_dir
    tokens_walk_dir = scope_dir if scope_section == "tokens" else tokens_dir
    audio_walk_dir = scope_dir if scope_section == "audio" else audio_dir

    total_books = (
        _count_eligible_files(books_walk_dir, DOC_EXTS | IMAGE_EXTS | ARCHIVE_EXTS)
        if scan_books and books_walk_dir.exists() else 0
    )
    total_maps = (
        _count_eligible_files(maps_walk_dir, MAP_IMAGE_EXTS)
        if scan_maps and maps_walk_dir.exists() else 0
    )
    total_tokens = (
        _count_eligible_files(tokens_walk_dir, IMAGE_EXTS)
        if scan_tokens and tokens_walk_dir.exists() else 0
    )
    total_audio = (
        _count_eligible_files(audio_walk_dir, AUDIO_EXTS)
        if scan_audio and audio_walk_dir.exists() else 0
    )
    scanned_books = scanned_maps = scanned_tokens = scanned_audio = 0

    if on_progress:
        on_progress(0, total_books, 0, total_maps, 0, total_tokens, 0, total_audio)

    # --- Scan /books ---
    if scan_books and books_dir.exists():
        # When scoped, the owning system is the first path segment under books/;
        # otherwise iterate every top-level system folder.
        scope_parts = Path(scope_path.replace("\\", "/").strip("/")).parts if scope_path else ()
        if scope_section == "books" and len(scope_parts) > 1:
            system_dirs = [books_dir / scope_parts[1]]
        else:
            # Whole library, or scope == "books" root: iterate every system.
            system_dirs = sorted(books_dir.iterdir())
        for system_dir in system_dirs:
            if not system_dir.is_dir() or system_dir.name.startswith("."):
                continue

            raw_name = system_dir.name
            is_nsfw = bool(re.search(r"\(nsfw\)", raw_name, re.IGNORECASE))
            system_name = re.sub(r"\s*\(nsfw\)\s*", "", raw_name, flags=re.IGNORECASE).strip()
            system_slug = slugify(system_name)

            logger.debug(f"DB: querying system '{system_slug}'")
            try:
                system = _run_with_timeout(
                    lambda slug=system_slug: session.query(GameSystem).filter_by(slug=slug).first(),
                    _DB_TIMEOUT, f"query system '{system_slug}'"
                )
            except TimeoutError as e:
                logger.error(f"DB hang: {e} — skipping system '{system_name}'")
                stats["errors"] += 1
                continue
            is_agnostic = is_system_agnostic_folder(system_name)
            if not system:
                system = GameSystem(
                    name=system_name,
                    slug=system_slug,
                    is_explicit=is_nsfw,
                    is_system_agnostic=is_agnostic,
                )
                session.add(system)
                logger.debug(f"DB: flushing new system '{system_name}'")
                try:
                    _run_with_timeout(session.flush, _DB_TIMEOUT, f"flush system '{system_name}'")
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — skipping system '{system_name}'")
                    session.rollback()
                    stats["errors"] += 1
                    continue
                stats["new_systems"] += 1
                logger.info(f"New game system: {system_name}" + (" [explicit]" if is_nsfw else ""))
            elif is_nsfw and not system.is_explicit:
                system.is_explicit = True
            if is_agnostic and not system.is_system_agnostic:
                system.is_system_agnostic = True

            # When scoped to a path deeper than the system dir, walk only that
            # subtree; otherwise walk the whole system.
            walk_root = scope_dir if (scope_section == "books" and len(scope_parts) > 1) else system_dir
            for root, dirs, files in os.walk(walk_root):
                dirs[:] = [d for d in dirs if not d.startswith(".")]

                # Collect cover image filenames declared in any OPF files in this
                # directory so we can skip them — Calibre exports a cover JPG that
                # would otherwise appear as a 1-page book entry.
                opf_cover_filenames: set[str] = set()
                for f in files:
                    if Path(f).suffix.lower() == ".opf":
                        opf_data = parse_opf_metadata(os.path.join(root, f))
                        cover_fn = opf_data.get("cover_image_filename")
                        if cover_fn:
                            opf_cover_filenames.add(cover_fn)

                for filename in sorted(files):
                    if filename.startswith("."):
                        continue

                    filepath = os.path.join(root, filename)
                    ext = Path(filename).suffix.lower()
                    arc_ext = archive_ext(filename)

                    if ext not in DOC_EXTS and ext not in IMAGE_EXTS and not arc_ext:
                        continue

                    if filename in opf_cover_filenames:
                        logger.debug(f"Skipping OPF cover image: {filepath}")
                        continue

                    scanned_books += 1
                    if on_progress:
                        on_progress(
                            scanned_books,
                            total_books,
                            scanned_maps,
                            total_maps,
                            scanned_tokens,
                            total_tokens,
                            scanned_audio,
                            total_audio,
                        )
                    if should_stop and should_stop():
                        logger.info("scan_library: stop requested during books scan.")
                        return stats

                    relative_path = os.path.relpath(filepath, library_path)

                    logger.info(f"Scanning book ({scanned_books}/{total_books}): {filepath}")
                    logger.debug(f"DB: querying existing book '{filepath}'")
                    try:
                        existing = _run_with_timeout(
                            lambda fp=filepath: session.query(Book).filter_by(filepath=fp).first(),
                            _DB_TIMEOUT, f"query book '{filepath}'"
                        )
                    except TimeoutError as e:
                        logger.error(f"DB hang: {e} — skipping '{filename}'")
                        stats["errors"] += 1
                        continue
                    if existing:
                        # Re-apply sidecar metadata to already-indexed books when
                        # requested (modes "missing"/"replace") — see _apply_opf_to_book.
                        if metadata_mode in ("missing", "replace"):
                            opf_meta = _find_opf_meta(root, filename)
                            if _apply_opf_to_book(existing, opf_meta, metadata_mode):
                                logger.info(f"Refreshing metadata for '{filename}' (mode={metadata_mode})")
                                try:
                                    _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit metadata refresh '{filepath}'")
                                    stats["updated_books"] += 1
                                except (TimeoutError, IntegrityError) as e:
                                    logger.error(f"DB hang refreshing metadata for '{filename}': {e}")
                                    session.rollback()
                        if existing.scan_failed:
                            logger.debug(f"Already registered, skipping: {filename}")
                            continue
                        # Archives are opaque: only comic-book variants get a
                        # cover thumbnail, and none carry a page count.
                        thumbnailable = ext in IMAGE_EXTS or ext == ".pdf" or arc_ext in _COMIC_ARCHIVE_EXTS
                        needs_thumbnail = thumbnailable and not existing.has_thumbnail
                        needs_page_count = ext == ".pdf" and existing.page_count == 0 and not existing.index_error
                        if ext in IMAGE_EXTS and existing.page_count == 0:
                            existing.page_count = 1
                        if not needs_thumbnail and not needs_page_count:
                            logger.debug(f"Already registered, skipping: {filename}")
                            continue
                        logger.debug(f"Resuming incomplete scan for: {filename}")
                        book = existing
                    else:
                        category = agnostic_category(relative_path) if is_agnostic else guess_category(relative_path)
                        title = Path(filename).stem.replace("_", " ").replace("-", " ").strip()

                        try:
                            file_size = os.path.getsize(filepath)
                        except OSError:
                            logger.warning(f"Cannot stat file, skipping: {filepath}")
                            continue

                        # Check sibling <stem>.opf first, then Calibre's metadata.opf in the same dir.
                        opf_meta = _find_opf_meta(root, filename)
                        if opf_meta:
                            logger.info(f"Applying OPF metadata to '{filename}'")

                        book = Book(
                            game_system_id=system.id,
                            title=opf_meta.get("title", title),
                            filename=filename,
                            filepath=filepath,
                            relative_path=relative_path,
                            category=category,
                            file_size=file_size,
                            mime_type=(
                                "application/pdf" if ext == ".pdf"
                                else archive_mime(arc_ext) if arc_ext
                                else f"image/{ext[1:]}"
                            ),
                            authors=opf_meta.get("authors"),
                            description=opf_meta.get("description"),
                            publisher=opf_meta.get("publisher"),
                            year=opf_meta.get("year"),
                            tags=opf_meta.get("tags"),
                        )

                        # Commit the book record first so that if a subsequent
                        # hang kills the worker, the file is already in the DB and
                        # won't be re-processed on the next startup scan.
                        session.add(book)
                        logger.debug(f"DB: committing new book '{filename}'")
                        try:
                            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit book '{filepath}'")
                            stats["new_books"] += 1
                            logger.info(f"New book saved: {title} ({category}) in {system_name}")
                        except TimeoutError as e:
                            logger.error(f"DB hang: {e} — rolling back '{filename}'")
                            session.rollback()
                            stats["errors"] += 1
                            continue
                        except IntegrityError:
                            session.rollback()
                            logger.debug(f"Book already exists, skipping: {filepath}")
                            continue
                        # Archives are opaque: only comic-book variants get a
                        # cover thumbnail, and none carry a page count.
                        needs_thumbnail = (
                            ext in IMAGE_EXTS or ext == ".pdf" or arc_ext in _COMIC_ARCHIVE_EXTS
                        )
                        needs_page_count = ext == ".pdf"
                        if ext in IMAGE_EXTS:
                            book.page_count = 1

                    thumb_path = os.path.join(
                        thumb_dir,
                        "books",
                        f"{slugify(book.title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
                    )
                    if needs_thumbnail:
                        # Set scan_failed before the potentially-hanging operation.
                        # If the worker is killed mid-hang this flag persists, preventing
                        # the file from being retried on the next scan. A clean cancel
                        # clears it below so the file is resumed normally next time.
                        book.scan_failed = True
                        try:
                            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
                        except (TimeoutError, IntegrityError) as e:
                            logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
                            session.rollback()
                        logger.info(f"Generating thumbnail: {filepath}")
                        if generate_thumbnail(filepath, thumb_path, should_stop=should_stop):
                            book.has_thumbnail = True
                        if should_stop and should_stop():
                            # Cancelled — clear the flag so the file is resumed next scan.
                            book.scan_failed = False
                        try:
                            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit thumbnail '{filepath}'")
                        except (TimeoutError, IntegrityError) as e:
                            logger.error(f"DB hang saving thumbnail for '{filename}': {e}")
                            session.rollback()

                    if needs_page_count:
                        if not book.scan_failed:
                            book.scan_failed = True
                            try:
                                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
                            except (TimeoutError, IntegrityError) as e:
                                logger.error(f"DB hang writing scan_failed for '{filename}': {e}")
                                session.rollback()
                        logger.info(f"Opening PDF for page count: {filepath}")
                        try:
                            doc = _fitz_open_with_timeout(filepath, should_stop=should_stop)
                            book.page_count = len(doc)
                            doc.close()
                            logger.debug(f"Page count: {book.page_count} pages in '{filename}'")
                            book.scan_failed = False
                            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit page_count '{filepath}'")
                        except Exception as e:
                            if should_stop and should_stop():
                                # Cancelled — clear the flag so the file is resumed next scan.
                                book.scan_failed = False
                            else:
                                logger.error(f"Could not read page count for '{filename}': {e}")
                                book.index_error = str(e)[:500]
                                stats["errors"] += 1
                            try:
                                _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit scan_failed '{filepath}'")
                            except (TimeoutError, IntegrityError) as e2:
                                logger.error(f"DB hang saving index_error for '{filename}': {e2}")
                                session.rollback()

    if scan_maps and maps_walk_dir.exists():
        for root, dirs, files in os.walk(maps_walk_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

            for filename in sorted(files):
                if filename.startswith("."):
                    continue

                filepath = os.path.join(root, filename)
                ext = Path(filename).suffix.lower()

                if ext not in MAP_IMAGE_EXTS:
                    continue

                scanned_maps += 1
                if on_progress:
                    on_progress(
                        scanned_books,
                        total_books,
                        scanned_maps,
                        total_maps,
                        scanned_tokens,
                        total_tokens,
                        scanned_audio,
                        total_audio,
                    )
                if should_stop and should_stop():
                    logger.info("scan_library: stop requested during maps scan.")
                    return stats

                relative_path = os.path.relpath(filepath, library_path)

                logger.info(f"Scanning map ({scanned_maps}/{total_maps}): {filepath}")
                logger.debug(f"DB: querying existing map '{filepath}'")
                try:
                    existing = _run_with_timeout(
                        lambda fp=filepath: session.query(GenericMap).filter_by(filepath=fp).first(),
                        _DB_TIMEOUT, f"query map '{filepath}'"
                    )
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — skipping '{filename}'")
                    stats["errors"] += 1
                    continue
                if existing:
                    logger.debug(f"Already registered, skipping: {filename}")
                    continue

                title = Path(filename).stem.replace("_", " ").replace("-", " ").strip()

                try:
                    file_size = os.path.getsize(filepath)
                except OSError:
                    logger.warning(f"Cannot stat file, skipping: {filepath}")
                    continue

                gmap = GenericMap(
                    filename=filename,
                    filepath=filepath,
                    relative_path=relative_path,
                    file_size=file_size,
                )

                thumb_path = os.path.join(
                    thumb_dir,
                    "maps",
                    f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
                )
                logger.info(f"Generating thumbnail: {filepath}")
                if generate_thumbnail(filepath, thumb_path, should_stop=should_stop):
                    gmap.has_thumbnail = True

                session.add(gmap)
                logger.debug(f"DB: committing new map '{filename}'")
                try:
                    _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit map '{filepath}'")
                    stats["new_maps"] += 1
                    logger.info(f"New map saved: {title}")
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — rolling back '{filename}'")
                    session.rollback()
                    stats["errors"] += 1
                except IntegrityError:
                    session.rollback()
                    logger.debug(f"Map already exists, skipping: {filepath}")

    if scan_tokens and tokens_walk_dir.exists():
        for root, dirs, files in os.walk(tokens_walk_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

            for filename in sorted(files):
                if filename.startswith("."):
                    continue

                filepath = os.path.join(root, filename)
                ext = Path(filename).suffix.lower()

                if ext not in IMAGE_EXTS:
                    continue

                scanned_tokens += 1
                if on_progress:
                    on_progress(
                        scanned_books,
                        total_books,
                        scanned_maps,
                        total_maps,
                        scanned_tokens,
                        total_tokens,
                        scanned_audio,
                        total_audio,
                    )
                if should_stop and should_stop():
                    logger.info("scan_library: stop requested during tokens scan.")
                    return stats

                relative_path = os.path.relpath(filepath, library_path)

                logger.info(f"Scanning token ({scanned_tokens}/{total_tokens}): {filepath}")
                logger.debug(f"DB: querying existing token '{filepath}'")
                try:
                    existing = _run_with_timeout(
                        lambda fp=filepath: session.query(Token).filter_by(filepath=fp).first(),
                        _DB_TIMEOUT, f"query token '{filepath}'"
                    )
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — skipping '{filename}'")
                    stats["errors"] += 1
                    continue
                if existing:
                    logger.debug(f"Already registered, skipping: {filename}")
                    continue

                title = Path(filename).stem.replace("_", " ").replace("-", " ").strip()

                try:
                    file_size = os.path.getsize(filepath)
                except OSError:
                    logger.warning(f"Cannot stat file, skipping: {filepath}")
                    continue

                token = Token(
                    filename=filename,
                    filepath=filepath,
                    relative_path=relative_path,
                    file_size=file_size,
                )

                thumb_path = os.path.join(
                    thumb_dir,
                    "tokens",
                    f"{slugify(title)}_{hashlib.md5(filepath.encode()).hexdigest()[:8]}.webp",
                )
                logger.info(f"Generating thumbnail: {filepath}")
                if generate_thumbnail(filepath, thumb_path, size=(200, 200), should_stop=should_stop):
                    token.has_thumbnail = True

                session.add(token)
                logger.debug(f"DB: committing new token '{filename}'")
                try:
                    _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit token '{filepath}'")
                    stats["new_tokens"] += 1
                    logger.info(f"New token saved: {title}")
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — rolling back '{filename}'")
                    session.rollback()
                    stats["errors"] += 1
                except IntegrityError:
                    session.rollback()
                    logger.debug(f"Token already exists, skipping: {filepath}")

    if scan_audio and audio_walk_dir.exists():
        for root, dirs, files in os.walk(audio_walk_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

            for filename in sorted(files):
                if filename.startswith("."):
                    continue

                filepath = os.path.join(root, filename)
                ext = Path(filename).suffix.lower()

                if ext not in AUDIO_EXTS:
                    continue

                scanned_audio += 1
                if on_progress:
                    on_progress(
                        scanned_books,
                        total_books,
                        scanned_maps,
                        total_maps,
                        scanned_tokens,
                        total_tokens,
                        scanned_audio,
                        total_audio,
                    )
                if should_stop and should_stop():
                    logger.info("scan_library: stop requested during audio scan.")
                    return stats

                relative_path = os.path.relpath(filepath, library_path)

                logger.info(f"Scanning audio ({scanned_audio}/{total_audio}): {filepath}")
                logger.debug(f"DB: querying existing audio '{filepath}'")
                try:
                    existing = _run_with_timeout(
                        lambda fp=filepath: session.query(Audio).filter_by(filepath=fp).first(),
                        _DB_TIMEOUT, f"query audio '{filepath}'"
                    )
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — skipping '{filename}'")
                    stats["errors"] += 1
                    continue
                if existing:
                    logger.debug(f"Already registered, skipping: {filename}")
                    continue

                try:
                    file_size = os.path.getsize(filepath)
                except OSError:
                    logger.warning(f"Cannot stat file, skipping: {filepath}")
                    continue

                meta = _read_audio_metadata(filepath)
                has_artwork = bool(meta["embedded_art"]) or _find_folder_artwork(root) is not None

                track = Audio(
                    filename=filename,
                    filepath=filepath,
                    relative_path=relative_path,
                    file_size=file_size,
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
                    stats["new_audio"] += 1
                    logger.info(f"New audio saved: {meta['title'] or filename}")
                except TimeoutError as e:
                    logger.error(f"DB hang: {e} — rolling back '{filename}'")
                    session.rollback()
                    stats["errors"] += 1
                except IntegrityError:
                    session.rollback()
                    logger.debug(f"Audio already exists, skipping: {filepath}")

    _apply_tags_from_library(library_path, session, scope_dir=scope_dir)

    # --- Mark / unmark missing files ---
    # After walking the filesystem, any DB record whose file is gone gets
    # is_missing=True; records that exist on disk have is_missing cleared.
    # When scoped, only reconcile records under the scope subtree so unrelated
    # corners of the library are left untouched.
    if should_stop and should_stop():
        return stats

    def _scoped(query, model):
        if scope_dir is not None:
            return query.filter(model.filepath.like(f"{scope_dir}{os.sep}%"))
        return query

    missing_books = missing_maps = missing_tokens = missing_audio = 0
    if scan_books:
        for book in _scoped(session.query(Book), Book).all():
            gone = not os.path.exists(book.filepath)
            if gone != bool(book.is_missing):
                book.is_missing = gone
                if gone:
                    missing_books += 1
                    logger.warning(f"Missing book: '{book.title}' ({book.filepath})")
    if scan_maps:
        for m in _scoped(session.query(GenericMap), GenericMap).all():
            gone = not os.path.exists(m.filepath)
            if gone != bool(m.is_missing):
                m.is_missing = gone
                if gone:
                    missing_maps += 1
                    logger.warning(f"Missing map: '{m.filename}' ({m.filepath})")
    if scan_tokens:
        for t in _scoped(session.query(Token), Token).all():
            gone = not os.path.exists(t.filepath)
            if gone != bool(t.is_missing):
                t.is_missing = gone
                if gone:
                    missing_tokens += 1
                    logger.warning(f"Missing token: '{t.filename}' ({t.filepath})")
    if scan_audio:
        for a in _scoped(session.query(Audio), Audio).all():
            gone = not os.path.exists(a.filepath)
            if gone != bool(a.is_missing):
                a.is_missing = gone
                if gone:
                    missing_audio += 1
                    logger.warning(f"Missing audio: '{a.filename}' ({a.filepath})")
    if missing_books or missing_maps or missing_tokens or missing_audio:
        logger.info(
            f"Missing files: {missing_books} book(s), {missing_maps} map(s), "
            f"{missing_tokens} token(s), {missing_audio} audio"
        )
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, "commit missing flags")
    except (TimeoutError, Exception) as e:
        logger.error(f"DB hang saving missing flags: {e}")
        session.rollback()

    stats["missing_books"] = missing_books
    stats["missing_maps"] = missing_maps
    stats["missing_tokens"] = missing_tokens
    stats["missing_audio"] = missing_audio

    return stats


def _load_tags_json(folder_path: str) -> dict:
    """Read and parse tags.json from folder_path.

    Returns a dict mapping relative keys to tag lists.  Returns {} on any
    error or if the file does not exist.
    """
    tags_file = Path(folder_path) / "tags.json"
    if not tags_file.exists():
        return {}
    try:
        raw = json.loads(tags_file.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            logger.warning(f"tags.json at {folder_path} must be a JSON object — skipped")
            return {}
        result = {}
        for key, val in raw.items():
            if isinstance(val, list):
                seen: set[str] = set()
                normalized = []
                for t in val:
                    lowered = str(t).strip().lower()
                    if lowered and lowered not in seen:
                        seen.add(lowered)
                        normalized.append(lowered)
                result[key] = normalized
        return result
    except Exception as exc:
        logger.warning(f"tags.json at {folder_path} could not be parsed: {exc}")
        return {}


def _within_scope(path: Path, scope_dir: Path | None) -> bool:
    """Return True if `path` is the scope dir or lives under it (or scope is None)."""
    if scope_dir is None:
        return True
    try:
        return path == scope_dir or scope_dir in path.parents
    except Exception:
        return False


def _apply_tags_from_library(library_path: str, session: Session, scope_dir: Path | None = None) -> None:
    """Apply tags declared in tags.json files throughout the library tree.

    When `scope_dir` is given, only tags.json files within that subtree are applied.
    """
    library = Path(library_path)

    _section_models = {
        "maps": (MapFolder, GenericMap),
        "tokens": (TokenFolder, Token),
        "audio": (AudioFolder, Audio),
    }
    for section in ("maps", "tokens", "audio"):
        section_dir = library / section
        if not section_dir.exists():
            continue
        # Skip sections the scope doesn't touch (scope under section, or == section).
        if scope_dir is not None and not _within_scope(scope_dir, section_dir):
            continue

        folder_model, file_model = _section_models[section]

        for root, dirs, files in os.walk(section_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

            if not _within_scope(Path(root), scope_dir):
                continue

            if "tags.json" not in files:
                continue

            tag_map = _load_tags_json(root)
            if not tag_map:
                continue

            root_path = Path(root)

            for key, tags in tag_map.items():
                if not tags:
                    continue

                if key == ".":
                    folder_rel = str(os.path.relpath(root, section_dir))
                    record = session.query(folder_model).filter_by(path=folder_rel).first()
                    if record:
                        record.tags = tags
                    else:
                        session.add(folder_model(path=folder_rel, tags=tags))
                    logger.debug(f"tags.json: folder {folder_rel} ← {tags}")
                else:
                    target = root_path / key
                    if target.is_dir():
                        folder_rel = str(os.path.relpath(target, section_dir))
                        record = session.query(folder_model).filter_by(path=folder_rel).first()
                        if record:
                            record.tags = tags
                        else:
                            session.add(folder_model(path=folder_rel, tags=tags))
                        logger.debug(f"tags.json: folder {folder_rel} ← {tags}")
                    else:
                        file_rel = os.path.relpath(target, library_path)
                        record = session.query(file_model).filter_by(relative_path=file_rel).first()
                        if record:
                            record.tags = tags
                            logger.debug(f"tags.json: file {file_rel} ← {tags}")
                        else:
                            logger.debug(f"tags.json: no record found for {file_rel}")

    # --- books/ section (system-level tags only) ---
    books_dir = library / "books"
    if books_dir.exists() and (scope_dir is None or _within_scope(scope_dir, books_dir)):
        for system_dir in sorted(books_dir.iterdir()):
            if not system_dir.is_dir() or system_dir.name.startswith("."):
                continue
            # System-level tags only matter when the scope includes this system dir.
            if scope_dir is not None and not _within_scope(scope_dir, system_dir):
                continue

            tag_map = _load_tags_json(str(system_dir))
            if not tag_map or "." not in tag_map:
                continue

            tags = tag_map["."]
            if not tags:
                continue

            system_slug = slugify(system_dir.name)
            system = session.query(GameSystem).filter_by(slug=system_slug).first()
            if system:
                system.tags = tags
                logger.debug(f"tags.json: system {system_dir.name} ← {tags}")

    session.commit()


def index_book_text(book: Book, data_path: str, session: Session, should_stop=None):
    """Extract and index text from a PDF for full-text search.

    Text extraction runs in an isolated worker process (see
    ``extract_text_isolated``).  Before extraction the book is marked
    ``index_failed`` and committed, so that even if a native crash escaped the
    isolation and took down the whole server, the book would already be flagged
    and skipped on the next scan instead of re-crashing in an endless loop.  The
    flag is cleared once extraction succeeds.
    """
    if book.indexed or book.index_failed or book.mime_type != "application/pdf":
        return False

    # Crash-loop guard: persist "attempt in progress" before the risky call so a
    # process-killing crash (segfault / OOM) can't cause this file to be retried
    # forever.  Committed up front; cleared on success below.
    book.index_failed = True
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index attempt '{book.filepath}'")
    except (TimeoutError, IntegrityError) as e:
        logger.error(f"DB hang marking index attempt for '{book.filename}': {e}")
        session.rollback()

    logger.info(f"Indexing: extracting text from '{book.filepath}'")
    try:
        # text_only: never OCR inline. Image-only books come back with no pages
        # and are queued for the deferred-OCR worker below, so a large scanned
        # book can't stall the scan for hours or hit the whole-book timeout.
        pages, used_ocr = extract_text_isolated(
            book.filepath, should_stop=should_stop, text_only=True
        )
    except PdfExtractionCrashError as e:
        logger.error(f"Text extraction crashed for '{book.filename}': {e} — marking index_failed")
        book.index_error = f"extraction crashed: {e}"[:500]
        book.index_failed = True
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index_failed '{book.filepath}'")
        except (TimeoutError, IntegrityError) as e2:
            logger.error(f"DB hang saving index_failed for '{book.filename}': {e2}")
            session.rollback()
        return False
    except TimeoutError:
        # Cancelled via should_stop — clear the attempt marker so the file is
        # resumed on the next scan rather than being left permanently failed.
        book.index_failed = False
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index cancel '{book.filepath}'")
        except (TimeoutError, IntegrityError):
            session.rollback()
        return False

    if not pages:
        if ocr.ocr_available():
            # Scanned/image-only PDF: hand it to the deferred-OCR queue instead
            # of OCRing inline. Left not-indexed with ocr_pending set so the OCR
            # worker (and startup recovery) picks it up; index_failed cleared so
            # it isn't mistaken for a hard failure.
            logger.info(f"No text layer in '{book.filename}' — queuing for deferred OCR")
            book.ocr_pending = True
            book.ocr_pages_done = 0
            book.indexed = False
            book.index_failed = False
            book.index_error = ""
            _commit(session, f"queue ocr '{book.filepath}'")
            return False
        # OCR unavailable (slim image): keep the pre-OCR behaviour — mark
        # image-only and indexed so it isn't retried every scan.
        logger.info(f"No text extracted from '{book.filename}' — image-only PDF, marking as indexed")
        book.index_error = "image-only"
        book.indexed = True
        book.index_failed = False
        logger.debug(f"DB: committing image-only indexed for '{book.filename}'")
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit image-only indexed '{book.filepath}'")
        except TimeoutError as e:
            logger.error(f"DB hang: {e} — rolling back image-only indexed for '{book.filename}'")
            session.rollback()
        return True

    logger.info(f"Indexing: inserting {len(pages)} pages for '{book.filename}' into search index")
    for page_data in pages:
        session.execute(
            text(
                "INSERT INTO book_search (book_id, page_number, content) VALUES (:bid, :pnum, :content)"
            ),
            {"bid": book.id, "pnum": page_data["page"], "content": page_data["content"]},
        )

    book.indexed = True
    book.index_failed = False  # clear the crash-loop guard set before extraction
    # "ocr" marks books whose text was (at least partly) recognised via OCR, so
    # the UI can badge them and startup re-queue can target them. Empty = native.
    book.index_error = "ocr" if used_ocr else ""
    logger.debug(f"DB: committing index for '{book.filename}'")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index '{book.filepath}'")
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — rolling back index for '{book.filename}'")
        session.rollback()
        return False
    logger.info(f"Indexed {len(pages)} pages for: {book.filename} ('{book.title}')")
    return True
