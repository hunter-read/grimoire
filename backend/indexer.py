"""Library scanner, PDF indexer, and metadata fetcher for Grimoire."""

import os
import re
import json
import logging
import hashlib
import threading
from pathlib import Path
from xml.etree import ElementTree
import fitz  # PyMuPDF
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import GameSystem, Book, GenericMap, MapFolder, Token, TokenFolder, Audio, AudioFolder

logger = logging.getLogger("grimoire.indexer")

_FITZ_TIMEOUT = 30   # seconds — files that can't be opened in 30s are unreadable
_DB_TIMEOUT = 30  # seconds — max time to wait for a DB operation before treating it as hung


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
# Basenames (sans extension) treated as folder cover art for audio tracks.
_AUDIO_COVER_STEMS = {"cover", "folder"}


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


def guess_category(filepath: str) -> str:
    """Infer book category from path segments, innermost folder takes priority."""
    segments = filepath.replace("\\", "/").split("/")
    for segment in reversed(segments[:-1]):
        normalized = _normalize_folder(segment)
        for category, keywords in CATEGORY_MAP.items():
            if any(kw in normalized for kw in keywords):
                return category
    # 4+ segments means a named subfolder exists under the system root
    if len(segments) > 3:
        return slugify(segments[2])
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


def _generate_thumbnail_task(filepath: str, output_path: str, size: tuple, result: list, exc: list):
    """Worker executed in a daemon thread by generate_thumbnail."""
    try:
        ext = Path(filepath).suffix.lower()
        if ext == ".pdf":
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


def extract_text_from_pdf(filepath: str, should_stop=None) -> list[dict]:
    """Extract text from all pages of a PDF. Returns list of {page, content}."""
    pages = []
    try:
        doc = _fitz_open_with_timeout(filepath, should_stop=should_stop)
        for i, page in enumerate(doc):
            page_text = page.get_text().strip()
            if page_text:
                pages.append({"page": i + 1, "content": page_text})
        doc.close()
    except Exception as e:
        logger.error(f"Text extraction failed for {filepath}: {e}")
    return pages


def _count_eligible_files(directory: Path, extensions: set) -> int:
    """Count non-hidden files with matching extensions under directory."""
    count = 0
    for root, dirs, files in os.walk(directory):
        dirs[:] = [d for d in dirs if not d.startswith(".")]
        for f in files:
            if not f.startswith(".") and Path(f).suffix.lower() in extensions:
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
        _count_eligible_files(books_walk_dir, DOC_EXTS | IMAGE_EXTS)
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

                    if ext not in DOC_EXTS and ext not in IMAGE_EXTS:
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
                        needs_thumbnail = not existing.has_thumbnail
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
                            mime_type="application/pdf" if ext == ".pdf" else f"image/{ext[1:]}",
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
                        needs_thumbnail = True
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
    """Extract and index text from a PDF for full-text search."""
    if book.indexed or book.index_failed or book.mime_type != "application/pdf":
        return False

    logger.info(f"Indexing: extracting text from '{book.filepath}'")
    pages = extract_text_from_pdf(book.filepath, should_stop=should_stop)
    if not pages:
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
    book.index_error = ""
    logger.debug(f"DB: committing index for '{book.filename}'")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index '{book.filepath}'")
    except TimeoutError as e:
        logger.error(f"DB hang: {e} — rolling back index for '{book.filename}'")
        session.rollback()
        return False
    logger.info(f"Indexed {len(pages)} pages for: {book.filename} ('{book.title}')")
    return True
