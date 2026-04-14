"""Library scanner, PDF indexer, and metadata fetcher for Grimoire."""

import os
import re
import json
import logging
import hashlib
import threading
from pathlib import Path
import fitz  # PyMuPDF
from PIL import Image
from sqlalchemy import text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from .models import GameSystem, Book, GenericMap, MapFolder, Token, TokenFolder

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

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
PDF_EXTS = {".pdf"}
DOC_EXTS = {".pdf", ".epub", ".djvu"}
MAP_IMAGE_EXTS = IMAGE_EXTS | PDF_EXTS


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


def scan_library(library_path: str, data_path: str, session: Session, on_progress=None, should_stop=None):
    """Scan the library directory and register all files in the database.

    on_progress(scanned_books, total_books, scanned_maps, total_maps, scanned_tokens, total_tokens)
    is called after each file is processed if provided.

    should_stop() is an optional callable that returns True when the scan should abort early.
    """
    library = Path(library_path)
    books_dir = library / "books"
    maps_dir = library / "maps"
    tokens_dir = library / "tokens"
    thumb_dir = Path(data_path) / "thumbnails"
    stats = {
        "new_systems": 0,
        "new_books": 0,
        "new_maps": 0,
        "new_tokens": 0,
        "indexed_pages": 0,
        "errors": 0,
    }

    total_books = (
        _count_eligible_files(books_dir, DOC_EXTS | IMAGE_EXTS) if books_dir.exists() else 0
    )
    total_maps = _count_eligible_files(maps_dir, MAP_IMAGE_EXTS) if maps_dir.exists() else 0
    total_tokens = _count_eligible_files(tokens_dir, IMAGE_EXTS) if tokens_dir.exists() else 0
    scanned_books = scanned_maps = scanned_tokens = 0

    if on_progress:
        on_progress(0, total_books, 0, total_maps, 0, total_tokens)

    # --- Scan /books ---
    if books_dir.exists():
        for system_dir in sorted(books_dir.iterdir()):
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
            if not system:
                system = GameSystem(name=system_name, slug=system_slug, is_explicit=is_nsfw)
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

            for root, dirs, files in os.walk(system_dir):
                dirs[:] = [d for d in dirs if not d.startswith(".")]

                for filename in sorted(files):
                    if filename.startswith("."):
                        continue

                    filepath = os.path.join(root, filename)
                    ext = Path(filename).suffix.lower()

                    if ext not in DOC_EXTS and ext not in IMAGE_EXTS:
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
                        if existing.scan_failed:
                            logger.debug(f"Already registered, skipping: {filename}")
                            continue
                        needs_thumbnail = not existing.has_thumbnail
                        needs_page_count = ext == ".pdf" and existing.page_count == 0 and not existing.index_error
                        if not needs_thumbnail and not needs_page_count:
                            logger.debug(f"Already registered, skipping: {filename}")
                            continue
                        logger.debug(f"Resuming incomplete scan for: {filename}")
                        book = existing
                    else:
                        category = guess_category(relative_path)
                        title = Path(filename).stem.replace("_", " ").replace("-", " ").strip()

                        try:
                            file_size = os.path.getsize(filepath)
                        except OSError:
                            logger.warning(f"Cannot stat file, skipping: {filepath}")
                            continue

                        book = Book(
                            game_system_id=system.id,
                            title=title,
                            filename=filename,
                            filepath=filepath,
                            relative_path=relative_path,
                            category=category,
                            file_size=file_size,
                            mime_type="application/pdf" if ext == ".pdf" else f"image/{ext[1:]}",
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

    if maps_dir.exists():
        for root, dirs, files in os.walk(maps_dir):
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

    if tokens_dir.exists():
        for root, dirs, files in os.walk(tokens_dir):
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

    _apply_tags_from_library(library_path, session)

    # --- Mark / unmark missing files ---
    # After walking the filesystem, any DB record whose file is gone gets
    # is_missing=True; records that exist on disk have is_missing cleared.
    if should_stop and should_stop():
        return stats

    missing_books = missing_maps = missing_tokens = 0
    for book in session.query(Book).all():
        gone = not os.path.exists(book.filepath)
        if gone != bool(book.is_missing):
            book.is_missing = gone
            if gone:
                missing_books += 1
                logger.warning(f"Missing book: '{book.title}' ({book.filepath})")
    for m in session.query(GenericMap).all():
        gone = not os.path.exists(m.filepath)
        if gone != bool(m.is_missing):
            m.is_missing = gone
            if gone:
                missing_maps += 1
                logger.warning(f"Missing map: '{m.filename}' ({m.filepath})")
    for t in session.query(Token).all():
        gone = not os.path.exists(t.filepath)
        if gone != bool(t.is_missing):
            t.is_missing = gone
            if gone:
                missing_tokens += 1
                logger.warning(f"Missing token: '{t.filename}' ({t.filepath})")
    if missing_books or missing_maps or missing_tokens:
        logger.info(f"Missing files: {missing_books} book(s), {missing_maps} map(s), {missing_tokens} token(s)")
    try:
        _run_with_timeout(session.commit, _DB_TIMEOUT, "commit missing flags")
    except (TimeoutError, Exception) as e:
        logger.error(f"DB hang saving missing flags: {e}")
        session.rollback()

    stats["missing_books"] = missing_books
    stats["missing_maps"] = missing_maps
    stats["missing_tokens"] = missing_tokens

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
                result[key] = [str(t).strip() for t in val if str(t).strip()]
        return result
    except Exception as exc:
        logger.warning(f"tags.json at {folder_path} could not be parsed: {exc}")
        return {}


def _apply_tags_from_library(library_path: str, session: Session) -> None:
    """Apply tags declared in tags.json files throughout the library tree."""
    library = Path(library_path)

    for section in ("maps", "tokens"):
        section_dir = library / section
        if not section_dir.exists():
            continue

        folder_model = MapFolder if section == "maps" else TokenFolder
        file_model = GenericMap if section == "maps" else Token

        for root, dirs, files in os.walk(section_dir):
            dirs[:] = [d for d in dirs if not d.startswith(".")]

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
    if books_dir.exists():
        for system_dir in sorted(books_dir.iterdir()):
            if not system_dir.is_dir() or system_dir.name.startswith("."):
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
        logger.warning(f"No text extracted from '{book.filename}', marking as failed")
        book.index_error = "No text extracted"
        book.index_failed = True
        logger.debug(f"DB: committing index_failed for '{book.filename}'")
        try:
            _run_with_timeout(session.commit, _DB_TIMEOUT, f"commit index_failed '{book.filepath}'")
        except TimeoutError as e:
            logger.error(f"DB hang: {e} — rolling back index_failed for '{book.filename}'")
            session.rollback()
        return False

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
