"""Sidecar and embedded metadata: audio tags/art, Calibre OPF, and scope resolution."""
import os
import re
import logging
from pathlib import Path
from typing import Optional, Tuple
from xml.etree import ElementTree

from ..models import Book
from .constants import (
    IMAGE_EXTS,
    _AUDIO_COVER_STEMS,
    _OPF_BOOK_FIELDS,
    _OPF_NS,
)

logger = logging.getLogger("grimoire.indexer")


# ---------------------------------------------------------------------------
# Audio metadata + cover art
# ---------------------------------------------------------------------------


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


def _extract_embedded_art(filepath: str) -> Optional[Tuple[bytes, str]]:
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


def _find_folder_artwork(folder: str) -> Optional[str]:
    """Return the path of a ``cover.*`` / ``folder.*`` image in ``folder``, or None."""
    try:
        for entry in os.scandir(folder):
            if not entry.is_file():
                continue
            p = Path(entry.name)
            if p.stem.lower() in _AUDIO_COVER_STEMS and p.suffix.lower() in IMAGE_EXTS:
                return entry.path
    except OSError:
        # Folder unreadable/missing → no artwork; genuinely expected, not an error.
        pass
    return None


# ---------------------------------------------------------------------------
# Calibre / OPF sidecar metadata
# ---------------------------------------------------------------------------


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
            # Non-numeric / malformed date string → leave year unset. Expected.
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


# ---------------------------------------------------------------------------
# Scope resolution
# ---------------------------------------------------------------------------


def resolve_collection_dir(library: Path, section: str) -> Path:
    """Resolve a top-level collection folder (``books``/``maps``/etc.) case-insensitively.

    On case-sensitive filesystems the library root may hold ``Books``/``Audio``
    rather than the canonical lowercase names.  Return the first existing child of
    ``library`` whose name matches ``section`` ignoring case, falling back to
    ``library / section`` when none exists (so callers that create or probe the
    path still get a stable, canonical location).
    """
    try:
        for child in library.iterdir():
            if child.name.lower() == section and child.is_dir():
                return child
    except (FileNotFoundError, NotADirectoryError):
        pass
    return library / section


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

    head, _, rest = cleaned.partition("/")
    section = head.lower()
    if section not in ("books", "maps", "tokens", "audio"):
        raise ValueError(f"scope must start with books/, maps/, tokens/, or audio/: {scope_path!r}")

    # Build the target without resolving symlinks so the walked paths match the
    # filepaths stored by an unscoped scan (which uses library_path verbatim).
    # Resolve the top-level collection folder case-insensitively so a scope that
    # names "books" still lands on a "Books" folder on a case-sensitive FS.
    collection_dir = resolve_collection_dir(library, section)
    target = collection_dir / rest if rest else collection_dir
    # Guard against path traversal using fully-resolved paths.
    resolved_lib = str(library.resolve())
    if os.path.commonpath([resolved_lib, str(target.resolve())]) != resolved_lib:
        raise ValueError(f"scope path escapes the library root: {scope_path!r}")

    return section, target
