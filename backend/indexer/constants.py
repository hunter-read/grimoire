"""Shared constants for the library indexer package.

Timeouts, the spawn multiprocessing context, file-extension sets, the
folder-name category map, archive MIME table, and metadata modes — all the
module-level constants the indexer submodules share.
"""
import multiprocessing

_FITZ_TIMEOUT = 30  # seconds — files that can't be opened in 30s are unreadable
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

_THUMBNAIL_TIMEOUT = 30  # seconds

# Cap the archive listing we scan for a cover image so a maliciously large
# central directory can't stall a thumbnail worker.
_ARCHIVE_LIST_CAP = 5000

# Ceiling on the bytes we let py7zr decompress for a single cover image. Covers
# are ordinary page images, so 256 MiB is generous; the cap also doubles as a
# decompression-bomb guard for the in-memory 7z extraction path.
_ARCHIVE_MEMBER_SIZE_CAP = 256 * 1024 * 1024

# Neutral category assigned when folder-name inference is turned off (globally
# or per-system). Matches the fallback already used by ``agnostic_category``.
UNCATEGORIZED = "uncategorized"

# Marker file placed at a system root (``books/<system>/.no-auto-category``) to
# disable folder-name category inference for just that system.
NO_AUTO_CATEGORY_MARKER = ".no-auto-category"

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
_SYSTEM_AGNOSTIC_SLUGS = frozenset(
    {
        "system-agnostic",
        "generic",
        "any",
    }
)

# Normalized folder names treated as the "one-page / small RPG" collection — a
# special sibling of the system-agnostic collection (issue #202). Books here use
# their immediate subfolder name as the category label, exactly like agnostic.
_ONE_PAGE_SLUGS = frozenset(
    {
        "one-page-rpgs",
        "single-page-rpgs",
        "one-shot-rpgs",
    }
)

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
    ".zip",
    ".cbz",
    ".rar",
    ".cbr",
    ".7z",
    ".cb7",
    ".tar",
    ".cbt",
    ".tar.gz",
    ".tgz",
    ".tar.bz2",
    ".tbz2",
}
# Comic-book archives whose first image is used as a cover thumbnail.
_COMIC_ARCHIVE_EXTS = {".cbz", ".cbr", ".cb7", ".cbt"}

# Archives recognised in the maps/tokens/audio trees (issue #250).  Map packs and
# art collections ship supplementary files (PSD, STL, …) bundled next to the
# images; the archive is registered as an opaque item so it stays visible and
# downloadable in the gallery.  Comic-book variants are books-only — a .cbz in
# the maps tree is a book that has been misfiled, not a map pack — so this is
# ARCHIVE_EXTS minus the comic extensions.
MEDIA_ARCHIVE_EXTS = ARCHIVE_EXTS - _COMIC_ARCHIVE_EXTS
# Basenames (sans extension) treated as folder cover art for audio tracks.
_AUDIO_COVER_STEMS = {"cover", "folder"}

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

_OPF_NS = {
    "dc": "http://purl.org/dc/elements/1.1/",
    "opf": "http://www.idpf.org/2007/opf",
}

# Metadata-refresh modes for scan_library / _apply_opf_to_book.
METADATA_MODES = ("new", "missing", "replace")

# Book fields that can be sourced from an OPF sidecar.
# Note: OPF ``tags`` are applied separately via the shared-tag service (issue
# #235); they are intentionally NOT in this setattr list (no column to set).
_OPF_BOOK_FIELDS = ("title", "authors", "description", "publisher", "year")
