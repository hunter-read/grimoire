"""Per-format capability table for library books.

Before this module, "is this book readable / searchable / thumbnailable?" was
spelled ``mime_type == "application/pdf"`` in a dozen places (issue #373). That
made every non-PDF format a second-class citizen by accident: ``.epub`` and
``.djvu`` were scanned and readable, but the indexing queries filtered them out,
so they sat at ``indexed=0`` forever with no search and no cover.

The fix is to name the capabilities once, here, and have every call site ask a
question about *capability* rather than about a MIME string:

* ``can_index(mime)``     — text can be extracted into the FTS index
* ``can_thumbnail(ext)``  — a cover image can be produced
* ``has_page_count(ext)`` — the file has a meaningful page count
* ``is_paged_document``   — the reader renders it as server-rendered pages

Adding a format is then a single row in ``_FORMATS`` plus an extractor, instead
of a hunt for every ``application/pdf`` comparison.

Format families
---------------
``fitz``   PDF/EPUB/DjVu/XPS/etc — opened by PyMuPDF, rendered to WebP pages.
``text``   .txt/.md/.rtf — decoded to plain text and paginated synthetically.
``comic``  .cbz/.cbr/.cb7/.cbt — an ordered list of images inside an archive.
``image``  a single image file, one page.

EPUB reflow
-----------
EPUB is reflowable: ``len(doc)`` depends on the layout box passed to
``Document.layout()``. If the indexer and the reader laid out differently, a
search hit on "page 12" would point at different text than the reader shows on
page 12. ``EPUB_LAYOUT`` pins one layout app-wide so page numbers mean the same
thing everywhere; ``open_document`` applies it on every open.
"""
from pathlib import Path
from typing import NamedTuple, Optional

import fitz  # PyMuPDF

# --- EPUB / reflowable layout --------------------------------------------------
# A fixed A4-ish box at a fixed font size. The exact numbers matter far less than
# that they never change: page counts, FTS page anchors, cached page renders, and
# stored reading positions are all derived from this layout. Changing it
# re-paginates every reflowable book in the library and invalidates their search
# anchors, so treat it as a stored-data format constant, not a display tweak.
EPUB_LAYOUT_WIDTH = 600
EPUB_LAYOUT_HEIGHT = 800
EPUB_LAYOUT_FONTSIZE = 11

# Characters per synthetic page for plain-text formats. Text files have no
# intrinsic pagination, so we impose one to reuse the paged reader, the
# per-page FTS rows, and the page-anchored search results.
TEXT_PAGE_CHARS = 3000


class FormatSpec(NamedTuple):
    """How one book format is handled across the pipeline."""

    mime: str
    family: str  # "fitz" | "text" | "comic" | "image"
    indexable: bool  # text can be extracted into the FTS index
    thumbnailable: bool  # a cover image can be produced
    paged: bool  # has a meaningful page count / paged reader


# Keyed by lowercased file extension. ``archive_ext`` handles multi-suffix
# archives (.tar.gz) separately; comic archives are single-suffix so they sit
# here directly.
_FORMATS: dict[str, FormatSpec] = {
    # --- fitz-backed documents (issue #373) ---
    ".pdf": FormatSpec("application/pdf", "fitz", True, True, True),
    ".epub": FormatSpec("application/epub+zip", "fitz", True, True, True),
    ".djvu": FormatSpec("image/vnd.djvu", "fitz", True, True, True),
    # --- plain-text documents (issue #200) ---
    ".txt": FormatSpec("text/plain", "text", True, False, True),
    ".md": FormatSpec("text/markdown", "text", True, False, True),
    ".rtf": FormatSpec("application/rtf", "text", True, False, True),
    # --- comic archives (issue #180) ---
    # These MIME strings must stay identical to ``_ARCHIVE_MIME`` in constants.py:
    # they are what the scanner has already written into existing databases and
    # what the frontend's archive set matches on. .cb7/.cbt deliberately share
    # the generic 7z/tar types, so a comic is distinguished from a plain archive
    # by its *extension*, not its MIME.
    ".cbz": FormatSpec("application/vnd.comicbook+zip", "comic", False, True, True),
    ".cbr": FormatSpec("application/vnd.comicbook-rar", "comic", False, True, True),
    ".cb7": FormatSpec("application/x-7z-compressed", "comic", False, True, True),
    ".cbt": FormatSpec("application/x-tar", "comic", False, True, True),
}

# Extensions whose text is extracted by decoding the file rather than by opening
# it with PyMuPDF.
TEXT_EXTS = frozenset(ext for ext, spec in _FORMATS.items() if spec.family == "text")

# Documents PyMuPDF opens. Superset of PDF — the whole point of issue #373.
FITZ_EXTS = frozenset(ext for ext, spec in _FORMATS.items() if spec.family == "fitz")

# Comic archives that are read as an ordered image sequence (issue #180).
COMIC_EXTS = frozenset(ext for ext, spec in _FORMATS.items() if spec.family == "comic")

# MIME types by family, for the router-side checks that only have a Book row.
FITZ_MIMES = frozenset(spec.mime for spec in _FORMATS.values() if spec.family == "fitz")
TEXT_MIMES = frozenset(spec.mime for spec in _FORMATS.values() if spec.family == "text")
COMIC_MIMES = frozenset(spec.mime for spec in _FORMATS.values() if spec.family == "comic")

# Every MIME whose text lands in the FTS index.
INDEXABLE_MIMES = frozenset(spec.mime for spec in _FORMATS.values() if spec.indexable)


def spec_for_ext(ext: str) -> Optional[FormatSpec]:
    """Return the FormatSpec for a file extension, or None if unhandled."""
    return _FORMATS.get(ext.lower())


def spec_for_path(path: str) -> Optional[FormatSpec]:
    """Return the FormatSpec for a filesystem path, or None if unhandled."""
    return spec_for_ext(Path(path).suffix)


def mime_for_ext(ext: str) -> Optional[str]:
    """Return the canonical MIME type for an extension, or None if unhandled."""
    spec = spec_for_ext(ext)
    return spec.mime if spec else None


def family_for_mime(mime: str) -> Optional[str]:
    """Return the format family ("fitz"/"text") for a stored MIME type.

    Deliberately never reports "comic": ``.cb7``/``.cbt`` share the generic 7z
    and tar MIME types with ordinary archives, so a MIME alone cannot tell a
    comic from a plain ``.7z``. Use the file extension (``COMIC_EXTS``) for that
    — see ``is_comic_path``.
    """
    for spec in _FORMATS.values():
        if spec.family != "comic" and spec.mime == mime:
            return spec.family
    return None


def is_comic_path(path: str) -> bool:
    """True when a path is a comic archive read as a page sequence (issue #180).

    Keyed on extension rather than MIME, because ``.cb7``/``.cbt`` are stored
    with the same MIME as an ordinary ``.7z``/``.tar``.
    """
    return Path(path).suffix.lower() in COMIC_EXTS


def can_index(mime: str) -> bool:
    """True when this MIME type's text can be extracted into the FTS index.

    Replaces the ``mime_type == "application/pdf"`` filters that left EPUB and
    DjVu permanently unindexed (issue #373).
    """
    return mime in INDEXABLE_MIMES


def can_thumbnail(ext: str) -> bool:
    """True when a cover thumbnail can be produced for this extension."""
    spec = spec_for_ext(ext)
    return bool(spec and spec.thumbnailable)


def has_page_count(ext: str) -> bool:
    """True when this extension yields a meaningful page count."""
    spec = spec_for_ext(ext)
    return bool(spec and spec.paged)


def is_fitz_mime(mime: str) -> bool:
    """True for documents PyMuPDF can open (PDF, EPUB, DjVu)."""
    return mime in FITZ_MIMES


def is_reflowable(ext: str) -> bool:
    """True when the format re-paginates according to the layout box.

    Only reflowable formats need ``EPUB_LAYOUT`` applied; a PDF has fixed pages
    and calling ``layout()`` on it is a no-op at best.
    """
    return ext.lower() == ".epub"


def apply_reflow_layout(doc: "fitz.Document") -> None:
    """Pin a reflowable document to the app-wide layout box.

    Safe to call on any document: fixed-layout formats ignore it. Keeping this
    in one function is what guarantees the indexer and the reader agree on what
    "page 12" means.
    """
    if getattr(doc, "is_reflowable", False):
        doc.layout(
            width=EPUB_LAYOUT_WIDTH,
            height=EPUB_LAYOUT_HEIGHT,
            fontsize=EPUB_LAYOUT_FONTSIZE,
        )


def open_document(filepath: str) -> "fitz.Document":
    """Open a fitz-backed document with the shared reflow layout applied.

    Every read path (page count, text extraction, thumbnail, page render) goes
    through here so no caller can accidentally paginate an EPUB differently.
    """
    doc = fitz.open(filepath)
    apply_reflow_layout(doc)
    return doc
