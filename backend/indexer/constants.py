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

# Marker files declaring a folder to be a *system container* — a folder whose
# immediate children are systems rather than categories (issues #261, #262,
# #301). Each has an equivalent folder-name suffix (see _CONTAINER_SUFFIXES) so
# the convention works for users who can't easily create dotfiles.
PARENT_SYSTEM_MARKER = ".parent-system-container"
ONE_PAGE_MARKER = ".one-page-container"
# The system-agnostic collection: books that belong to no particular system
# (generic dungeon geomorphs, stat-block-free adventures). A sibling of the
# one-page collection — same "immediate subfolder is the category" behaviour,
# and likewise only one folder can be it.
AGNOSTIC_MARKER = ".system-agnostic-container"
# A *family* groups related but distinct systems that share a lineage
# ("d20 System" holding Pathfinder and Mutants & Masterminds) — unlike a parent
# system, whose children are editions of one game (issue #301).
SYSTEM_FAMILY_MARKER = ".system-family-container"
# A *publisher* groups the systems one company puts out ("Paizo" holding
# Pathfinder and Starfinder).
PUBLISHER_MARKER = ".publisher-container"
# A *generic* container is the escape hatch: "these children are systems" and
# nothing more. It claims no relationship between them, so it propagates no
# metadata — for users whose shelf doesn't fit the named kinds.
GENERIC_MARKER = ".container"

# Marker file equivalent to the ``(nsfw)`` folder-name suffix, for parity with
# the other folder-level indicators.
NSFW_MARKER = ".nsfw"

# Container kinds stored in ``GameSystem.container_kind``.
CONTAINER_PARENT = "parent"
CONTAINER_ONE_PAGE = "one-page"
CONTAINER_AGNOSTIC = "agnostic"
CONTAINER_FAMILY = "family"
CONTAINER_PUBLISHER = "publisher"
CONTAINER_GENERIC = "generic"

# Kinds that describe *the* collection of their sort, not a shelf that can be
# repeated. Two "one-page RPGs" folders would each claim to be the home of every
# tiny game, and books in one would be filed under a different system than
# identical books in the other — so the UI offers these only when no folder
# already claims them.
SINGLETON_CONTAINER_KINDS = frozenset({CONTAINER_ONE_PAGE, CONTAINER_AGNOSTIC})

# Precedence when a folder carries more than one container declaration, most
# specific first: a folder claiming both "parent system" and "publisher" is
# read as the parent system, because that makes the stronger claim about how
# its children relate to each other (issue #301). Marker files and folder-name
# suffixes are resolved against this same order, so the two spellings can never
# disagree about which kind wins. The generic kind is last — it claims only
# "these are systems", so any named kind outranks it.
CONTAINER_PRECEDENCE = (
    CONTAINER_PARENT,
    CONTAINER_ONE_PAGE,
    CONTAINER_AGNOSTIC,
    CONTAINER_FAMILY,
    CONTAINER_PUBLISHER,
    CONTAINER_GENERIC,
)

# Marker file for each container kind, keyed by kind.
CONTAINER_MARKERS = {
    CONTAINER_PARENT: PARENT_SYSTEM_MARKER,
    CONTAINER_ONE_PAGE: ONE_PAGE_MARKER,
    CONTAINER_AGNOSTIC: AGNOSTIC_MARKER,
    CONTAINER_FAMILY: SYSTEM_FAMILY_MARKER,
    CONTAINER_PUBLISHER: PUBLISHER_MARKER,
    CONTAINER_GENERIC: GENERIC_MARKER,
}

# Folder-name suffixes (matched case-insensitively, like ``(nsfw)``) that
# declare a container without needing a marker file.
_CONTAINER_SUFFIXES = {
    "parent-system": CONTAINER_PARENT,
    "one-page": CONTAINER_ONE_PAGE,
    "system-agnostic": CONTAINER_AGNOSTIC,
    "system-family": CONTAINER_FAMILY,
    "publisher": CONTAINER_PUBLISHER,
    "container": CONTAINER_GENERIC,
}

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
        # Not literally one page, but the same organizing problem: a pile of
        # tiny single-book games that each deserve to be their own system
        # without cluttering the main grid (issue #262).
        "micro-rpgs",
    }
)

IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".gif", ".webp", ".bmp", ".tiff", ".svg"}
PDF_EXTS = {".pdf"}
# Plain-text book formats (issue #200). Paginated synthetically and indexed for
# full-text search; see indexer/text_documents.py.
TEXT_DOC_EXTS = {".txt", ".md", ".rtf"}
# Every extension registered as a *book*. ``.epub``/``.djvu`` are opened by
# PyMuPDF exactly like PDFs (issue #373); the text formats are decoded instead.
DOC_EXTS = {".pdf", ".epub", ".djvu"} | TEXT_DOC_EXTS
# Animated battlemaps (issue: CzePeku and similar publishers ship looping video
# variants alongside the stills). Registered and served like any other map, but
# opaque to the thumbnailer — there is no still frame to render without pulling
# in a video decoder, so they carry no thumbnail for now.
MAP_VIDEO_EXTS = {".webm", ".mp4"}
# Universal VTT exports: a JSON envelope carrying the map image as base64 plus
# wall/portal/light data. Registered so the file is visible and downloadable in
# the gallery; its contents are not parsed during the scan.
VTT_DATA_EXTS = {".uvtt", ".dd2vtt"}
# Map-tree extensions that cannot produce a thumbnail from the file itself.
MAP_OPAQUE_EXTS = MAP_VIDEO_EXTS | VTT_DATA_EXTS
MAP_IMAGE_EXTS = IMAGE_EXTS | PDF_EXTS | MAP_OPAQUE_EXTS
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
_OPF_BOOK_FIELDS = ("title", "authors", "description", "publisher", "year", "isbn")

# Ceiling on a "text" book we will decode and paginate (.txt/.md/.rtf, issue
# #200). Well above any real homebrew document, but low enough that a stray
# multi-hundred-MB log file can't stall the scan or exhaust memory.
_TEXT_FILE_SIZE_CAP = 32 * 1024 * 1024

# Ceiling on a single page image decompressed out of a comic archive (issue
# #180). Comic pages are ordinary scans; anything past this is a
# decompression-bomb attempt rather than a page.
_COMIC_PAGE_SIZE_CAP = 128 * 1024 * 1024
